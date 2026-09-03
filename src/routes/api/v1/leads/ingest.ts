import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const LeadSchema = z.object({
  address: z.string().min(5).max(300).optional(),
  address_raw: z.string().min(5).max(300).optional(),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/).transform((v) => v.slice(0, 5)),
  city: z.string().max(120).optional(),
  state: z.string().max(2).optional(),
  asking_price: z.number().positive().max(100_000_000).optional(),
  base_contract_price: z.number().positive().max(100_000_000).optional(),
  arv: z.number().positive().max(100_000_000).optional(),
  calculated_arv: z.number().positive().max(100_000_000).optional(),
  estimated_repairs: z.number().min(0).max(50_000_000).optional(),
  assignment_fee: z.number().min(0).max(50_000_000).optional(),
  seller_name: z.string().max(200).optional(),
  seller_phone: z.string().max(40).optional(),
  seller_email: z.string().email().max(200).optional(),
  asset_type: z.string().max(60).optional(),
  source: z.string().max(120).optional(),
}).transform((lead) => {
  const price = lead.asking_price ?? lead.base_contract_price;
  // Fallback valuation: never let a raw lead stall at the pre-flight
  // gateway with NO_VALUATION when a contract price exists.
  const arv = lead.arv ?? lead.calculated_arv ?? (price ? price * 1.5 : undefined);
  return {
    ...lead,
    address: (lead.address ?? lead.address_raw)!,
    asking_price: price,
    arv,
  };
}).refine((lead) => typeof lead.address === "string" && lead.address.length >= 5, {
  message: "address or address_raw is required",
  path: ["address"],
});

const BatchSchema = z.union([LeadSchema, z.object({ leads: z.array(LeadSchema).min(1).max(500) })]);

// Active lead ingress: accepts single lead or { leads: [...] } batch,
// idempotent on (address, zip), inserts as Pending-Underwriting so the
// pre-flight cron can validate and flip to reverse_strike_ready.
export const Route = createFileRoute("/api/v1/leads/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ingestKey = process.env["LEAD_INGEST_KEY"];
        if (ingestKey) {
          const provided = request.headers.get("x-ingest-key") ?? "";
          if (provided !== ingestKey) {
            return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          }
        }

        let parsed: z.infer<typeof BatchSchema>;
        try {
          parsed = BatchSchema.parse(await request.json());
        } catch (e) {
          return Response.json(
            { ok: false, error: "invalid_payload", detail: e instanceof z.ZodError ? e.issues : String(e) },
            { status: 400 },
          );
        }

        const leads = "leads" in parsed ? parsed.leads : [parsed];
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let inserted = 0;
        let duplicates = 0;
        const errors: { address: string; error: string }[] = [];

        for (const lead of leads) {
          // Fail-forward per record: one bad lead never stalls the batch.
          try {
            const address = lead.address.trim();
            const { data: existing } = await supabaseAdmin
              .from("closing_pipeline_items")
              .select("id")
              .ilike("address", address)
              .eq("zip", lead.zip)
              .limit(1);

            if (existing && existing.length > 0) {
              duplicates++;
              continue;
            }

            const row: Record<string, unknown> = {
              address,
              zip: lead.zip,
              status: "Pending-Underwriting",
              active_owner: lead.seller_name ?? null,
              seller_phone: lead.seller_phone ?? null,
              seller_email: lead.seller_email ?? null,
              asset_type: lead.asset_type ?? null,
              lead_source: lead.source ?? "api_ingest",
              reverse_strike_ready: false,
            };
            if (lead.asking_price !== undefined) row.base_contract_price = lead.asking_price;
            if (lead.arv !== undefined) row.calculated_arv = lead.arv;
            if (lead.estimated_repairs !== undefined) row.estimated_repairs = lead.estimated_repairs;

            const { error } = await supabaseAdmin
              .from("closing_pipeline_items")
              .insert(row as never);

            if (error) {
              errors.push({ address, error: error.message });
            } else {
              inserted++;
            }
          } catch (err) {
            errors.push({ address: lead.address, error: err instanceof Error ? err.message : String(err) });
          }
        }

        return Response.json({ ok: true, inserted, duplicates, errors });
      },
    },
  },
});
