// Automated public-records cash-buyer discovery.
//
// For any asset that hits REVERSE_STRIKE_READY we mine recent CASH deed
// recordings in that exact ZIP (last 90 days), rank the most active LLC
// purchasers, and push blinded deal telemetry straight to them.
//
// Provider chain (fail-forward, never throws):
//   1. ATTOM sale snapshot (ATTOM_API_KEY)
//   2. Internal recorded-transaction history (closing_pipeline_items closed/cleared)
//   3. Registered buy boxes already targeting that ZIP
//
// Contact resolution: cash_deed_buyers.contact_email -> entity_contacts
// (verified) -> buyer_buy_boxes.contact_email by entity-name match.

const LOOKBACK_DAYS = 90;
const TOP_N = 5;
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type CashBuyer = {
  buyer_name: string;
  zip: string;
  city?: string | null;
  state?: string | null;
  county?: string | null;
  deed_date?: string | null;
  purchase_amount?: number | null;
  source: string;
  source_url?: string | null;
  contact_email?: string | null;
  purchases_90d?: number;
};

const clean = (v: unknown) => String(v ?? "").trim();
const isEntity = (name: string) =>
  /\b(llc|l\.l\.c|inc|corp|company|co\.|holdings|capital|properties|partners|group|trust|ventures|fund|invest)\b/i.test(
    name,
  );

