// Autonomous institutional buyer self-registration.
// A machine POSTs its manifest; we cryptographically pre-flight its endpoint and
// arm the buy box only when the node answers on the wire. Fail-forward: never throws.
import { challengeBuyBox } from "@/lib/endpoint-verify.server";

const CORS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, X-M2M-Response",
};

export const REGISTER_CORS = CORS;

const CLASS_MAP: Record<string, string> = {
  COMMERCIAL: "COMMERCIAL_LAND",
  MULTIFAMILY: "MULTIFAMILY_5PLUS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

export async function handleRegisterBuyer(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ registered: false, error: "invalid_json" }, 400);
  }

  const legalName = String(body?.legal_name ?? body?.company_name ?? "").trim();
  const ein = String(body?.ein ?? "").replace(/\D/g, "");
  const email = String(body?.contact_email ?? body?.email ?? "").trim().toLowerCase();
  const webhook = String(body?.webhook_url ?? "").trim();
  const publicKey = body?.public_key ? String(body.public_key).slice(0, 512) : null;

  if (!legalName) return json({ registered: false, error: "legal_name_required" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ registered: false, error: "invalid_contact_email" }, 400);

  // ---- EMAIL lane: CSV/broker imports (no EIN, no machine endpoint). Fail-forward. ----
  if (!webhook) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const now = new Date().toISOString();
      const types = (Array.isArray(body?.asset_types) ? body.asset_types : [])
        .map((c: unknown) => String(c).toUpperCase())
        .slice(0, 12);
      const row: Record<string, unknown> = {
        label: legalName,
        legal_name: legalName,
        contact_email: email,
        execution_mode: "EMAIL",
        target_asset_types: types,
        target_states: Array.isArray(body?.target_states)
          ? body.target_states.map((s: unknown) => String(s).toUpperCase()).slice(0, 60)
          : [],
        target_zip_codes: [],
        max_contract_price: Number(body?.max_asset_price ?? 0) || 500_000,
        min_discount_pct: Number(body?.min_discount_pct ?? 0) || null,
        persona: "GENERIC",
        verification_tier: "UNVERIFIED",
        active: body?.is_active === false ? false : true,
        updated_at: now,
      };
      const { data: existing } = await supabaseAdmin
        .from("buyer_buy_boxes")
        .select("id")
        .eq("contact_email", email)
        .maybeSingle();
      const write = existing
        ? await supabaseAdmin
            .from("buyer_buy_boxes")
            .update(row as never)
            .eq("id", (existing as any).id)
            .select("id")
            .maybeSingle()
        : await supabaseAdmin
            .from("buyer_buy_boxes")
            .insert(row as never)
            .select("id")
            .maybeSingle();
      if (write.error) {
        console.error("[register-buyer:email] write failed", write.error);
        return json({ registered: false, error: "registry_write_failed" }, 500);
      }
      return json(
        {
          registered: true,
          buy_box_id: (write.data as any)?.id ?? (existing as any)?.id ?? null,
          execution_mode: "EMAIL",
        },
        201,
      );
    } catch (e) {
      return json({ registered: false, error: (e as Error).message }, 500);
    }
  }

  if (ein.length !== 9) return json({ registered: false, error: "invalid_ein" }, 400);
  if (!/^https:\/\/[^\s]+$/i.test(webhook))
    return json({ registered: false, error: "webhook_url_must_be_https" }, 400);


  const classes = (Array.isArray(body?.target_asset_classes) ? body.target_asset_classes : [])
    .map((c: unknown) => String(c).toUpperCase())
    .map((c: string) => CLASS_MAP[c] ?? c)
    .slice(0, 12);

  const maxDeal = Number(body?.max_deal_size_usd ?? 0) || 25_000_000;
  const minDeal = Number(body?.min_deal_size_usd ?? 0) || 0;
  const capRate = Number(body?.target_cap_rate_min ?? 0) || null;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Cryptographic pre-flight against the declared endpoint.
    const pre = await challengeBuyBox(webhook, publicKey);

    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      label: legalName,
      legal_name: legalName,
      partner_tax_id: `${ein.slice(0, 2)}-${ein.slice(2)}`,
      contact_email: email,
      webhook_url: webhook,
      public_key: publicKey,
      execution_mode: "M2M",
      target_asset_types: classes,
      target_zip_codes: [],
      max_contract_price: maxDeal,
      min_deal_size_usd: minDeal,
      target_cap_rate_min: capRate,
      persona: "GENERIC",
      endpoint_status: pre.ok ? "VERIFIED" : "UNREACHABLE",
      endpoint_last_code: pre.http_code,
      endpoint_checked_at: now,
      verification_tier: pre.cryptographic
        ? "CRYPTOGRAPHICALLY_VERIFIED"
        : pre.ok
          ? "ACK_VERIFIED"
          : "UNVERIFIED",
      active: pre.ok,
      updated_at: now,
    };

    const { data: existing } = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select("id")
      .eq("webhook_url", webhook)
      .maybeSingle();

    const write = existing
      ? await supabaseAdmin
          .from("buyer_buy_boxes")
          .update(row as never)
          .eq("id", (existing as any).id)
          .select("id")
          .maybeSingle()
      : await supabaseAdmin
          .from("buyer_buy_boxes")
          .insert(row as never)
          .select("id")
          .maybeSingle();

    if (write.error) {
      console.error("[register-buyer] write failed", write.error);
      return json({ registered: false, error: "registry_write_failed" }, 500);
    }
    const id = ((write.data as any)?.id ?? (existing as any)?.id) ?? null;


    if (!pre.ok) {
      await supabaseAdmin.from("offer_delivery_logs").insert({
        buyer_id: id,
        status: "FAILED",
        meta: {
          channel: "SELF_REGISTRATION",
          webhook_url: webhook,
          http_code: pre.http_code,
          error_message: (pre.error ?? "unreachable").slice(0, 300),
        } as never,
      } as never);
      return json(
        {
          registered: false,
          buy_box_id: id,
          endpoint_status: "UNREACHABLE",
          http_code: pre.http_code,
          error: pre.error ?? "preflight_failed",
        },
        422,
      );
    }

    return json(
      {
        registered: true,
        buy_box_id: id,
        endpoint_status: "VERIFIED",
        verification_tier: row["verification_tier"],
        http_code: pre.http_code,
        execution_ttl_ms: 3000,
        accept_endpoint: "https://abandonedasset.online/api/public/v1/m2m/accept",
        settlement_hook: "https://abandonedasset.online/api/public/hooks/stripe-settlement",
      },
      201,
    );
  } catch (e) {
    return json({ registered: false, error: (e as Error).message }, 500);
  }
}
