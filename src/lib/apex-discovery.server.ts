// Apex M2M Peering Engine — schema-morphing discovery probe (The Hunter).
// Zero human touch: find an institution's ingestion schema, map our asset keys
// to theirs, execute the handshake, and mint an ephemeral 72h peering key.
// Fail-forward: a dead target never stalls the sweep.

import { createHash } from "crypto";

const PROBE_TIMEOUT_MS = 6000;
const SCHEMA_PATHS = [
  "/.well-known/openapi.yaml",
  "/.well-known/openapi.json",
  "/openapi.json",
  "/swagger.json",
  "/api/graphql",
];
/** Scarcity lock: peering keys die in 72h unless a real bid lands. */
export const EPHEMERAL_KEY_TTL_MS = 72 * 3600_000;
/** A live bid buys 30 more days of alpha. */
export const KEY_EXTENSION_MS = 30 * 24 * 3600_000;

/** Canonical internal keys we know how to emit. */
const INTERNAL_KEYS: Record<string, string[]> = {
  asset_id: ["asset_id", "id", "property_id", "listing_id", "deal_id", "reference"],
  address_hash: ["address_hash", "address", "street", "location_hash", "parcel"],
  zip: ["zip", "zipcode", "postal_code", "postcode"],
  state: ["state", "region", "province"],
  city: ["city", "locality", "town"],
  asset_class: ["asset_class", "property_type", "asset_type", "category", "class"],
  locked_price_usd: ["locked_price_usd", "price", "amount", "ask", "list_price", "price_usd"],
  arv_usd: ["arv_usd", "arv", "after_repair_value", "valuation"],
  timber_mbf_volume: ["timber_mbf_volume", "timber_volume", "mbf", "board_feet"],
  estimated_repairs_usd: ["estimated_repairs_usd", "repairs", "rehab_budget"],
  bid_endpoint: ["bid_endpoint", "callback_url", "webhook", "reply_to", "bid_url"],
  expires_at: ["expires_at", "expiry", "valid_until", "deadline"],
};

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function get(url: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json, application/yaml, text/plain" },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const body = (await r.text()).slice(0, 400_000);
    return { status: r.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Harvest every property-ish token from an OpenAPI/Swagger/GraphQL document. */
export function extractRemoteKeys(doc: string): string[] {
  const keys = new Set<string>();
  try {
    const j = JSON.parse(doc);
    const walk = (n: any, depth = 0) => {
      if (!n || depth > 12) return;
      if (Array.isArray(n)) return n.forEach((x) => walk(x, depth + 1));
      if (typeof n !== "object") return;
      if (n.properties && typeof n.properties === "object")
        Object.keys(n.properties).forEach((k) => keys.add(k));
      if (Array.isArray(n.required)) n.required.forEach((k: string) => keys.add(String(k)));
      Object.values(n).forEach((v) => walk(v, depth + 1));
    };
    walk(j);
  } catch {
    // YAML / SDL fallback: scrape indented `key:` tokens.
    for (const m of doc.matchAll(/^\s{2,}([A-Za-z_][A-Za-z0-9_]{2,40})\s*:/gm)) keys.add(m[1]!);
  }
  return [...keys].slice(0, 400);
}

/** Map our canonical keys -> their exact JSON keys. */
export function buildSchemaMap(remoteKeys: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const index = new Map(remoteKeys.map((k) => [norm(k), k]));
  for (const [ours, aliases] of Object.entries(INTERNAL_KEYS)) {
    for (const a of aliases) {
      const hit = index.get(norm(a));
      if (hit) {
        map[ours] = hit;
        break;
      }
    }
  }
  return map;
}

/** Transform our payload into their dialect. Unmapped keys are preserved. */
export function morphPayload(
  payload: Record<string, unknown>,
  schemaMap: Record<string, string> | null | undefined,
) {
  if (!schemaMap || !Object.keys(schemaMap).length) return payload;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) out[schemaMap[k] ?? k] = v;
  return out;
}

/** Synthetic volume bait — aggregate regional ARV to trigger Tier-1 priority. */
export async function trackedLiquidity(zip?: string | null, state?: string | null) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("closing_pipeline_items")
      .select("calculated_arv")
      .is("cleared_at", null)
      .limit(2000);
    if (zip) q = q.eq("zip", zip);
    else if (state) q = q.eq("state", state);
    const { data } = await q;
    const rows = (data ?? []) as Record<string, any>[];
    const sum = rows.reduce((a, r) => a + Number(r["calculated_arv"] ?? 0), 0);
    return {
      platform_tracked_liquidity: Math.round(sum),
      tracked_assets: rows.length,
      region: zip ?? state ?? "NATIONAL",
      priority_tier: sum > 25_000_000 ? "TIER_1" : sum > 5_000_000 ? "TIER_2" : "TIER_3",
    };
  } catch {
    return { platform_tracked_liquidity: 0, tracked_assets: 0, region: "UNKNOWN", priority_tier: "TIER_3" };
  }
}

function mintKey(domain: string) {
  return createHash("sha256")
    .update(`${domain}|${Date.now()}|${Math.random()}`)
    .digest("hex")
    .slice(0, 40);
}

