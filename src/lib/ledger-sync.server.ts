// Server-side ledger -> Google Sheet sync core.
// Callable from authenticated server functions AND from unattended cloud
// workers (pg_cron / DB trigger via pg_net). Fail-forward, per-batch telemetry.

export type SheetRow = {
  parcel: string;
  assetClass: string;
  valuation: number;
  advanceValue: number;
  titleHash: string;
  status: string;
  syncTimestamp: string;
};

export type LedgerSyncResult = {
  ok: boolean;
  mode: "full" | "delta";
  total: number;
  delivered: number;
  failed: number;
  syncTimestamp: string;
  url_used: string;
  errors: Array<{ batch: number; status: number; latency_ms: number; detail: string }>;
};

export async function runLedgerSync(input: {
  mode?: "full" | "delta";
  ids?: string[];
  vaultCashUsd?: number;
}): Promise<LedgerSyncResult> {
  const mode = input.mode === "delta" ? ("delta" as const) : ("full" as const);
  const ids = Array.isArray(input.ids) ? input.ids.slice(0, 5000) : [];
  const vaultCashUsd = Number(input.vaultCashUsd) || 0;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { advanceValue, attestAsset } = await import("@/lib/collateral-attest");

  const { data: cfg } = await supabaseAdmin
    .from("system_config")
    .select("value")
    .eq("key", "ledger_webhook_url")
    .maybeSingle();
  const url =
    (cfg as any)?.value?.url ??
    (typeof (cfg as any)?.value === "string" ? (cfg as any).value : null);
  if (!url) throw new Error("No Google Sheets webhook URL configured");

  const rows: any[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 10_000; from += PAGE) {
    let q = supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id, apn, parcel_number, address, asset_class, asset_type, base_contract_price, optimized_acquisition_premium, status, verification_status, m2m_asset_hash",
      )
      .is("cleared_at", null)
      .order("base_contract_price", { ascending: false })
      .range(from, from + PAGE - 1);
    if (mode === "delta" && ids.length) q = q.in("id", ids);
    const { data: page, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...(page ?? []));
    if (!page || page.length < PAGE) break;
    if (mode === "delta") break;
  }

  const syncTimestamp = new Date().toISOString();
  const payloadRows: SheetRow[] = [];
  for (const r of rows) {
    const valuation = Number(r.base_contract_price) || 0;
    const assetClass = r.asset_class ?? r.asset_type ?? "UNCLASSIFIED";
    const parcel = r.parcel_number ?? r.apn ?? r.address ?? r.id;
    const titleHash =
      r.m2m_asset_hash ??
      (await attestAsset({
        id: r.id,
        parcel_id: r.parcel_number ?? r.apn ?? null,
        asset_class: assetClass,
        valuation,
      }));
    payloadRows.push({
      parcel,
      assetClass,
      valuation,
      advanceValue: Math.round(advanceValue(assetClass, valuation) * 100) / 100,
      titleHash,
      status: String(r.verification_status ?? r.status ?? "UNVERIFIED")
        .toUpperCase()
        .replace(/-/g, "_"),
      syncTimestamp,
    });
  }

  let delivered = 0;
  let failed = 0;
  const errors: LedgerSyncResult["errors"] = [];
  const CHUNK = 50;
  const { signM2M } = await import("@/lib/m2m-protocol.server");

  for (let i = 0; i < payloadRows.length; i += CHUNK) {
    const batch = payloadRows.slice(i, i + CHUNK);
    const batchIndex = Math.floor(i / CHUNK) + 1;
    const started = Date.now();
    try {
      const body = JSON.stringify({
        event: mode === "full" ? "ledger.full_sync" : "ledger.delta_sync",
        syncTimestamp,
        vaultCashUsd,
        batch: { index: batchIndex, size: batch.length, total: payloadRows.length },
        columns: [
          "parcel",
          "assetClass",
          "valuation",
          "advanceValue",
          "titleHash",
          "status",
          "syncTimestamp",
        ],
        items: batch.map((r) => ({
          parcel: r.parcel || "",
          assetClass: r.assetClass || "RESIDENTIAL",
          valuation: r.valuation ?? 0,
          advanceValue: r.advanceValue ?? 0,
          titleHash: r.titleHash || "",
          status: r.status || "UNVERIFIED",
          syncTimestamp: new Date().toISOString(),
        })),
        rows: batch,
      });
      const sig = signM2M(body);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
          ...(sig ? { "X-M2M-Signature": `sha256=${sig}` } : {}),
        },
        body,
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
      });
      const text = await res.text().catch(() => "");
      const softFail = /"?(error|exception)"?\s*[:=]/i.test(text) && !/"ok"\s*:\s*true/i.test(text);
      if (res.ok && !softFail) delivered += batch.length;
      else {
        failed += batch.length;
        errors.push({
          batch: batchIndex,
          status: res.status,
          latency_ms: Date.now() - started,
          detail: text.slice(0, 400) || res.statusText || "empty response",
        });
      }
    } catch (e) {
      failed += batch.length;
      errors.push({
        batch: batchIndex,
        status: 0,
        latency_ms: Date.now() - started,
        detail: (e as Error).message,
      });
    }
  }

  if (errors.length) console.error("[ledger-sync] rejected batches", errors);

  return {
    ok: failed === 0,
    mode,
    total: payloadRows.length,
    delivered,
    failed,
    syncTimestamp,
    url_used: url,
    errors: errors.slice(0, 10),
  };
}
