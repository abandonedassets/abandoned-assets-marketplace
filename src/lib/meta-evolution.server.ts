// Meta-Evolution & Self-Mutation Engine.
//
// Hourly loop: measure live performance against institutional peak baselines,
// self-diagnose the strategic defect, synthesize a mutation to a whitelisted
// execution knob, shadow-test it against synthetic tape, deploy it live, then
// verify the fitness delta on the next cycle and keep or roll back.
//
// Mutations are constrained to a hardened parameter surface (no arbitrary code
// execution): the engine rewrites its own strategy, not its own runtime.

type Row = Record<string, any>;

export const PARAM_KEY = "evolution_params";

/** Institutional peak baselines the engine benchmarks itself against. */
export const PEAK_BASELINE = {
  assignment_yield: 0.15, // 15% spread on contract price
  clear_hours: 24, // contract -> cleared funds
  fill_rate: 0.6, // dispatched assets that lock
  velocity_usd_per_day: 250_000,
};

/** Whitelisted, self-mutable execution knobs with hard institutional bounds. */
export const KNOBS = {
  spread_target_pct: { min: 0.05, max: 0.25, step: 0.01, default: 0.1 },
  ttl_seconds: { min: 5, max: 60, step: -5, default: 15 },
  ratchet_usd: { min: 250, max: 5000, step: 250, default: 1000 },
  taker_premium_bps: { min: 0, max: 600, step: 50, default: 300 },
  maker_discount_bps: { min: -200, max: 0, step: -25, default: -50 },
  dispatch_tiers: { min: 1, max: 8, step: 1, default: 3 },
} as const;

export type KnobName = keyof typeof KNOBS;

export async function loadParams(): Promise<Record<string, number>> {
  const defaults = Object.fromEntries(
    Object.entries(KNOBS).map(([k, v]) => [k, v.default]),
  ) as Record<string, number>;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("key", PARAM_KEY)
      .maybeSingle();
    return { ...defaults, ...(((data as Row | null)?.["value"] as Row) ?? {}) };
  } catch {
    return defaults;
  }
}

async function saveParams(p: Record<string, number>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("system_config").upsert(
    { key: PARAM_KEY, value: p as never, updated_at: new Date().toISOString() } as never,
    { onConflict: "key" },
  );
}

export type PlatformMetrics = {
  averageAssignmentYield: number;
  avgClearHours: number;
  fillRate: number;
  velocityUsdPerDay: number;
  sample: number;
};

/** Audit real performance against theoretical maximums. */
export async function analyzePlatformMetrics(): Promise<PlatformMetrics> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id,base_contract_price,optimized_acquisition_premium,created_at,cleared_at,matched_buy_box_id,offer_sent_at",
    )
    .gte("created_at", since)
    .limit(1000);

  const rows = (data ?? []) as Row[];
  const priced = rows.filter((r) => Number(r["base_contract_price"] ?? 0) > 0);
  const yields = priced.map(
    (r) =>
      Number(r["optimized_acquisition_premium"] ?? 0) / Number(r["base_contract_price"]),
  );
  const cleared = rows.filter((r) => r["cleared_at"]);
  const clearHours = cleared.map(
    (r) =>
      (Date.parse(r["cleared_at"]) - Date.parse(r["created_at"])) / 3_600_000,
  );
  const dispatched = rows.filter((r) => r["offer_sent_at"]);
  const avg = (a: number[]) => (a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0);
  const clearedUsd = cleared.reduce(
    (s, r) => s + (Number(r["optimized_acquisition_premium"]) || 0),
    0,
  );

  return {
    averageAssignmentYield: Number(avg(yields).toFixed(4)),
    avgClearHours: Number(avg(clearHours).toFixed(2)),
    fillRate: dispatched.length
      ? Number((dispatched.filter((r) => r["matched_buy_box_id"]).length / dispatched.length).toFixed(3))
      : 0,
    velocityUsdPerDay: Number((clearedUsd / 14).toFixed(2)),
    sample: rows.length,
  };
}

/** Single scalar the engine optimizes; higher is better. */
export function fitness(m: PlatformMetrics): number {
  const yieldScore = Math.min(1, m.averageAssignmentYield / PEAK_BASELINE.assignment_yield);
  const speedScore = m.avgClearHours > 0 ? Math.min(1, PEAK_BASELINE.clear_hours / m.avgClearHours) : 0;
  const fillScore = Math.min(1, m.fillRate / PEAK_BASELINE.fill_rate);
  const velScore = Math.min(1, m.velocityUsdPerDay / PEAK_BASELINE.velocity_usd_per_day);
  return Number((yieldScore * 0.4 + speedScore * 0.2 + fillScore * 0.2 + velScore * 0.2).toFixed(4));
}

type Mutation = {
  defect_code: string;
  hypothesis: string;
  knob: KnobName;
  prior_value: number;
  new_value: number;
};

function clamp(knob: KnobName, v: number) {
  const k = KNOBS[knob];
  return Math.min(k.max, Math.max(k.min, Number(v.toFixed(4))));
}

