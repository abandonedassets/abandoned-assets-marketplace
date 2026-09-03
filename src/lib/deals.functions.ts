import { createServerFn } from "@tanstack/react-start";

export type Deal = {
  id: string;
  zip: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  year_built: number | null;
  base_contract_price: number;
  optimized_acquisition_premium: number;
  status: string;
  escrow_status: string | null;
  verification_status: string | null;
  locked_at: string | null;
  cleared_at: string | null;
  cleared_amount: number | null;
  created_at: string;
  updated_at: string;
  auto_clearance_ready: boolean;
  title_status: string | null;
  apn: string | null;
  payout_status: string | null;
  payout_provider: string | null;
  payout_provider_transfer_id: string | null;
  asset_class: string;
  target_fee: number;
  projected_cap_rate: number;
  reverse_strike_ready: boolean;
  signed_contract_hash: string | null;
  verified_counterparty_id: string | null;
  title_escrow_file_number: string | null;
  contract_mode: string | null;
  m2m_expires_at: string | null;
};

export type FeedEvent = {
  id: string;
  zip: string;
  kind: "matched" | "locked" | "title_pending" | "cleared" | "new";
  amount: number;
  at: string;
};

export type ZipVelocity = {
  zip: string;
  cleared_count: number;
  cleared_usd: number;
  avg_settlement_ms: number | null;
};

export type PayoutBucket = { hour: string; cleared_usd: number; count: number };

export type DealsSummary = {
  deals: Deal[];
  total_pipeline_value: number;
  total_assignment_fees: number;
  fees_cleared: number;
  fees_in_escrow: number;
  fees_in_transit: number;
  high_risk_count: number;
  watch_count: number;
  contracts_secured: number;
  algos_connected: number;
  deal_count: number;
  bid_depth_usd: number;
  shadow_depth_usd: number;
  shadow_queue_count: number;
  shadow_queue_usd: number;
  feed: FeedEvent[];
  payout_velocity: PayoutBucket[];
  asset_velocity_per_hour: number;
  capital_velocity_per_hour: number;
  m2m_exec_count_24h: number;
  m2m_cleared_usd_24h: number;
  m2m_avg_latency_ms: number | null;
  m2m_tif_expired_24h: number;
  zip_velocity: ZipVelocity[];
  stale_count: number;
  manual_review_count: number;
  schema_ok: boolean;
  schema_error: string | null;
  error_code: string | null;
  request_id: string;
  build_id: string;
};

// Non-secret build identifier so a response can be traced to a deployed build.
export const TERMINAL_BUILD_ID =
  (import.meta as any).env?.VITE_BUILD_ID ?? "terminal-2026-08-22.1";

