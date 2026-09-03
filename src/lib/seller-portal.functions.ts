import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const viewSchema = z.object({
  assetId: z.string().uuid(),
  token: z.string().min(8).max(64),
});

const signSchema = viewSchema.extend({
  legalName: z.string().trim().min(2).max(120),
  agree: z.literal(true),
});

export type AuthorizeAssetView = {
  id: string;
  apn: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  asset_type: string | null;
  base_contract_price: number | null;
  status: string | null;
  title_status: string | null;
  already_signed: boolean;
  signed_at: string | null;
};

/** Token-gated read of a single asset for the seller authorization portal. */
export const getAuthorizeAsset = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => viewSchema.parse(input))
  .handler(async ({ data }): Promise<AuthorizeAssetView> => {
    const { verifySellerToken } = await import("./seller-link.server");
    if (!(await verifySellerToken(data.assetId, data.token))) throw new Error("INVALID_TOKEN");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,apn,address,city,state,zip,asset_type,base_contract_price,status,title_status,has_signed_marketing_auth,marketing_auth_signed_at",
      )
      .eq("id", data.assetId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("ASSET_NOT_FOUND");

    const r = row as Record<string, unknown>;
    return {
      id: String(r["id"]),
      apn: (r["apn"] as string | null) ?? null,
      address: (r["address"] as string | null) ?? null,
      city: (r["city"] as string | null) ?? null,
      state: (r["state"] as string | null) ?? null,
      zip: (r["zip"] as string | null) ?? null,
      asset_type: (r["asset_type"] as string | null) ?? null,
      base_contract_price: (r["base_contract_price"] as number | null) ?? null,
      status: (r["status"] as string | null) ?? null,
      title_status: (r["title_status"] as string | null) ?? null,
      already_signed: Boolean(r["has_signed_marketing_auth"]),
      signed_at: (r["marketing_auth_signed_at"] as string | null) ?? null,
    };
  });

/** Seller executes authorization -> flag flips -> match + FIX dispatch fires immediately. */
export const executeSellerAuthorization = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => signSchema.parse(input))
  .handler(async ({ data }) => {
    const { verifySellerToken } = await import("./seller-link.server");
    if (!(await verifySellerToken(data.assetId, data.token))) throw new Error("INVALID_TOKEN");

    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const ip =
      (
        getRequestHeader("cf-connecting-ip") ||
        (getRequestHeader("x-forwarded-for") || "").split(",")[0] ||
        ""
      ).trim() || null;
    const ua = getRequestHeader("user-agent") || null;
    const signedAt = new Date().toISOString();

    const { error: upErr } = await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        has_signed_marketing_auth: true,
        marketing_auth_signed_at: signedAt,
      } as never)
      .eq("id", data.assetId);
    if (upErr) throw new Error(upErr.message);

    await supabaseAdmin.from("system_audit_logs").insert({
      pipeline_item_id: data.assetId,
      event_type: "MARKETING_AUTH_SIGNED",
      reason: "Seller executed marketing & assignment authorization via magic link portal",
      ip_address: ip,
      payload: {
        signer_name: data.legalName,
        signer_ip: ip,
        signer_user_agent: ua,
        signed_at: signedAt,
        document: "NON_EXCLUSIVE_MARKETING_ASSIGNMENT_AUTH_v1",
        channel: "AUTHORIZE_ASSET_PORTAL",
      },
    } as never);

    // Memorandum of Purchase Agreement (title cloud) — fail-forward.
    try {
      const { generateMemorandum } = await import("./memorandum.server");
      await generateMemorandum(data.assetId, data.legalName);
    } catch {
      /* recorded later by sweep */
    }

    // --- Autonomous dispatch cascade (fail-forward: never blocks the signature) ---
    let dispatched = false;
    let dispatchNote = "no_matched_buy_box";
    try {
      const { data: deal } = await supabaseAdmin
        .from("closing_pipeline_items")
        .select(
          "id, external_id, apn, address, city, zip, base_contract_price, optimized_acquisition_premium, title_status, matched_buy_box_id",
        )
        .eq("id", data.assetId)
        .maybeSingle();

      const boxId = (deal as Record<string, unknown> | null)?.["matched_buy_box_id"] as
        | string
        | null
        | undefined;

      if (deal && boxId) {
        const { data: box } = await supabaseAdmin
          .from("buyer_buy_boxes")
          .select("id,label,contact_email")
          .eq("id", boxId)
          .maybeSingle();
        if (box?.contact_email) {
          const { dispatch_offer } = await import("./dispatch-gmail.server");
          const res = await dispatch_offer(deal as never, {
            id: box.id,
            contact_email: box.contact_email,
            label: box.label,
          });
          dispatched = Boolean(res?.ok);
          dispatchNote = dispatched ? `sent:${box.contact_email}` : "dispatch_failed";
          if (dispatched) {
            await supabaseAdmin
              .from("closing_pipeline_items")
              .update({
                offer_sent_at: new Date().toISOString(),
                offer_stage: "sent",
                tif_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              } as never)
              .eq("id", data.assetId);
          }
        } else {
          dispatchNote = "buy_box_has_no_contact_email";
        }
      }
    } catch (e) {
      dispatchNote = `dispatch_error:${(e as Error).message}`;
    }

    return { ok: true as const, signedAt, dispatched, dispatchNote };
  });

/** Batch-generate tokenized seller authorization links for unsigned assets. */
export const generateSellerAuthLinks = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(500).default(100) }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sellerAuthUrl } = await import("./seller-link.server");

    const { data: rows, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id,address,city,state,zip,seller_email,base_contract_price")
      .eq("has_signed_marketing_auth", false)
      .order("base_contract_price", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    return Promise.all(
      (rows ?? []).map(async (r) => ({
        id: String((r as Record<string, unknown>)["id"]),
        address: (r as Record<string, unknown>)["address"] as string | null,
        seller_email: ((r as Record<string, unknown>)["seller_email"] ?? null) as string | null,
        url: await sellerAuthUrl(String((r as Record<string, unknown>)["id"])),
      })),
    );
  });