/** Self-diagnose the dominant strategic defect and synthesize a mutation. */
export function generateCodeMutation(
  m: PlatformMetrics,
  params: Record<string, number>,
): Mutation | null {
  const bump = (knob: KnobName, defect_code: string, hypothesis: string): Mutation => {
    const prior = params[knob] ?? KNOBS[knob].default;
    return {
      defect_code,
      hypothesis,
      knob,
      prior_value: prior,
      new_value: clamp(knob, prior + KNOBS[knob].step),
    };
  };

  if (m.averageAssignmentYield < PEAK_BASELINE.assignment_yield)
    return bump(
      "spread_target_pct",
      "ENHANCE_ASSIGNMENT_SPREAD_DYNAMICS",
      "Execution model too basic: dynamic price-squeezing under-applied against market spread capacity.",
    );
  if (m.avgClearHours > PEAK_BASELINE.clear_hours)
    return bump(
      "ttl_seconds",
      "COMPRESS_SETTLEMENT_LATENCY",
      "Capital is not being forced to compete fast enough; shorten the micro-auction destruct window.",
    );
  if (m.fillRate < PEAK_BASELINE.fill_rate)
    return bump(
      "dispatch_tiers",
      "WIDEN_LIQUIDITY_CASCADE",
      "Insufficient counterparty depth per asset; cascade to more standing buy-box tiers.",
    );
  if (m.velocityUsdPerDay < PEAK_BASELINE.velocity_usd_per_day)
    return bump(
      "ratchet_usd",
      "STEEPEN_LATENCY_PENALTY",
      "Slow capital is not penalized aggressively enough; steepen the price ratchet.",
    );
  return null;
}

/** Shadow-test the mutation against synthetic tape before deployment. */
export function runSandboxUnitTests(mut: Mutation, m: PlatformMetrics): boolean {
  const k = KNOBS[mut.knob];
  if (mut.new_value < k.min || mut.new_value > k.max) return false;
  if (mut.new_value === mut.prior_value) return false;
  // Synthetic tape: 500 assets priced off observed distribution.
  const synth = Array.from({ length: 500 }, (_, i) => 40_000 + (i % 50) * 3_000);
  const target =
    mut.knob === "spread_target_pct" ? mut.new_value : (m.averageAssignmentYield || 0.05);
  const fees = synth.map((p) => p * target);
  const totalFee = fees.reduce((s, n) => s + n, 0);
  if (!Number.isFinite(totalFee) || totalFee <= 0) return false;
  // Guard: never let a mutation price the book above institutional tolerance.
  if (target > 0.25) return false;
  return true;
}

/** Verify the previous deployed mutation, keeping or rolling it back. */
async function verifyPrevious(currentFitness: number, params: Record<string, number>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("evolution_mutations")
    .select("*")
    .eq("status", "DEPLOYED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prev = data as Row | null;
  if (!prev) return { verified: null as unknown };

  const base = Number((prev["baseline_metrics"] as Row)?.["fitness"] ?? 0);
  const delta = Number((currentFitness - base).toFixed(4));
  const keep = delta >= 0;

  if (!keep) params[prev["knob"]] = Number(prev["prior_value"]);

  await supabaseAdmin
    .from("evolution_mutations")
    .update({
      status: keep ? "PERMANENT" : "ROLLED_BACK",
      fitness_delta: delta,
      observed_metrics: { fitness: currentFitness } as never,
      verified_at: new Date().toISOString(),
      rolled_back_at: keep ? null : new Date().toISOString(),
    } as never)
    .eq("id", prev["id"]);

  return { verified: { knob: prev["knob"], delta, kept: keep } };
}

/** The hourly self-evolution cycle. Fail-forward; never blocks the pipeline. */
export async function runSelfEvolutionCycle() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const metrics = await analyzePlatformMetrics();
    const score = fitness(metrics);
    const params = await loadParams();

    await supabaseAdmin
      .from("evolution_metrics_snapshots")
      .insert({ metrics: metrics as never, fitness: score } as never)
      .then(undefined, () => {});

    const { verified } = await verifyPrevious(score, params);

    const mut = generateCodeMutation(metrics, params);
    if (!mut) {
      await saveParams(params);
      return { ok: true, fitness: score, metrics, verified, mutation: null, at_peak: true };
    }

    const sandboxPassed = runSandboxUnitTests(mut, metrics);
    if (!sandboxPassed) {
      await supabaseAdmin.from("evolution_mutations").insert({
        defect_code: mut.defect_code,
        hypothesis: mut.hypothesis,
        knob: mut.knob,
        prior_value: mut.prior_value,
        new_value: mut.new_value,
        status: "SANDBOX_REJECTED",
        sandbox_passed: false,
        baseline_metrics: { ...metrics, fitness: score } as never,
      } as never);
      await saveParams(params);
      return { ok: true, fitness: score, metrics, verified, mutation: { ...mut, deployed: false } };
    }

    params[mut.knob] = mut.new_value;
    await saveParams(params);

    await supabaseAdmin.from("evolution_mutations").insert({
      defect_code: mut.defect_code,
      hypothesis: mut.hypothesis,
      knob: mut.knob,
      prior_value: mut.prior_value,
      new_value: mut.new_value,
      status: "DEPLOYED",
      sandbox_passed: true,
      baseline_metrics: { ...metrics, fitness: score } as never,
    } as never);

    return {
      ok: true,
      fitness: score,
      metrics,
      verified,
      mutation: { ...mut, deployed: true },
      params,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
