import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const lookupSchema = z
  .object({
    hash: z.string().trim().min(8).max(64),
    id: z.string().uuid().optional(),
    apn: z.string().trim().min(3).max(64).optional(),
  })
  .refine((v) => Boolean(v.id || v.apn), { message: "Missing asset reference" });

const claimSchema = z.object({
  hash: z.string().trim().min(8).max(64),
  assetId: z.string().uuid(),
  legalName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(7).max(32),
  agree: z.literal(true),
});

export const getClaimAsset = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => lookupSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { verifyClaimHash } = await import("./claim.server");

    const cols =
      "id,apn,address,city,state,zip,asset_type,zoning_category,base_contract_price,absolute_floor_price,calculated_arv,estimated_repairs,has_signed_marketing_auth,marketing_auth_signed_at,seller_claimed_at";

    const q = supabaseAdmin.from("closing_pipeline_items").select(cols);
    const { data: row, error } = await (data.id
      ? q.eq("id", data.id).maybeSingle()
      : q.eq("apn", data.apn!).limit(1).maybeSingle());

    if (error) throw new Error(error.message);
    if (!row) throw new Error("Asset not found");

    const asset = row as Record<string, unknown>;
    if (!verifyClaimHash(String(asset["id"]), data.hash)) throw new Error("Invalid claim link");

    const floor = Number(asset["absolute_floor_price"] ?? 0);
    const price = Number(asset["base_contract_price"] ?? 0);
    return {
      id: String(asset["id"]),
      apn: (asset["apn"] as string | null) ?? null,
      address: (asset["address"] as string | null) ?? null,
      city: (asset["city"] as string | null) ?? null,
      state: (asset["state"] as string | null) ?? null,
      zip: String(asset["zip"] ?? ""),
      asset_type: (asset["asset_type"] as string | null) ?? null,
      zoning_category: (asset["zoning_category"] as string | null) ?? null,
      offer: floor > 0 ? floor : price,
      arv: Number(asset["calculated_arv"] ?? 0) || null,
      already_signed: Boolean(asset["has_signed_marketing_auth"]),
      signed_at: (asset["marketing_auth_signed_at"] as string | null) ?? null,
    };
  });

export const submitClaim = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => claimSchema.parse(input))
  .handler(async ({ data }) => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { verifyClaimHash } = await import("./claim.server");

    if (!verifyClaimHash(data.assetId, data.hash)) throw new Error("Invalid claim link");

    const ip =
      (
        getRequestHeader("cf-connecting-ip") ||
        (getRequestHeader("x-forwarded-for") || "").split(",")[0] ||
        ""
      ).trim() || null;
    const ua = getRequestHeader("user-agent") || null;
    const signedAt = new Date().toISOString();

    const { data: prior } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("base_contract_price,absolute_floor_price,calculated_arv,estimated_repairs")
      .eq("id", data.assetId)
      .maybeSingle();
    const p = (prior ?? {}) as Record<string, unknown>;

    const floor = Number(p["absolute_floor_price"] ?? 0);
    const price = floor > 0 ? floor : Number(p["base_contract_price"] ?? 0);
    const arv = Number(p["calculated_arv"] ?? 0);
    const repairs = Number(p["estimated_repairs"] ?? 0);

    const patch: Record<string, unknown> = {
      seller_email: data.email,
      seller_phone: data.phone,
      seller_claimed_at: signedAt,
      has_signed_marketing_auth: true,
      marketing_auth_signed_at: signedAt,
      status: "Webhook_Dispatched",
    };
    if (floor > 0) patch["base_contract_price"] = floor;
    if (arv > 0) patch["is_fee_positive"] = arv - repairs - price >= 5000;

    const { error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .update(patch as never)
      .eq("id", data.assetId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("system_audit_logs").insert({
      pipeline_item_id: data.assetId,
      event_type: "INBOUND_CLAIM_AUTH",
      reason: "First-party claim: contact captured + marketing authorization executed",
      ip_address: ip,
      payload: {
        signer_name: data.legalName,
        email: data.email,
        phone: data.phone,
        signer_ip: ip,
        signer_user_agent: ua,
        signed_at: signedAt,
        cleared_price: price,
        document: "NON_EXCLUSIVE_MARKETING_ASSIGNMENT_AUTH_v1",
      },
    } as never);

    // Fire the 1031 capital match immediately; cron sweep is the fallback.
    try {
      const site = process.env["PUBLIC_SITE_URL"] ?? "https://asset-weaver-30.lovable.app";
      await fetch(`${site}/api/public/hooks/exchange-match`, { method: "POST" });
    } catch {
      /* non-blocking */
    }

    return { ok: true as const, signedAt, clearedPrice: price };
  });