function sinceIso(days = LOOKBACK_DAYS) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Tier 1 — ATTOM recorded sales                                       */
/* ------------------------------------------------------------------ */
async function attomCashBuyers(zip: string): Promise<CashBuyer[]> {
  const key = process.env["ATTOM_API_KEY"];
  if (!key) return [];
  const url = new URL(
    "https://api.gateway.attomdata.com/propertyapi/v1.0.0/sale/snapshot",
  );
  url.searchParams.set("postalcode", zip);
  url.searchParams.set("startsalesearchdate", sinceIso());
  url.searchParams.set("endsalesearchdate", new Date().toISOString().slice(0, 10));
  url.searchParams.set("pagesize", "50");

  const res = await fetch(url, {
    headers: { apikey: key, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`attom HTTP ${res.status}`);
  const json = (await res.json()) as any;

  const out: CashBuyer[] = [];
  for (const p of json?.property ?? []) {
    const name =
      clean(p?.sale?.buyer?.buyername) ||
      clean(p?.sale?.amount?.saleTransType) === "" ? clean(p?.sale?.buyer?.buyername) : "";
    const buyer = name || clean(p?.owner?.owner1?.lastname);
    if (!buyer) continue;
    const financing = clean(p?.sale?.amount?.saletranstype ?? p?.sale?.saleTransType);
    const cashish = !/mortgage|loan|financ/i.test(financing);
    if (!cashish) continue;
    out.push({
      buyer_name: buyer,
      zip,
      city: clean(p?.address?.locality) || null,
      state: clean(p?.address?.countrySubd) || null,
      county: clean(p?.area?.countrysecsubd) || null,
      deed_date: clean(p?.sale?.saleTransDate ?? p?.sale?.salesearchdate) || null,
      purchase_amount: Number(p?.sale?.amount?.saleamt ?? 0) || null,
      source: "attom_deed_snapshot",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Tier 2 + 3 — internal recorded history and registered buy boxes     */
/* ------------------------------------------------------------------ */
async function internalCashBuyers(zip: string): Promise<CashBuyer[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: CashBuyer[] = [];

  try {
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("assigned_buyer_name,assigned_buyer_email,city,state,county,zip,base_contract_price,updated_at")
      .eq("zip", zip)
      .in("status", ["Closed", "Funds-Cleared"])
      .gte("updated_at", new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString())
      .limit(50);
    for (const r of (data ?? []) as Record<string, any>[]) {
      const name = clean(r["assigned_buyer_name"]);
      if (!name) continue;
      out.push({
        buyer_name: name,
        zip,
        city: r["city"] ?? null,
        state: r["state"] ?? null,
        county: r["county"] ?? null,
        deed_date: clean(r["updated_at"]).slice(0, 10) || null,
        purchase_amount: Number(r["base_contract_price"] ?? 0) || null,
        source: "internal_recorded_transactions",
        contact_email: clean(r["assigned_buyer_email"]) || null,
      });
    }
  } catch (e) {
    console.error("[cash-buyers] internal history failed", e);
  }

  try {
    const { data } = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select("legal_name,contact_email,target_zip_codes")
      .eq("active", true)
      .is("deprecated_at", null)
      .contains("target_zip_codes", [zip])
      .limit(25);
    for (const b of (data ?? []) as Record<string, any>[]) {
      const name = clean(b["legal_name"]);
      if (!name) continue;
      out.push({
        buyer_name: name,
        zip,
        source: "registered_buy_box",
        contact_email: clean(b["contact_email"]) || null,
      });
    }
  } catch (e) {
    console.error("[cash-buyers] buy box scan failed", e);
  }

  return out;
}

/** Merge, rank by 90-day purchase count then amount, keep the top N. */
export function rankCashBuyers(rows: CashBuyer[], topN = TOP_N): CashBuyer[] {
  const map = new Map<string, CashBuyer & { purchases_90d: number }>();
  for (const r of rows) {
    const name = clean(r.buyer_name);
    if (!name) continue;
    const k = name.toLowerCase();
    const prev = map.get(k);
    if (prev) {
      prev.purchases_90d += 1;
      prev.purchase_amount = Math.max(Number(prev.purchase_amount ?? 0), Number(r.purchase_amount ?? 0)) || null;
      prev.contact_email = prev.contact_email ?? r.contact_email ?? null;
      if (!prev.deed_date && r.deed_date) prev.deed_date = r.deed_date;
    } else {
      map.set(k, { ...r, buyer_name: name, purchases_90d: r.purchases_90d ?? 1 });
    }
  }
  return [...map.values()]
    .sort(
      (a, b) =>
        b.purchases_90d - a.purchases_90d ||
        (isEntity(b.buyer_name) ? 1 : 0) - (isEntity(a.buyer_name) ? 1 : 0) ||
        Number(b.purchase_amount ?? 0) - Number(a.purchase_amount ?? 0),
    )
    .slice(0, topN);
}

/** Discover + persist the top cash buyers for a ZIP. Never throws. */
export async function discoverCashBuyers(zip: string, topN = TOP_N): Promise<CashBuyer[]> {
  const z = clean(zip).slice(0, 5);
  if (!/^\d{5}$/.test(z)) return [];
  const rows: CashBuyer[] = [];

  try {
    rows.push(...(await attomCashBuyers(z)));
  } catch (e) {
    console.error("[cash-buyers] attom failed", e);
  }
  rows.push(...(await internalCashBuyers(z)));

  const top = rankCashBuyers(rows, topN);
  if (!top.length) return [];

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (const b of top) {
      const email = b.contact_email ?? (await resolveContactEmail(b.buyer_name));
      b.contact_email = email;
      await supabaseAdmin
        .from("cash_deed_buyers")
        .upsert(
          {
            buyer_name: b.buyer_name,
            zip: z,
            city: b.city ?? null,
            state: b.state ?? null,
            county: b.county ?? null,
            deed_date: b.deed_date ?? null,
            purchase_amount: b.purchase_amount ?? null,
            source: b.source,
            contact_email: email,
            purchases_90d: b.purchases_90d ?? 1,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "buyer_name,zip", ignoreDuplicates: false } as never,
        )
        .select("id");
    }
  } catch (e) {
    console.error("[cash-buyers] persist failed", e);
  }

  return top;
}

async function resolveContactEmail(entityName: string): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("entity_contacts")
      .select("discovered_email,entity_name,verification_status")
      .ilike("entity_name", `%${entityName.slice(0, 40)}%`)
      .eq("verification_status", "verified")
      .limit(1);
    const hit = (data ?? [])[0] as Record<string, any> | undefined;
    return clean(hit?.["discovered_email"]) || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Outbound alert with blinded telemetry                               */
/* ------------------------------------------------------------------ */

export type StrikeAlertAsset = {
  id: string;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  county?: string | null;
  asset_type?: string | null;
  asset_class?: string | null;
  counter_offer?: number | null;
  calculated_arv?: number | null;
  sign_url?: string | null;
};

const usd = (n: number | null | undefined) =>
  n == null || !isFinite(Number(n)) ? "N/A" : `$${Math.round(Number(n)).toLocaleString()}`;

/**
 * Push blinded strike telemetry to the top proven cash buyers in the ZIP.
 * Fail-forward: a bad provider, bad contact, or dead mailer never stalls
 * the reverse-strike batch.
 */
export async function alertZipCashBuyers(
  asset: StrikeAlertAsset,
): Promise<{ zip: string | null; discovered: number; alerted: number; buyers: string[] }> {
  const zip = clean(asset.zip).slice(0, 5) || null;
  const out = { zip, discovered: 0, alerted: 0, buyers: [] as string[] };
  if (!zip) return out;

  try {
    const buyers = await discoverCashBuyers(zip);
    out.discovered = buyers.length;
    if (!buyers.length) return out;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendM2MEmail, jsonBlock } = await import("@/lib/email.server");

    const ref = String(asset.id).slice(0, 8).toUpperCase();
    const blind = {
      asset_ref: ref,
      market: `${asset.city ? "—" : ""}${asset.county ?? ""} ${asset.state ?? ""}`.trim() || "—",
      zip,
      asset_type: asset.asset_class ?? asset.asset_type ?? "LAND/RES",
      strike_price_usd: asset.counter_offer ?? null,
      indicative_arv_usd: asset.calculated_arv ?? null,
      settlement: "CASH · 7-DAY CLOSE · ASSIGNMENT",
      address_status: "BLINDED_UNTIL_EMD_OR_WIRE",
    };

    for (const b of buyers) {
      const to = b.contact_email;
      if (!to) continue;
      try {
        const { data: existing } = await supabaseAdmin
          .from("cash_deed_buyers")
          .select("id,last_alerted_at,alerts_sent")
          .eq("zip", zip)
          .ilike("buyer_name", b.buyer_name)
          .limit(1);
        const row = (existing ?? [])[0] as Record<string, any> | undefined;
        const last = row?.["last_alerted_at"] ? Date.parse(row["last_alerted_at"]) : 0;
        if (last && Date.now() - last < ALERT_COOLDOWN_MS) continue;

        const res = await sendM2MEmail({
          to,
          subject: `Cash strike available — ${zip} — ${usd(asset.counter_offer)}`,
          html: `<p>You recorded a cash purchase in ${zip} within the last ${LOOKBACK_DAYS} days.</p>
<p>An off-market asset in that exact ZIP has cleared underwriting at <strong>${usd(asset.counter_offer)}</strong>${
            asset.calculated_arv ? ` against an indicative ARV of <strong>${usd(asset.calculated_arv)}</strong>` : ""
          }.</p>
<p>Street address and parcel remain blinded until an earnest hold or wire instruction is posted.</p>
${asset.sign_url ? `<p>Claim: <a href="${asset.sign_url}">${asset.sign_url}</a></p>` : ""}
${jsonBlock(blind)}`,
          headers: { "X-Asset-Ref": ref, "X-Event": "cash_buyer_strike_alert" },
        });

        if (res.ok) {
          out.alerted += 1;
          out.buyers.push(b.buyer_name);
          if (row?.["id"]) {
            await supabaseAdmin
              .from("cash_deed_buyers")
              .update({
                last_alerted_at: new Date().toISOString(),
                alerts_sent: Number(row["alerts_sent"] ?? 0) + 1,
              } as never)
              .eq("id", row["id"]);
          }
        }

        await supabaseAdmin.from("outbound_alert_log").insert({
          channel: "CASH_BUYER_STRIKE_ALERT",
          status: res.ok ? "SUCCESS" : "FAILED",
          target: to,
          pipeline_item_id: asset.id,
          payload: { buyer: b.buyer_name, zip, blind } as never,
        } as never);
      } catch (e) {
        console.error("[cash-buyers] alert failed", b.buyer_name, e);
      }
    }
  } catch (e) {
    console.error("[cash-buyers] discovery failed", e);
  }

  return out;
}
