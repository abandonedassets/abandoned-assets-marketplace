// Data Gating Protocol.
// Geography is the cryptographic key: the live tape broadcasts yield only.
// Coordinates, address, parcel and wire instructions are released ONLY after a
// verified Stripe authorization on the assignment fee.

/** Hours until the asset auto-routes to retail buyers. */
export const RETAIL_RELEASE_HOURS = 4;

export function retailCountdown(fromIso?: string | null): string {
  const start = fromIso ? Date.parse(fromIso) : Date.now();
  const endsAt = start + RETAIL_RELEASE_HOURS * 3600_000;
  const left = Math.max(0, endsAt - Date.now());
  const h = Math.floor(left / 3600_000);
  const m = Math.floor((left % 3600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return [h, m, s].map((x) => String(x).padStart(2, "0")).join(":");
}

const num = (v: unknown) => (v == null ? null : Number(v) || 0);

/** Pre-calculated yield block — economics without dirt. */
export function yieldBlock(r: Record<string, any>) {
  const price = num(r["base_contract_price"]) ?? 0;
  const noi = num(r["net_operating_income"]) ?? null;
  const capRate =
    noi && price > 0 ? Math.round((noi / price) * 100 * 100) / 100 : num(r["cap_rate"]);
  return {
    net_operating_income_usd: noi,
    cap_rate_pct: capRate,
    arv_usd: num(r["calculated_arv"]),
    estimated_repairs_usd: num(r["estimated_repairs"]),
    title_status: String(r["title_status"] ?? "").toLowerCase().includes("insur")
      ? "clear"
      : (r["title_status"] ?? "pending"),
    title_clear: String(r["title_status"] ?? "").toLowerCase() === "insured",
  };
}

/** Fields that must NEVER cross the wire pre-authorization. */
export const SEALED_FIELDS = [
  "address",
  "property_address",
  "street",
  "parcel_id",
  "parcel_number",
  "apn",
  "latitude",
  "longitude",
  "gps_coordinates",
  "coordinates",
  "city",
  "county",
  "owner_name",
  "seller_email",
  "seller_phone",
] as const;

/** Defense-in-depth: strip sealed keys from any outbound object graph. */
export function scrubSealed<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = Array.isArray(obj) ? [...(obj as any)] : { ...obj };
  for (const k of Object.keys(out)) {
    if ((SEALED_FIELDS as readonly string[]).includes(k)) {
      delete out[k];
      continue;
    }
    if (out[k] && typeof out[k] === "object") out[k] = scrubSealed(out[k]);
  }
  return out as T;
}

function siteUrl() {
  return process.env["PUBLIC_SITE_URL"] ?? "https://abandonedasset.online";
}

/** The hard logic gate appended to every blind broadcast. */
export function gateBlock(r: Record<string, any>) {
  return {
    address_unlocked_on_stripe_auth: true as const,
    unlock_method: "POST fully-funded PaymentIntent authorization",
    unlock_endpoint: `${siteUrl()}/api/public/checkout/create-session`,
    unlock_payload: { deal_id: r["id"], mode: "assignment_fee_authorization" },
    retail_release_countdown: retailCountdown(r["m2m_broadcast_at"] ?? r["updated_at"] ?? null),
    retail_release_at: new Date(
      Date.now() +
        Math.max(
          0,
          RETAIL_RELEASE_HOURS * 3600_000 -
            (Date.now() -
              Date.parse(String(r["m2m_broadcast_at"] ?? r["updated_at"] ?? new Date().toISOString()))),
        ),
    ).toISOString(),
  };
}

/**
 * Post-authorization delivery: coordinates + contract + Bluevine wire
 * instructions pushed straight to the paying machine's webhook.
 * Fail-forward — never throws into the Stripe lane.
 */
export async function deliverUnlockPacket(dealId: string): Promise<{
  ok: boolean;
  delivered: number;
  error?: string;
}> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("*")
      .eq("id", dealId)
      .maybeSingle();
    if (!row) return { ok: false, delivered: 0, error: "deal_not_found" };
    const r = row as Record<string, any>;

    // Which machine quoted this asset? Deliver only to those endpoints.
    const { data: quotes } = await supabaseAdmin
      .from("dispersed_quotes")
      .select("webhook_id")
      .eq("pipeline_item_id", dealId);
    const ids = [...new Set(((quotes ?? []) as any[]).map((q) => q.webhook_id).filter(Boolean))];
    if (!ids.length) return { ok: true, delivered: 0 };

    const { data: hooks } = await supabaseAdmin
      .from("institutional_webhooks")
      .select("*")
      .in("id", ids as string[]);

    const packet = {
      schema: "m2m.asset.unlock/1.0",
      asset_id: dealId,
      unlocked: true,
      unlocked_at: new Date().toISOString(),
      property: {
        address: r["address"] ?? null,
        city: r["city"] ?? null,
        state: r["state"] ?? null,
        zip: r["zip"] ?? null,
        parcel_id: r["parcel_number"] ?? r["apn"] ?? null,
        gps_coordinates: { lat: r["latitude"] ?? null, lng: r["longitude"] ?? null },
      },
      contract_url: `${siteUrl()}/api/private/m2m/settlement-binder/${dealId}`,
      wire_instructions_url: `${siteUrl()}/api/public/wire-instructions/${dealId}`,
      assignment_fee_usd: Number(r["optimized_acquisition_premium"] ?? 0) || 0,
    };

    let delivered = 0;
    await Promise.all(
      ((hooks ?? []) as Record<string, any>[]).map(async (h) => {
        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (h["outbound_api_key"]) {
            const header = String(h["auth_header"] ?? "Authorization");
            headers[header] =
              header.toLowerCase() === "authorization"
                ? `Bearer ${h["outbound_api_key"]}`
                : String(h["outbound_api_key"]);
          }
          const resp = await fetch(String(h["endpoint_url"]), {
            method: "POST",
            headers,
            body: JSON.stringify(packet),
            signal: AbortSignal.timeout(8000),
          });
          if (resp.ok) delivered++;
        } catch (e) {
          console.error("[data-gate] unlock delivery failed", h["id"], e);
        }
      }),
    );

    await supabaseAdmin
      .from("system_audit_logs")
      .insert({
        pipeline_item_id: dealId,
        event_type: "M2M_GEO_UNLOCK_DELIVERED",
        reason: `Stripe auth verified — coordinates released to ${delivered} endpoint(s)`,
        payload: { delivered, endpoints: ids.length } as never,
      } as never)
      .then(undefined, () => {});

    return { ok: true, delivered };
  } catch (e) {
    return { ok: false, delivered: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
