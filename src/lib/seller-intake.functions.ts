import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const intakeSchema = z.object({
  address: z.string().trim().min(3).max(200),
  city: z.string().trim().max(100).optional().default(""),
  state: z.string().trim().max(2).optional().default(""),
  zip: z.string().trim().regex(/^\d{5}$/, "ZIP must be 5 digits"),
  asking_price: z.number().finite().min(1).max(100_000_000),
  arv: z.number().finite().min(0).max(500_000_000).optional(),
  beds: z.number().int().min(0).max(50).optional(),
  baths: z.number().min(0).max(50).optional(),
  sqft: z.number().int().min(0).max(1_000_000).optional(),
  year_built: z.number().int().min(1700).max(2100).optional(),
  asset_type: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type SellerIntakeInput = z.infer<typeof intakeSchema>;

// Public intake endpoint. Validated server-side, written with the service role
// because sellers are not authenticated app users.
export const submitSellerIntake = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => intakeSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const arv = data.arv && data.arv > 0 ? data.arv : Math.round(data.asking_price * 1.25);

    // State-level wholesaling fence (SC / IL / OK).
    const { assessState, complianceTags } = await import("./geo-compliance.server");
    const rule = assessState(data.state);
    const tags = ["SELLER-INTAKE", ...complianceTags(data.state)];
    const notes = [data.notes || null, rule.tier === "CLEAR" ? null : rule.note]
      .filter(Boolean)
      .join(" | ") || null;

    const { data: row, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .insert({
        address: data.address,
        city: data.city || null,
        state: data.state ? data.state.toUpperCase() : null,
        zip: data.zip,
        beds: data.beds ?? null,
        baths: data.baths ?? null,
        sqft: data.sqft ?? null,
        year_built: data.year_built ?? null,
        asset_type: data.asset_type || "SFR",
        base_contract_price: data.asking_price,
        status: rule.tier === "PROHIBITED" ? "System-Hold" : "New",
        source: "seller_intake",
        title_notes: notes,
        enrichment_tags: tags,
        compliance_tier: rule.tier,
        erecording_blocked: rule.blockErecording,
        requires_legal_review: rule.tier === "PROHIBITED",
        manual_review: rule.tier === "PROHIBITED",
      } as never)
      .select("id,status,zip,base_contract_price")
      .single();

    if (error) throw new Error(error.message);
    return {
      ok: true as const,
      id: (row as { id: string }).id,
      arv,
      compliance: { tier: rule.tier, note: rule.note },
    };
  });