/** Bounded read: never let one dependency hang the terminal. */
async function bounded<T>(
  op: string,
  requestId: string,
  fn: () => PromiseLike<{ data: T | null; error: unknown }>,
  ms = 6000,
): Promise<T | null> {
  const started = Date.now();
  try {
    const res = await Promise.race([
      Promise.resolve(fn()),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("DEPENDENCY_TIMEOUT")), ms),
      ),
    ]);
    if ((res as any)?.error) {
      console.error(
        `[terminal] op=${op} req=${requestId} build=${TERMINAL_BUILD_ID} ms=${Date.now() - started} err=${String((res as any).error?.message ?? (res as any).error)}`,
      );
      return null;
    }
    return ((res as any)?.data ?? null) as T | null;
  } catch (e) {
    console.error(
      `[terminal] op=${op} req=${requestId} build=${TERMINAL_BUILD_ID} ms=${Date.now() - started} err=${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}


export const getAllDeals = createServerFn({ method: "GET" }).handler(
  async (): Promise<DealsSummary> => {
    const requestId = crypto.randomUUID();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );


    const empty: DealsSummary = {
      deals: [],
      total_pipeline_value: 0,
      total_assignment_fees: 0,
      fees_cleared: 0,
      fees_in_escrow: 0,
      fees_in_transit: 0,
      high_risk_count: 0,
      watch_count: 0,
      contracts_secured: 0,
      algos_connected: 0,
      deal_count: 0,
      bid_depth_usd: 0,
      shadow_depth_usd: 0,
      shadow_queue_count: 0,
      shadow_queue_usd: 0,
      feed: [],
      payout_velocity: [],
      asset_velocity_per_hour: 0,
      capital_velocity_per_hour: 0,
      m2m_exec_count_24h: 0,
      m2m_cleared_usd_24h: 0,
      m2m_avg_latency_ms: null,
      m2m_tif_expired_24h: 0,
      zip_velocity: [],
      stale_count: 0,
      manual_review_count: 0,
      schema_ok: false,
      schema_error: null,
      error_code: null,
      request_id: requestId,
      build_id: TERMINAL_BUILD_ID,
    };


    const q = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id, zip, beds, baths, sqft, year_built, base_contract_price, optimized_acquisition_premium, status, escrow_status, verification_status, locked_at, cleared_at, cleared_amount, created_at, updated_at, auto_clearance_ready, asset_type, zoning_category, enrichment_tags, acreage, timber_density_score, calculated_arv, estimated_repairs, address, title_status, apn, payout_status, payout_provider, payout_provider_transfer_id, signed_contract_hash, verified_counterparty_id, title_escrow_file_number, contract_structure, contract_payload, m2m_expires_at",
      )
      .order("updated_at", { ascending: false })
      .limit(1500)
      .abortSignal(AbortSignal.timeout(12_000))
      .then(
        (r) => r,
        (e: unknown) => ({
          data: null,
          error: { message: e instanceof Error ? e.message : String(e) },
        }),
      );
    const { data, error } = q as { data: any[] | null; error: { message: string } | null };

    if (error) {
      const timedOut = /timeout|abort/i.test(error.message);
      console.error(
        `[terminal] op=closing_pipeline_items req=${requestId} build=${TERMINAL_BUILD_ID} err=${error.message}`,
      );
      return {
        ...empty,
        schema_error: timedOut
          ? `Terminal data temporarily unavailable (TERMINAL_DATA_TIMEOUT · req ${requestId})`
          : `Query Error: ${error.message}`,
        error_code: timedOut ? "TERMINAL_DATA_TIMEOUT" : "TERMINAL_QUERY_ERROR",
      };
    }


    const viewerIsAdmin = await (await import("@/lib/optional-admin.server")).isCallerAdmin();
    const { computeFeeMath } = await import("@/lib/fee-matrix");
    const { parseDealPayload } = await import("@/lib/deal-payload");
    const deals: Deal[] = (data ?? []).map((r: any) => {
      const price = Number(r.base_contract_price) || 0;
      const fm = computeFeeMath({
        price,
        arv: Number(r.calculated_arv) || Math.round(price * 1.25),
        repairs: r.estimated_repairs,
        asset: {
          asset_type: r.asset_type,
          zoning_category: r.zoning_category,
          enrichment_tags: r.enrichment_tags,
          address: r.address,
          sqft: r.sqft,
          acreage: r.acreage,
          timber_density_score: r.timber_density_score,
        },
      });
      const parsedPayload = parseDealPayload(r.contract_payload);
      const contractMode = String(r.contract_structure ?? parsedPayload.contractMode ?? "")
        .trim()
        .toUpperCase() || null;
      const fee = Number(r.optimized_acquisition_premium) || parsedPayload.fee;
      const isDoubleClose = contractMode === "DOUBLE_CLOSE";
      const settled = r.status === "Funds-Cleared" || r.status === "Closed" || !!r.cleared_at;
      // A legacy/unpriced row (fee 0) is NOT automatically a reverse strike:
      // if the spread supports the asset-class target fee, it prices at target.
      const calcFee = fee > 0 ? fee : fm.is_fee_positive ? fm.target_fee : 0;
      return ({
      id: r.id,
      zip: r.zip,
      beds: r.beds,
      baths: r.baths !== null ? Number(r.baths) : null,
      sqft: r.sqft,
      year_built: r.year_built,
      base_contract_price: Number(r.base_contract_price) || 0,
      optimized_acquisition_premium: fee,
      // Settled rows keep their terminal status — never relabel cleared money.
      status: isDoubleClose && !settled ? "REVERSE_STRIKE_READY" : r.status,
      escrow_status: r.escrow_status,
      verification_status: r.verification_status ?? null,
      locked_at: r.locked_at,
      cleared_at: r.cleared_at,
      cleared_amount: r.cleared_amount !== null ? Number(r.cleared_amount) : null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      auto_clearance_ready: Boolean(r.auto_clearance_ready),
      title_status: r.title_status ?? null,
      apn: viewerIsAdmin ? (r.apn ?? null) : null,
      payout_status: r.payout_status ?? null,
      payout_provider: r.payout_provider ?? null,
      payout_provider_transfer_id: r.payout_provider_transfer_id ?? null,
      signed_contract_hash: viewerIsAdmin ? (r.signed_contract_hash ?? null) : null,
      verified_counterparty_id: viewerIsAdmin ? (r.verified_counterparty_id ?? null) : null,
      title_escrow_file_number: viewerIsAdmin ? (r.title_escrow_file_number ?? null) : null,
      contract_mode: contractMode,
      m2m_expires_at: r.m2m_expires_at ?? null,
      asset_class: fm.asset_class,
      target_fee: fm.target_fee,
      projected_cap_rate: fm.projected_cap_rate,
      // Counter-offer engine only owns assets whose economics cannot carry
      // the asset-class fee floor.
      reverse_strike_ready:
        !settled &&
        (isDoubleClose || (fm.target_fee > 0 && (calcFee < fm.target_fee || !fm.is_fee_positive))),
    });
    });

    const active = deals.filter(
      (d) =>
        d.status !== "Closed" &&
        d.status !== "Dead" &&
        d.status !== "Funds-Cleared",
    );

    const total_pipeline_value = active.reduce(
      (s, d) => s + d.base_contract_price + d.optimized_acquisition_premium,
      0,
    );
    const total_assignment_fees = active.reduce(
      (s, d) => s + d.optimized_acquisition_premium,
      0,
    );

    // Reconciliation Watchdog: pre-calculated totals from system_metrics
    // (source of truth, refreshed by cron + trigger). Fallback to live SUM
    // if the watchdog row is missing.
    const metricsRows = await bounded<any[]>("system_metrics", requestId, () =>
      supabaseAdmin
        .from("system_metrics")
        .select("metric_name, metric_value")
        .in("metric_name", ["fees_in_escrow", "fees_cleared"])
        .limit(50)
        .abortSignal(AbortSignal.timeout(5000)),
    );

    const metricMap = new Map(
      (metricsRows ?? []).map(
        (m: { metric_name: string; metric_value: number | string }) => [
          m.metric_name,
          Number(m.metric_value),
        ],
      ),
    );

    // Settlement Terminal binding: "Locked in Escrow" = fees on deals whose
    // EMD is pending or confirmed (plus legacy escrow-pending status rows).
    const escrowBound = deals.filter(
      (d) =>
        d.escrow_status === "EMD_PENDING" ||
        d.escrow_status === "EMD_CONFIRMED" ||
        d.status === "Locked-Escrow-Pending",
    );
    const escrowBoundUsd = escrowBound.reduce(
      (s, d) => s + d.optimized_acquisition_premium,
      0,
    );
    const fees_in_escrow =
      escrowBoundUsd > 0
        ? escrowBoundUsd
        : (metricMap.get("fees_in_escrow") ?? 0);


    const fees_cleared =
      metricMap.get("fees_cleared") ??
      deals
        .filter((d) => d.status === "Funds-Cleared" || d.cleared_at)
        .reduce(
          (s, d) => s + (d.cleared_amount ?? d.optimized_acquisition_premium),
          0,
        );

    const contracts_secured = active.length;

    const keysData = await bounded<any[]>("institutional_api_keys", requestId, () =>
      supabaseAdmin
        .from("institutional_api_keys")
        .select("id, is_active")
        .eq("is_active", true)
        .limit(500)
        .abortSignal(AbortSignal.timeout(5000)),
    );
    const activeKeys = (keysData ?? []) as any[];
    const algos = activeKeys.length;

    // Bid depth = declared capital across live standing buy boxes.
    const depthData = await bounded<any[]>("buyer_buy_boxes_depth", requestId, () =>
      supabaseAdmin
        .from("buyer_buy_boxes")
        .select("capital_to_deploy_usd")
        .eq("active", true)
        .is("deprecated_at", null)
        .limit(1000)
        .abortSignal(AbortSignal.timeout(5000)),
    );
    const bid_depth_usd = ((depthData ?? []) as any[]).reduce(
      (s, b) => s + Number(b.capital_to_deploy_usd ?? 0),
      0,
    );


    // Shadow liquidity from waitlist AUM brackets ("$50M-$250M", "$1B+", etc.)
    const waitData = await bounded<any[]>("buyer_waitlist", requestId, () =>
      supabaseAdmin
        .from("buyer_waitlist")
        .select("aum_bracket, status")
        .eq("status", "pending")
        .limit(1000)
        .abortSignal(AbortSignal.timeout(5000)),
    );
    const parseBracket = (s: string | null): number => {
      if (!s) return 0;
      const nums = Array.from(s.matchAll(/(\d+(?:\.\d+)?)\s*([MBmb])?/g));
      if (nums.length === 0) return 0;
      const toUsd = (m: RegExpMatchArray) => {
        const n = parseFloat(m[1]);
        const unit = (m[2] ?? "M").toUpperCase();
        return n * (unit === "B" ? 1_000_000_000 : 1_000_000);
      };
      const vals = nums.map(toUsd);
      if (vals.length >= 2) return (vals[0] + vals[1]) / 2;
      return vals[0];
    };
    const waitlistDepth = (waitData ?? []).reduce(
      (s: number, r: any) => s + parseBracket(r.aum_bracket),
      0,
    );

    // Pre-allocated institutional capital sitting in the shadow liquidity queue.
    const slqData = await bounded<any[]>("shadow_liquidity_queue", requestId, () =>
      supabaseAdmin
        .from("shadow_liquidity_queue")
        .select("allocated_capital_usd, max_purchase_price, is_active")
        .eq("is_active", true)
        .limit(1000)
        .abortSignal(AbortSignal.timeout(5000)),
    );
    const slq = (slqData ?? []) as any[];
    let shadow_queue_count = slq.length;
    let shadow_queue_usd = slq.reduce(
      (s, r) => s + Number(r.allocated_capital_usd ?? r.max_purchase_price ?? 0),
      0,
    );

    // Standing institutional buy boxes also count as live liquidity depth.
    try {
      const bb = await bounded<any[]>("buyer_buy_boxes", requestId, () =>
        supabaseAdmin
          .from("buyer_buy_boxes")
          .select("capital_to_deploy_usd, max_contract_price, active")
          .eq("active", true)
          .is("deprecated_at", null)
          .limit(1000)
          .abortSignal(AbortSignal.timeout(5000)),
      );
      const rows = (bb ?? []) as any[];
      shadow_queue_count += rows.length;
      shadow_queue_usd += rows.reduce(
        (s, r) => s + Number(r.capital_to_deploy_usd ?? r.max_contract_price ?? 0),
        0,
      );
    } catch (e) {
      console.error("[deals] buy box depth failed", e);
    }

    const shadow_depth_usd = waitlistDepth + shadow_queue_usd;


    // 24h velocity buckets (UTC hours)
    const now = Date.now();
    const buckets = new Map<string, PayoutBucket>();
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now - i * 3_600_000);
      d.setMinutes(0, 0, 0);
      const key = d.toISOString();
      buckets.set(key, { hour: key, cleared_usd: 0, count: 0 });
    }
    const zipAgg = new Map<string, { count: number; usd: number; latSum: number; latN: number }>();
    let totalLast24Usd = 0;
    let totalLast24Count = 0;
    for (const d of deals) {
      if (!d.cleared_at) continue;
      const t = new Date(d.cleared_at).getTime();
      if (now - t > 24 * 3_600_000) continue;
      const bk = new Date(t);
      bk.setMinutes(0, 0, 0);
      const key = bk.toISOString();
      const b = buckets.get(key);
      const amt = d.cleared_amount ?? d.optimized_acquisition_premium;
      if (b) {
        b.cleared_usd += amt;
        b.count += 1;
      }
      totalLast24Usd += amt;
      totalLast24Count += 1;
      const z = zipAgg.get(d.zip) ?? { count: 0, usd: 0, latSum: 0, latN: 0 };
      z.count += 1;
      z.usd += amt;
      if (d.locked_at) {
        z.latSum += t - new Date(d.locked_at).getTime();
        z.latN += 1;
      }
      zipAgg.set(d.zip, z);
    }
    const payout_velocity = Array.from(buckets.values());
    const asset_velocity_per_hour = +(totalLast24Count / 24).toFixed(2);
    const capital_velocity_per_hour = Math.round(totalLast24Usd / 24);
    // M2M headless execution telemetry (24h trailing).
    let m2m_exec_count_24h = 0;
    let m2m_cleared_usd_24h = 0;
    let m2m_avg_latency_ms: number | null = null;
    let m2m_tif_expired_24h = 0;
    try {
      const m2m = await bounded<any[]>("m2m_executions", requestId, () =>
        supabaseAdmin
          .from("m2m_executions")
          .select("status, amount_usd, latency_ms")
          .gte("created_at", new Date(now - 24 * 3_600_000).toISOString())
          .limit(2000)
          .abortSignal(AbortSignal.timeout(5000)),
      );
      const rows = (m2m as any[]) ?? [];
      const cleared = rows.filter((r) => r.status === "Cleared");
      m2m_exec_count_24h = cleared.length;
      m2m_cleared_usd_24h = cleared.reduce((a, r) => a + (Number(r.amount_usd) || 0), 0);
      const lat = cleared.map((r) => Number(r.latency_ms) || 0).filter((n) => n > 0);
      m2m_avg_latency_ms = lat.length
        ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length)
        : null;
      m2m_tif_expired_24h = rows.filter((r) => r.status === "TIF_Expired").length;
    } catch (e) {
      console.error("[deals] m2m telemetry failed", e);
    }

    const zip_velocity: ZipVelocity[] = Array.from(zipAgg.entries())
      .map(([zip, v]) => ({
        zip,
        cleared_count: v.count,
        cleared_usd: v.usd,
        avg_settlement_ms: v.latN > 0 ? Math.round(v.latSum / v.latN) : null,
      }))
      .sort((a, b) => b.cleared_usd - a.cleared_usd)
      .slice(0, 8);

    const stale_count = deals.filter((d: any) => (d as any).is_stale).length;
    // manual_review not in selected columns — fetch a count cheaply
    const manualRes = await bounded<any>("manual_review_count", requestId, async () => {
      const r = await supabaseAdmin
        .from("closing_pipeline_items")
        .select("id", { count: "estimated", head: true })
        .eq("manual_review" as any, true)
        .not("status", "in", "(Rejected,Dead,Auto_Archived_Bad_Data,Closed)")
        .abortSignal(AbortSignal.timeout(5000));
      return { data: r.count ?? 0, error: r.error };
    });
    const manual_review_count = Number(manualRes ?? 0);

    // Build live feed: most recent state changes
    const feed: FeedEvent[] = deals
      .map((d): FeedEvent | null => {
        const fee = d.optimized_acquisition_premium;
        if (d.status === "Funds-Cleared" && d.cleared_at) {
          return { id: d.id, zip: d.zip, kind: "cleared", amount: d.cleared_amount ?? fee, at: d.cleared_at };
        }
        if (d.status === "Locked-Escrow-Pending" && d.locked_at) {
          return { id: d.id, zip: d.zip, kind: "locked", amount: fee, at: d.locked_at };
        }
        if (d.status === "In-Escrow") {
          return { id: d.id, zip: d.zip, kind: "title_pending", amount: fee, at: d.updated_at };
        }
        if (d.status === "Buyer-Signed" || d.status === "Seller-Signed") {
          return { id: d.id, zip: d.zip, kind: "matched", amount: fee, at: d.updated_at };
        }
        if (d.status === "New") {
          return { id: d.id, zip: d.zip, kind: "new", amount: fee, at: d.created_at };
        }
        return null;
      })
      .filter((x): x is FeedEvent => x !== null)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 20);

    // Database intelligence layer: read risk_flag from view_pipeline_health
    let high_risk_count = 0;
    let watch_count = 0;
    let fees_in_transit = 0;
    try {
      const healthRows = await bounded<any[]>("view_pipeline_health", requestId, () =>
        supabaseAdmin
          .from("view_pipeline_health" as any)
          .select(
            "risk_flag, status, escrow_status, optimized_acquisition_premium, cleared_amount, cleared_at",
          )
          .limit(3000)
          .abortSignal(AbortSignal.timeout(6000)),
      );
      for (const r of (healthRows ?? []) as any[]) {
        if (r.risk_flag === "HIGH_RISK") high_risk_count++;
        else if (r.risk_flag === "WATCH") watch_count++;
        // Fees in transit = cleared via Bluevine but not yet settled to bank (T+2)
        if (r.cleared_at) {
          const clearedAt = new Date(r.cleared_at).getTime();
          const ageDays = (Date.now() - clearedAt) / 86400000;
          if (ageDays < 2) {
            fees_in_transit += Number(r.cleared_amount ?? r.optimized_acquisition_premium ?? 0);
          }
        }
      }
    } catch {
      // graceful degrade — never block dashboard
    }

    return {
      deals,
      total_pipeline_value,
      total_assignment_fees,
      fees_cleared,
      fees_in_escrow,
      fees_in_transit,
      high_risk_count,
      watch_count,
      contracts_secured,
      algos_connected: algos,
      deal_count: deals.length,
      bid_depth_usd,
      shadow_depth_usd,
      shadow_queue_count,
      shadow_queue_usd,
      feed,
      payout_velocity,
      asset_velocity_per_hour,
      capital_velocity_per_hour,
      m2m_exec_count_24h,
      m2m_cleared_usd_24h,
      m2m_avg_latency_ms,
      m2m_tif_expired_24h,
      zip_velocity,
      stale_count,
      manual_review_count,
      schema_ok: true,
      schema_error: null,
      error_code: null,
      request_id: requestId,
      build_id: TERMINAL_BUILD_ID,
    };
  },
);

