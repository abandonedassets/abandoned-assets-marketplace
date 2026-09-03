import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const BodySchema = z.object({
  pipeline_item_id: z.string().uuid(),
  outcome: z.enum(["success", "failed"]),
  title_company_ref: z.string().min(1).max(255).optional(),
});

function log(stage: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ stage, ts: new Date().toISOString(), ...extra }));
}

export const Route = createFileRoute("/api/public/hooks/transaction-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.FLOW_CALLBACK_SECRET;
        if (!secret) {
          return Response.json(
            { error: "server_misconfigured" },
            { status: 500 },
          );
        }

        const sig = request.headers.get("x-callback-signature") ?? "";
        const raw = await request.text();
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        let provided: Buffer;
        try {
          provided = Buffer.from(sig, "hex");
        } catch {
          return Response.json({ error: "bad_signature" }, { status: 401 });
        }
        const exp = Buffer.from(expected, "hex");
        if (
          provided.length !== exp.length ||
          !timingSafeEqual(provided, exp)
        ) {
          return Response.json({ error: "invalid_signature" }, { status: 401 });
        }

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(JSON.parse(raw));
        } catch (e) {
          console.error("transaction-callback parse error", e);
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }


        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // Fetch item
        const { data: item, error: itemErr } = await supabaseAdmin
          .from("closing_pipeline_items")
          .select(
            "id, user_id, zip, beds, baths, sqft, year_built, base_contract_price, optimized_acquisition_premium, status",
          )
          .eq("id", parsed.pipeline_item_id)
          .maybeSingle();
        if (itemErr || !item) {
          log("callback_item_missing", { id: parsed.pipeline_item_id });
          return Response.json({ error: "item_not_found" }, { status: 404 });
        }

        if (parsed.outcome === "failed") {
          log("callback_failed_outcome", { id: item.id });
          return Response.json({ ok: true, package_status: null });
        }

        // promote status (fail-forward)
        try {
          if (
            item.status !== "In-Escrow" &&
            item.status !== "Closed"
          ) {
            await supabaseAdmin
              .from("closing_pipeline_items")
              .update({ status: "In-Escrow" })
              .eq("id", item.id);
          }
        } catch (e) {
          log("status_promo_failed", { id: item.id, error: String(e) });
        }

        // Build payload
        const payload = {
          tranche_id: item.id,
          property_profile: {
            zip: item.zip,
            beds: item.beds,
            baths: item.baths,
            sqft: item.sqft,
            year_built: item.year_built,
          },
          financials: {
            contract_base_price: item.base_contract_price,
            assignment_fee: item.optimized_acquisition_premium,
          },
          title_company_ref: parsed.title_company_ref ?? null,
          packaged_at: new Date().toISOString(),
        };

        // Upsert title package as Built
        const { data: pkg, error: pkgErr } = await supabaseAdmin
          .from("title_packages")
          .upsert(
            {
              pipeline_item_id: item.id,
              package_status: "Built",
              payload,
              title_company_ref: parsed.title_company_ref ?? null,
            },
            { onConflict: "pipeline_item_id" },
          )
          .select()
          .single();
        if (pkgErr || !pkg) {
          log("package_build_failed", {
            id: item.id,
            error: pkgErr?.message,
          });
          return Response.json(
            { error: "package_build_failed" },
            { status: 500 },
          );
        }

        // Look up title company endpoint
        let packageStatus: "Sent" | "Failed" = "Failed";
        try {
          const { data: titleEp } = await supabaseAdmin
            .from("routing_endpoints")
            .select("url")
            .eq("name", "title_company_default")
            .eq("is_active", true)
            .maybeSingle();

          if (titleEp?.url) {
            const res = await fetch(titleEp.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(10_000),
            });
            packageStatus = res.ok ? "Sent" : "Failed";
            log("title_dispatch", {
              id: item.id,
              status: res.status,
              outcome: packageStatus,
            });
          } else {
            log("title_endpoint_missing", { id: item.id });
          }
        } catch (e) {
          log("title_dispatch_error", {
            id: item.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }

        try {
          await supabaseAdmin
            .from("title_packages")
            .update({ package_status: packageStatus })
            .eq("id", pkg.id);
        } catch (e) {
          log("package_status_update_failed", {
            id: pkg.id,
            error: String(e),
          });
        }

        return Response.json({ ok: true, package_status: packageStatus });
      },
    },
  },
});
