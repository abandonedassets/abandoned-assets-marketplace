// Fund Intake Syndication — push institutional deal decks straight into fund
// buy-side intake APIs so their algorithms call back /programmatic-lock.
// Endpoints come from env FUND_INTAKE_ENDPOINTS (JSON or comma list) and/or
// system_config key `fund_intake_endpoints`. Fail-forward, never throws.

export type FundEndpoint = { name: string; url: string; auth_header?: string | null };

export async function loadFundEndpoints(): Promise<FundEndpoint[]> {
  const out: FundEndpoint[] = [];
  const raw = process.env["FUND_INTAKE_ENDPOINTS"] ?? "";
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
    } catch {
      for (const url of raw.split(",").map((s) => s.trim()).filter(Boolean))
        out.push({ name: new URL(url).host, url });
    }
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("key", "fund_intake_endpoints")
      .maybeSingle();
    const val = (data as any)?.value;
    if (Array.isArray(val)) out.push(...val);
  } catch (e) {
    console.error("[fund-intake] config load failed", e);
  }
  return out.filter((e) => e?.url);
}

export async function syndicateToFunds(deck: Record<string, unknown>, dealId: string) {
  const endpoints = await loadFundEndpoints();
  const results: Array<{ name: string; ok: boolean; status?: number; error?: string }> = [];
  if (!endpoints.length) return { dispatched: 0, results, reason: "no_fund_endpoints" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { buildQuantitativeAlphaBlock, payloadIntegrityHash } = await import(
    "@/lib/quant-alpha.server"
  );

  const sealed = {
    ...deck,
    quantitative_alpha_block: buildQuantitativeAlphaBlock({
      strike_price: (deck as any)["base_contract_price"] ?? (deck as any)["strike_price"],
      assignment_fee:
        (deck as any)["assignment_fee"] ?? (deck as any)["optimized_acquisition_premium"],
      arv: (deck as any)["arv"] ?? (deck as any)["calculated_arv"],
      title_status: (deck as any)["title_status"] ?? "Insured",
    }),
  };
  const body = JSON.stringify(sealed);

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Deal-Id": dealId,
          "X-Payload-Integrity-Hash": payloadIntegrityHash(body),
          "X-Callback-Endpoint": `/api/v1/deals/${dealId}/programmatic-lock`,
          ...(ep.auth_header ? { Authorization: ep.auth_header } : {}),
        },
        body,
      });
      results.push({ name: ep.name, ok: res.ok, status: res.status });
      await supabaseAdmin.from("outbound_alert_log" as never).insert({
        pipeline_item_id: dealId,
        channel: "fund_intake",
        target: ep.name,
        status: res.ok ? "sent" : "failed",
        error: res.ok ? null : `http_${res.status}`,
        payload: { url: ep.url } as never,
      } as never);
    } catch (e) {
      results.push({ name: ep.name, ok: false, error: String(e) });
      console.error("[fund-intake] dispatch failed", ep.name, e);
    }
  }
  return { dispatched: results.filter((r) => r.ok).length, results };
}
