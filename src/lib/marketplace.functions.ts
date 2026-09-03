// Public buyer-facing marketplace: streams Webhook_Dispatched assets, registers
// buyers, and fires the one-click EMD lock. Zero-friction, fail-forward.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type MarketplaceDeal = {
  id: string;
  city: string | null;
  state: string | null;
  zip: string;
  asset_type: string | null;
  street: string | null;
  arv: number;
  offer_price: number;
  assignment_fee: number;
  discount_pct: number;
  title_purity_score: number;
  fema_zone_clear: boolean;
  projected_post_sale_tax: number;
  confidence_score: number | null;
  liquidity_bucket: string | null;
  title_status: string | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  acreage: number | null;
};

const listSchema = z.object({
  zip: z.string().trim().max(10).optional(),
  assetType: z.string().trim().max(40).optional(),
  minDiscount: z.number().finite().min(0).max(100).optional(),
  buyerToken: z.string().uuid().optional(),
});

export const listMarketplaceDeals = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => listSchema.parse(i ?? {}))
  .handler(async ({ data }): Promise<MarketplaceDeal[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const trust = await import("./trust-metrics.server");

    let verified = false;
    if (data.buyerToken) {
      const { data: b } = await supabaseAdmin
        .from("buyer_waitlist")
        .select("id")
        .eq("id", data.buyerToken)
        .maybeSingle();
      verified = !!b;
    }

    let q = supabaseAdmin
      .from("closing_pipeline_items")
      .select("*")
      .eq("status", "Webhook_Dispatched")
      // Compliance lock: only assets with a signed marketing authorization
      // may be published to the public marketplace.
      .eq("has_signed_marketing_auth", true)
      .order("optimized_acquisition_premium", { ascending: false })
      .limit(300);
    if (data.zip) q = q.eq("zip", data.zip);
    if (data.assetType) q = q.eq("asset_type", data.assetType);

    const { data: rows, error } = await q;
    if (error) return [];

    const out: MarketplaceDeal[] = [];
    for (const r of (rows ?? []) as Record<string, any>[]) {
      const base = Number(r.base_contract_price) || 0;
      const repairs = Number(r.estimated_repairs) || 0;
      const arv = Number(r.assessed_value) || 0;
      if (arv <= 0 || base <= 0) continue; // no valuation => never rendered with mock math
      const fee = Math.max(0, Math.round(arv * 0.7 - repairs - base));
      const offer = base + fee;
      const discount = arv > 0 ? Math.max(0, Math.round(((arv - offer) / arv) * 100)) : 0;
      if (data.minDiscount != null && discount < data.minDiscount) continue;

      let purity = 70;
      let fema = true;
      let tax = 0;
      try {
        purity = trust.titlePurityScore(r as any)?.title_purity_score ?? 70;
        fema = trust.femaClearance(r as any)?.fema_zone_clear !== false;
        tax = trust.projectedPostSaleTax(r as any)?.projected_post_sale_tax ?? 0;
      } catch {
        /* fail-forward */
      }

      out.push({
        id: String(r.id),
        city: r.city ?? null,
        state: r.state ?? null,
        zip: String(r.zip ?? ""),
        asset_type: r.asset_type ?? null,
        street: verified ? (r.address ?? null) : null,
        arv,
        offer_price: offer,
        assignment_fee: fee,
        discount_pct: discount,
        title_purity_score: purity,
        fema_zone_clear: fema,
        projected_post_sale_tax: Math.round(tax),
        confidence_score: r.confidence_score ?? null,
        liquidity_bucket: r.liquidity_bucket ?? null,
        title_status: r.title_status ?? null,
        sqft: r.sqft ?? null,
        beds: r.beds ?? null,
        baths: r.baths ?? null,
        acreage: r.acreage ?? null,
      });
    }
    return out;
  });

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  entity: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional(),
  proof_of_funds: z.string().trim().max(500).optional(),
});

export const registerMarketplaceBuyer = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => registerSchema.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("buyer_waitlist")
      .insert({
        fund_name: data.entity,
        contact_email: data.email,
        contact_phone: data.phone ?? null,
        target_zips: [],
        message: `Marketplace registration — ${data.name}${data.proof_of_funds ? ` | POF: ${data.proof_of_funds}` : ""}`,
        buyer_tier: "verified",
        status: "new",
      } as never)
      .select("id")
      .single();
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, token: String((row as any).id), email: data.email };
  });

const vdrSchema = z.object({ dealId: z.string().uuid(), buyerToken: z.string().uuid().optional() });

export const getMarketplaceVdr = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => vdrSchema.parse(i))
  .handler(async ({ data }) => {
    const { buildVdrPackage } = await import("./vdr.server");
    const pkg = (await buildVdrPackage(data.dealId)) as Record<string, any> | null;
    if (!pkg) return null;
    if (!data.buyerToken && pkg.asset) {
      pkg.asset = { ...pkg.asset, street: null, address: null, apn: null };
    }
    return pkg;
  });

const lockSchema = z.object({
  dealId: z.string().uuid(),
  buyerToken: z.string().uuid(),
  origin: z.string().url().max(300),
});

/** One-click: mint contract for the buyer, then return the $1,000 EMD checkout URL. */
export const lockDealAndSubmitEmd = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => lockSchema.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: buyer } = await supabaseAdmin
      .from("buyer_waitlist")
      .select("id, contact_email")
      .eq("id", data.buyerToken)
      .maybeSingle();
    const email = (buyer as any)?.contact_email;
    if (!email) return { ok: false as const, error: "buyer_not_registered" };

    const { createAndSendContract } = await import("./esign.server");
    const created: any = await createAndSendContract({
      dealId: data.dealId,
      buyerEmail: email,
      origin: data.origin,
    });
    if (created?.ok === false) return { ok: false as const, error: created.error };

    const token: string | undefined = created?.token ?? created?.data?.token;
    if (!token) return { ok: false as const, error: "contract_token_missing" };

    const { createEmdHold } = await import("./emd.server");
    const hold = await createEmdHold(token, data.origin);
    if (!hold.ok) {
      // Fail-forward: buyer still proceeds to the signing portal.
      return { ok: true as const, url: `${data.origin}/esign/${token}`, emd: hold.error };
    }
    return { ok: true as const, url: hold.url, emd: "checkout" };
  });