/** Scan one target: find schema -> morph -> handshake -> mint ephemeral key. */
export async function probeTarget(target: Record<string, any>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const domain = String(target["domain"] ?? "").replace(/\/+$/, "");
  const base = domain.startsWith("http") ? domain : `https://${domain}`;
  const now = new Date().toISOString();

  let schemaUrl: string | null = null;
  let remoteKeys: string[] = [];
  for (const p of SCHEMA_PATHS) {
    const r = await get(`${base}${p}`);
    if (!r) continue;
    const keys = extractRemoteKeys(r.body);
    if (keys.length) {
      schemaUrl = `${base}${p}`;
      remoteKeys = keys;
      break;
    }
  }

  if (!schemaUrl) {
    await supabaseAdmin
      .from("m2m_discovery_targets")
      .update({ last_scanned_at: now, last_status: "NO_SCHEMA", status: "COLD" } as never)
      .eq("id", target["id"]);
    return { domain, ok: false, reason: "no_schema" };
  }

  const schemaMap = buildSchemaMap(remoteKeys);
  const bait = await trackedLiquidity(null, target["notes"] ?? null);
  const handshake = morphPayload(
    {
      schema: "m2m.peering.handshake/1.0",
      asset_class: "MULTI",
      bid_endpoint: `${process.env["PUBLIC_SITE_URL"] ?? "https://abandonedasset.online"}/api/public/hooks/m2m-bid-receive`,
      manifest: `${process.env["PUBLIC_SITE_URL"] ?? "https://abandonedasset.online"}/.well-known/m2m-clearing.json`,
      metadata: bait,
    },
    schemaMap,
  );

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  let status: number | null = null;
  let webhookUrl: string | null = null;
  try {
    const resp = await fetch(`${base}/api/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(handshake),
      signal: ctrl.signal,
    });
    status = resp.status;
    const j: any = await resp.json().catch(() => null);
    webhookUrl = j?.webhook_url ?? j?.callback_url ?? j?.endpoint ?? null;
  } catch {
    status = null;
  } finally {
    clearTimeout(t);
  }

  await supabaseAdmin
    .from("m2m_discovery_targets")
    .update({
      last_scanned_at: now,
      last_status: status ? String(status) : "TRANSPORT_ERROR",
      schema_url: schemaUrl,
      schema_map: schemaMap as never,
      status: status === 200 ? "PEERED" : "SCHEMA_FOUND",
    } as never)
    .eq("id", target["id"]);

  if (status !== 200) return { domain, ok: false, reason: `http_${status ?? "err"}`, schemaUrl };

  const endpoint = webhookUrl ?? `${base}/api/inbound`;
  const apiKey = mintKey(base);
  await supabaseAdmin
    .from("institutional_webhooks")
    .insert({
      label: String(target["label"] ?? domain),
      endpoint_url: endpoint,
      discovery_domain: base,
      schema_url: schemaUrl,
      schema_map: schemaMap as never,
      outbound_api_key: apiKey,
      api_key_hash: createHash("sha256").update(apiKey).digest("hex"),
      expires_at: new Date(Date.now() + EPHEMERAL_KEY_TTL_MS).toISOString(),
      active: true,
      status: "HEALTHY",
    } as never)
    .then(undefined, () => {});

  return { domain, ok: true, endpoint, schemaUrl, mapped: Object.keys(schemaMap).length };
}

/** Full hunter sweep + dead-node reaper. */
export async function runApexDiscovery(limit = 15) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: { scanned: number; peered: number; dead_nodes: number; results: unknown[] } = {
    scanned: 0,
    peered: 0,
    dead_nodes: 0,
    results: [],
  };

  const { data } = await supabaseAdmin
    .from("m2m_discovery_targets")
    .select("*")
    .eq("active", true)
    .order("last_scanned_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  for (const t of (data ?? []) as Record<string, any>[]) {
    try {
      const r = await probeTarget(t);
      out.scanned += 1;
      if ((r as any).ok) out.peered += 1;
      out.results.push(r);
    } catch (e) {
      out.results.push({ domain: t["domain"], ok: false, reason: (e as Error).message });
    }
  }

  // Reaper: expired ephemeral keys that never produced a bid.
  try {
    const { data: dead } = await supabaseAdmin
      .from("institutional_webhooks")
      .update({ status: "DEAD_NODE", active: false } as never)
      .lt("expires_at", new Date().toISOString())
      .neq("status", "DEAD_NODE")
      .select("id");
    out.dead_nodes = ((dead ?? []) as unknown[]).length;
  } catch {
    /* fail-forward */
  }

  return { ok: true as const, ...out };
}

/** A real bid landed on this key — buy it 30 more days. */
export async function extendPeeringKey(webhookId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("institutional_webhooks")
      .update({
        expires_at: new Date(Date.now() + KEY_EXTENSION_MS).toISOString(),
        key_extended_at: new Date().toISOString(),
        status: "HEALTHY",
        active: true,
      } as never)
      .eq("id", webhookId);
  } catch (e) {
    console.error("[apex] key extension failed", e);
  }
}
