// Composite Quality Score + Monte Carlo VaR + market-regime calibration.
// Deterministic, dependency-free, fail-forward: never throws, never stalls a row.

export type ScoreInputs = {
  zip?: string | null;
  assessed_value?: number | null; // ARV
  estimated_repairs?: number | null;
  base_contract_price?: number | null;
  optimized_acquisition_premium?: number | null;
  estimated_cap_rate?: number | null;
  year_built?: number | null;
  sqft?: number | null;
  days_owned?: number | null;
  lien_total?: number | null;
  annual_property_tax?: number | null;
  confidence_score?: number | null;
};

export type Regime = {
  regime: "EXPANSION" | "NEUTRAL" | "SQUEEZE";
  cap_rate_uplift_bps: number;
};

const W = {
  discount: 0.34, // discount to replacement cost
  yieldDelta: 0.26, // cap rate vs. regime hurdle
  maturity: 0.16, // owner debt/maturity pressure proxy
  compression: 0.14, // submarket cap-rate compression velocity proxy
  confidence: 0.10,
};

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** Replacement cost proxy: $145/sqft + land floor. */
function replacementCost(i: ScoreInputs): number {
  const sqft = Number(i.sqft) || 0;
  return sqft > 0 ? sqft * 145 : Number(i.assessed_value) || 0;
}

/** Owner debt-maturity / holding-pressure proxy from tenure + liens + tax burden. */
function maturityPressure(i: ScoreInputs): number {
  const days = Number(i.days_owned) || 0;
  const tenure = clamp01(days / 3650); // 10y tenure = max pressure
  const arv = Number(i.assessed_value) || 0;
  const lien = arv > 0 ? clamp01((Number(i.lien_total) || 0) / arv) : 0;
  const tax = arv > 0 ? clamp01(((Number(i.annual_property_tax) || 0) * 12) / arv) : 0;
  return clamp01(tenure * 0.5 + lien * 0.3 + tax * 0.2);
}

/** Hyper-local cap-rate compression velocity proxy (vintage + density stand-in). */
function compressionVelocity(i: ScoreInputs): number {
  const yb = Number(i.year_built) || 0;
  if (!yb) return 0.4;
  return clamp01((yb - 1940) / 85);
}

export function marketHurdle(regime: Regime): number {
  return 0.06 + (Number(regime.cap_rate_uplift_bps) || 0) / 10000;
}

/** S_d = Σ w_i·f(c_i) + λ·YieldDelta, scaled 0-100. */
export function compositeScore(
  i: ScoreInputs,
  regime: Regime,
  submarketWeight = 1,
): { composite_score: number; yield_delta: number } {
  try {
    const arv = Number(i.assessed_value) || 0;
    const total = (Number(i.base_contract_price) || 0) + (Number(i.optimized_acquisition_premium) || 0);
    const rc = replacementCost(i);
    const discount = rc > 0 && total > 0 ? clamp01(1 - total / rc) : 0;
    const cap = Number(i.estimated_cap_rate) || 0;
    const yieldDelta = Number((cap - marketHurdle(regime)).toFixed(4));
    const yieldTerm = clamp01(0.5 + yieldDelta * 10);
    const conf = clamp01((Number(i.confidence_score) || 0) / 100);

    const raw =
      W.discount * discount +
      W.yieldDelta * yieldTerm +
      W.maturity * maturityPressure(i) +
      W.compression * compressionVelocity(i) +
      W.confidence * conf;

    const adj = clamp01(raw * (Number(submarketWeight) || 1));
    void arv;
    return { composite_score: Number((adj * 100).toFixed(2)), yield_delta: yieldDelta };
  } catch {
    return { composite_score: 0, yield_delta: 0 };
  }
}

/* ---------------- Monte Carlo stress engine ---------------- */

/** Deterministic PRNG so identical inputs always produce identical risk metrics. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (r: () => number) =>
  Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

export type RiskMetrics = {
  risk_var_95: number;
  uw_ci_low: number;
  uw_ci_high: number;
  iterations: number;
};

/**
 * 10k iterations of exit-cap expansion (+50 to +200bps), refi shock at yr 3/5,
 * and hyper-local supply-driven vacancy drag against the buyer's basis.
 */
export function monteCarlo(i: ScoreInputs, seedStr = "", iterations = 10000): RiskMetrics {
  try {
    const arv = Number(i.assessed_value) || 0;
    const basis =
      (Number(i.base_contract_price) || 0) + (Number(i.optimized_acquisition_premium) || 0) +
      (Number(i.estimated_repairs) || 0);
    if (arv <= 0 || basis <= 0)
      return { risk_var_95: 0, uw_ci_low: 0, uw_ci_high: 0, iterations: 0 };

    let seed = 2166136261;
    for (const ch of String(seedStr)) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
    const rnd = mulberry(seed);

    const cap0 = Number(i.estimated_cap_rate) || 0.06;
    const noi = arv * 0.007 * 12 * 0.65;
    const out: number[] = new Array(iterations);
    for (let n = 0; n < iterations; n++) {
      const expansion = (0.005 + rnd() * 0.015) * (0.6 + Math.abs(gauss(rnd)) * 0.4); // 50-200bps
      const exitCap = Math.max(0.02, cap0 + expansion);
      const vacancyDrag = 1 - clamp01(0.03 + Math.abs(gauss(rnd)) * 0.05); // supply pipeline
      const refiShock = rnd() < 0.25 ? 1 - (0.02 + rnd() * 0.06) : 1; // yr3/yr5 maturity
      const exitValue = ((noi * vacancyDrag) / exitCap) * refiShock;
      out[n] = exitValue - basis;
    }
    out.sort((a, b) => a - b);
    const at = (p: number) => Number((out[Math.floor(p * (iterations - 1))] ?? 0).toFixed(2));
    return {
      risk_var_95: Number(Math.max(0, -at(0.05)).toFixed(2)),
      uw_ci_low: at(0.05),
      uw_ci_high: at(0.95),
      iterations,
    };
  } catch {
    return { risk_var_95: 0, uw_ci_low: 0, uw_ci_high: 0, iterations: 0 };
  }
}

/* ---------------- Regime + submarket weights ---------------- */

export async function loadRegime(): Promise<Regime> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("key", "market_regime")
      .maybeSingle();
    const v = (data as { value?: Record<string, unknown> } | null)?.value ?? {};
    return {
      regime: (v['regime'] as Regime["regime"]) ?? "NEUTRAL",
      cap_rate_uplift_bps: Number(v['cap_rate_uplift_bps']) || 0,
    };
  } catch {
    return { regime: "NEUTRAL", cap_rate_uplift_bps: 0 };
  }
}

/** zip -> learned weight (penalizes submarkets a fund keeps rejecting). */
export async function loadSubmarketWeights(fundId?: string | null): Promise<Record<string, number>> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("submarket_weights").select("zip, weight, fund_id");
    if (fundId) q = q.or(`fund_id.eq.${fundId},fund_id.is.null`);
    const { data } = await q;
    const map: Record<string, number> = {};
    for (const r of (data ?? []) as { zip: string; weight: number }[]) {
      map[r.zip] = Number(r.weight) || 1;
    }
    return map;
  } catch {
    return {};
  }
}
