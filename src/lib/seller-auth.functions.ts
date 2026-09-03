import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const idSchema = z.object({ assetId: z.string().uuid(), token: z.string().min(8).max(64) });

const signSchema = z.object({
  assetId: z.string().uuid(),
  token: z.string().min(8).max(64),
  legalName: z.string().trim().min(2).max(120),
  agree: z.literal(true),
  offer: z.number().positive().max(100_000_000).optional(),
});


export const getSellerAgreementAsset = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data }) => {
    const { verifySellerToken } = await import("./seller-link.server");
    if (!(await verifySellerToken(data.assetId, data.token))) throw new Error("INVALID_TOKEN");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,address,city,state,zip,beds,baths,sqft,asset_type,base_contract_price,has_signed_marketing_auth,marketing_auth_signed_at",
      )
      .eq("id", data.assetId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Asset not found");
    return row as {
      id: string;
      address: string | null;
      city: string | null;
      state: string | null;
      zip: string;
      beds: number | null;
      baths: number | null;
      sqft: number | null;
      asset_type: string | null;
      base_contract_price: number;
      has_signed_marketing_auth: boolean;
      marketing_auth_signed_at: string | null;
    };
  });

export const signMarketingAuth = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => signSchema.parse(input))
  .handler(async ({ data }) => {
    const { verifySellerToken } = await import("./seller-link.server");
    if (!(await verifySellerToken(data.assetId, data.token))) throw new Error("INVALID_TOKEN");
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const ip =
      (getRequestHeader("cf-connecting-ip") ||
        (getRequestHeader("x-forwarded-for") || "").split(",")[0] ||
        "")
        .trim() || null;
    const ua = getRequestHeader("user-agent") || null;
    const signedAt = new Date().toISOString();

    const { data: prior } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("calculated_arv,estimated_repairs,base_contract_price,absolute_floor_price")
      .eq("id", data.assetId)
      .maybeSingle();

    const p = (prior ?? {}) as Record<string, any>;
    const patch: Record<string, unknown> = {
      has_signed_marketing_auth: true,
      marketing_auth_signed_at: signedAt,
    };

    // Reverse-strike acceptance: seller takes the algorithmic floor price.
    let newPrice = Number(p["base_contract_price"] ?? 0);
    if (data.offer && data.offer > 0) {
      newPrice = data.offer;
      patch["base_contract_price"] = newPrice;
    }
    const arv = Number(p["calculated_arv"] ?? 0);
    const repairs = Number(p["estimated_repairs"] ?? 0);
    if (arv > 0) {
      const margin = arv - repairs - newPrice;
      patch["is_fee_positive"] = margin >= 5000;
      if (margin >= 5000) patch["status"] = "Pending-Underwriting";
    }

    const { data: row, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .update(patch as never)
      .eq("id", data.assetId)
      .select("id,address,zip,base_contract_price,has_signed_marketing_auth")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("system_audit_logs").insert({
      pipeline_item_id: data.assetId,
      event_type: "MARKETING_AUTH_SIGNED",
      reason: "Seller executed non-exclusive marketing & assignment authorization",
      ip_address: ip,
      payload: {
        signer_name: data.legalName,
        signer_ip: ip,
        signer_user_agent: ua,
        signed_at: signedAt,
        accepted_counter_offer: data.offer ?? null,
        document: "NON_EXCLUSIVE_MARKETING_ASSIGNMENT_AUTH_v1",
      },
    } as never);

    // Memorandum of Purchase Agreement (title cloud) — fail-forward.
    try {
      const { generateMemorandum } = await import("./memorandum.server");
      await generateMemorandum(data.assetId, data.legalName);
    } catch {
      /* recorded later by sweep */
    }

    // Immediately clear the asset into active 1031 capital (non-blocking).
    try {
      const site = process.env["PUBLIC_SITE_URL"] ?? "https://asset-weaver-30.lovable.app";
      await fetch(`${site}/api/public/hooks/exchange-match`, { method: "POST" });
    } catch {
      /* cron sweep will pick it up */
    }

    return { ok: true as const, signedAt, assetId: (row as { id: string }).id };
  });

