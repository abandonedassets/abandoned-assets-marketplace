// Automated status update worker for retail_locations.
// Proximity (1-mile PostGIS) + 10-year OPEX budget check -> Rejected | Webhook_Dispatched.
// Fail-forward: a single bad row never stalls the batch.
import { createFileRoute } from "@tanstack/react-router";
import { projectOperatingExpenses } from "@/lib/franchise-opex";
import { sanitizeZip } from "@/lib/infra-underwrite";

const RADIUS_MILES = 1;
const DEFAULT_BASE_ANNUAL_COST = 180_000;
const DEFAULT_MAX_10YR_BUDGET = 2_500_000;

export const Route = createFileRoute("/api/public/cron/retail-status-worker")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, hint: "POST to evaluate pending retail locations" }),
      POST: async ({ request }) => {
        const started = Date.now();
        let evaluated = 0;
        let approved = 0;
        let rejected = 0;
        let skipped = 0;
        try {
          const secret = process.env["CRON_SECRET"];
          if (secret && request.headers.get("x-cron-secret") !== secret) {
            return new Response("Unauthorized", { status: 401 });
          }

          const body = (await request.json().catch(() => ({}))) as {
            limit?: number;
            max_10yr_budget?: number;
            base_annual_cost?: number;
          };
          const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 1000);
          const maxBudget =
            Number(body.max_10yr_budget) > 0
              ? Number(body.max_10yr_budget)
              : Number(process.env["RETAIL_MAX_10YR_BUDGET"]) || DEFAULT_MAX_10YR_BUDGET;
          const fallbackBase =
            Number(body.base_annual_cost) > 0
              ? Number(body.base_annual_cost)
              : DEFAULT_BASE_ANNUAL_COST;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: rows, error } = await supabaseAdmin
            .from("retail_locations" as never)
            .select("id, base_annual_cost, kind, status, zip")
            .eq("status", "New")
            .neq("kind", "substation")
            .limit(limit);
          if (error) throw new Error(error.message);

          // Stage 1 — fast index check. One cheap read builds the substation
          // ZIP3 corridor set; parcels outside it never touch PostGIS.
          const { data: subs } = await supabaseAdmin
            .from("retail_locations" as never)
            .select("zip")
            .eq("kind", "substation")
            .eq("is_active", true)
            .limit(20000);
          const corridor = new Set<string>();
          for (const s of (subs ?? []) as Array<{ zip: string | null }>) {
            const z = sanitizeZip(s.zip).zip5;
            if (z) corridor.add(z.slice(0, 3));
          }

          for (const row of (rows ?? []) as Array<{
            id: string;
            base_annual_cost: number | null;
            zip: string | null;
          }>) {
            try {
              evaluated++;

              const z5 = sanitizeZip(row.zip).zip5;
              if (corridor.size > 0 && (!z5 || !corridor.has(z5.slice(0, 3)))) {
                skipped++;
                continue; // no substation corridor — skip spatial math entirely
              }


              const { data: nearby, error: proxErr } = await supabaseAdmin.rpc(
                "retail_supplier_proximity_count" as never,
                { _id: row.id, _radius_miles: RADIUS_MILES } as never,
              );
              if (proxErr) throw new Error(proxErr.message);

              if (!Number(nearby)) {
                skipped++;
                continue; // stays "New" until a supplier lands nearby
              }

              const base = Number(row.base_annual_cost) > 0
                ? Number(row.base_annual_cost)
                : fallbackBase;
              const projection = projectOperatingExpenses(base);
              const passesBudget = projection.total_10yr <= maxBudget;

              const { error: upErr } = await supabaseAdmin
                .from("retail_locations" as never)
                .update({
                  status: passesBudget ? "Webhook_Dispatched" : "Rejected",
                  base_annual_cost: base,
                  projected_10yr_cost: projection.total_10yr,
                  evaluated_at: new Date().toISOString(),
                  evaluation_note: passesBudget
                    ? `Within ${RADIUS_MILES}mi of ${Number(nearby)} supplier site(s); 10yr OPEX ${projection.total_10yr} <= ${maxBudget}`
                    : `10yr OPEX ${projection.total_10yr} exceeds budget ${maxBudget}`,
                  updated_at: new Date().toISOString(),
                } as never)
                .eq("id", row.id);
              if (upErr) throw new Error(upErr.message);

              if (passesBudget) approved++;
              else rejected++;
            } catch (e) {
              skipped++;
              console.error("[retail-status-worker] row failed", (e as Error).message);
            }
          }

          return Response.json({
            ok: true,
            evaluated,
            approved,
            rejected,
            skipped,
            ms: Date.now() - started,
          });
        } catch (e) {
          console.error("[retail-status-worker] unhandled", e);
          return Response.json(
            { ok: false, error: (e as Error).message, evaluated, approved, rejected, skipped },
            { status: 200 },
          );
        }
      },
    },
  },
});
