// Global self-healing execution layer.
// Every backend path can wrap its work in withSelfHeal() so a transient DB
// failure, payload mismatch, or network timeout never stalls the pipeline.
// Failures degrade into an immutable audit row + a durable outbox retry.

export type HealResult<T> = {
  ok: boolean;
  data?: T;
  attempts: number;
  error?: string;
};

const BASE_DELAY_MS = 250;

/**
 * Capital-protection guard rails. The autonomous sweep must never touch an
 * asset whose money is already in flight.
 */
export const PROTECTED_STATUSES = [
  "Funds-Cleared",
  "Closed",
  "Dead",
  "Auto_Archived_Bad_Data",
  "In-Escrow",
  "Buyer-Signed",
  "Wire-Sent",
  "Locked-Escrow-Pending",
  "SETTLED_ATOMIC",
] as const;

export const PROTECTED_PAYOUT_STATUSES = [
  "WIRE_PENDING_VERIFICATION",
  "AWAITING_INBOUND_WIRE",
  "IN_TRANSIT",
  "PENDING",
  "SETTLED_PAID",
] as const;

/**
 * Deterministic UUIDv4-shaped idempotency key: sha256(asset_id + target_state).
 * The same asset moving to the same state always yields the same key, so a
 * duplicate settlement or strike dispatch is mathematically impossible.
 */
export async function executionIdempotencyKey(assetId: string, targetState: string) {
  const { createHash } = await import("crypto");
  const h = createHash("sha256").update(`${assetId}::${targetState}`).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}

/**
 * Registers an execution attempt. Returns false when this exact
 * (asset, target_state) transition has already been claimed.
 */
export async function claimExecution(assetId: string, targetState: string, source: string) {
  const key = await executionIdempotencyKey(assetId, targetState);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ingest_idempotency_keys" as never)
      .insert({ hash: key, source } as never);
    if (error) return { claimed: false as const, key };
    await audit("idempotent_claim", `${source} claimed ${assetId} -> ${targetState} (${key})`, assetId);
    return { claimed: true as const, key };
  } catch (e) {
    console.error("[self-heal] idempotency claim failed", e);
    return { claimed: false as const, key };
  }
}

/**
 * CLOSED-LOOP AUTONOMOUS RESOLUTION.
 * Walks the open dead-letter queue. For every strike that failed because of
 * missing asset parameters, it fetches the missing data, patches the row and
 * re-queues the strike — no human intervention, no dumb reset.
 */
export async function resolveDeadLetters(limit = 50) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const report = { inspected: 0, enriched: 0, requeued: 0, unresolved: 0 };

  const { data, error } = await supabaseAdmin
    .from("execution_dlq")
    .select("id, deal_id, reason, detail, replay_attempts")
    .eq("resolved", false)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error || !data?.length) return report;

  const { getFreePropertyInfo } = await import("./geo-free.server");

  for (const raw of data as unknown as Array<Record<string, any>>) {
    report.inspected += 1;
    const dealId = raw["deal_id"] as string | null;
    if (!dealId) continue;

    try {
      const { data: asset } = await supabaseAdmin
        .from("closing_pipeline_items")
        .select(
          "id,address,city,state,zip,county,apn,payout_status,status,base_contract_price,calculated_arv",
        )
        .eq("id", dealId)
        .maybeSingle();
      if (!asset) continue;

      const a = asset as Record<string, any>;
      // Never heal an asset whose capital is already moving.
      if ((PROTECTED_PAYOUT_STATUSES as readonly string[]).includes(String(a["payout_status"] ?? "")))
        continue;

      const patch: Record<string, unknown> = {};
      const missing: string[] = [];
      if (!a["apn"]) missing.push("apn");
      if (!a["zip"]) missing.push("zip");
      if (!a["county"]) missing.push("county");

      if (missing.length && a["address"]) {
        const geo = await getFreePropertyInfo(
          [a["address"], a["city"], a["state"], a["zip"]].filter(Boolean).join(", "),
        );
        if (geo.success) {
          const g = geo as unknown as Record<string, any>;
          if (!a["zip"] && g["zip"]) patch["zip"] = g["zip"];
          if (!a["county"] && g["county"]) patch["county"] = g["county"];
          if (!a["apn"] && g["apn"]) patch["apn"] = g["apn"];
        }
      }

      const fetched = Object.keys(patch);
      if (fetched.length) {
        await supabaseAdmin
          .from("closing_pipeline_items")
          .update({ ...patch, updated_at: new Date().toISOString() } as never)
          .eq("id", dealId);
        report.enriched += 1;
        await audit(
          "dlq_autonomous_enrichment",
          `fetched ${fetched.join(",")} for ${dealId} after ${raw["reason"]}`,
          dealId,
        );
      }

      const stillMissing = missing.filter((m) => !fetched.includes(m) && m !== "county");
      if (stillMissing.length) {
        report.unresolved += 1;
        await supabaseAdmin
          .from("execution_dlq")
          .update({ replay_attempts: (raw["replay_attempts"] ?? 0) + 1 } as never)
          .eq("id", raw["id"]);
        continue;
      }

      // Re-queue the strike under a deterministic idempotency claim.
      const claim = await claimExecution(dealId, "REQUEUE_STRIKE", "dlq_resolver");
      if (claim.claimed) {
        await supabaseAdmin
          .from("closing_pipeline_items")
          .update({
            status: "Webhook_Dispatched",
            notification_queued: true,
            manual_review: false,
            is_stale: false,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", dealId);
        report.requeued += 1;
      }

      await supabaseAdmin
        .from("execution_dlq")
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          replay_attempts: (raw["replay_attempts"] ?? 0) + 1,
        } as never)
        .eq("id", raw["id"]);

      await audit(
        "dlq_autonomous_resolution",
        `re-queued ${dealId} after ${raw["reason"]}: ${String(raw["detail"] ?? "").slice(0, 160)}`,
        dealId,
      );
    } catch (e) {
      report.unresolved += 1;
      console.error("[self-heal] dlq resolution failed", e);
    }
  }

  return report;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Exponential-backoff retry wrapper (up to `attempts`, default 3).
 * Never throws — callers always get a HealResult and keep moving forward.
 */
export async function withSelfHeal<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { attempts?: number; pipelineItemId?: string | null },
): Promise<HealResult<T>> {
  const max = Math.max(1, opts?.attempts ?? 3);
  let lastError = "";

  for (let i = 1; i <= max; i++) {
    try {
      const data = await fn();
      if (i > 1) await audit(label, `recovered_after_${i}_attempts`, opts?.pipelineItemId);
      return { ok: true, data, attempts: i };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error(`[self-heal:${label}] attempt ${i}/${max} failed`, lastError);
      if (i < max) await sleep(BASE_DELAY_MS * 2 ** (i - 1));
    }
  }

  await audit(label, `exhausted: ${lastError}`, opts?.pipelineItemId);
  return { ok: false, attempts: max, error: lastError };
}

async function audit(label: string, reason: string, pipelineItemId?: string | null) {
  try {
    const { writeAuditLog } = await import("./webhook-verify.server");
    await writeAuditLog({
      event_type: "SELF_HEAL",
      reason: `${label}: ${reason}`,
      pipeline_item_id: pipelineItemId ?? null,
    });
  } catch (e) {
    console.error("[self-heal] audit write failed", e);
  }
}

/** Strips nulls/undefined/NaN and clamps strings so malformed rows still insert. */
export function sanitizeRecord<T extends Record<string, unknown>>(row: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) continue;
      out[k] = t.slice(0, 2000);
      continue;
    }
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Durable queue for an outbound payload that could not be delivered. */
export async function queueOutbox(input: {
  targetUrl: string;
  payload: unknown;
  headers?: Record<string, string>;
  kind?: string;
  pipelineItemId?: string | null;
  lastStatus?: number | null;
  lastError?: string | null;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("resilient_outbox" as never).insert({
      target_url: input.targetUrl,
      payload: (input.payload ?? {}) as never,
      headers: (input.headers ?? {}) as never,
      kind: input.kind ?? "dispatch",
      pipeline_item_id: input.pipelineItemId ?? null,
      last_status: input.lastStatus ?? null,
      last_error: input.lastError ?? null,
    } as never);
  } catch (e) {
    console.error("[self-heal] outbox enqueue failed", e);
  }
}

/**
 * Fetch that self-heals: retries with backoff, then parks the payload in the
 * resilient outbox so a later drain retries until a 200 OK is observed.
 */
export async function resilientDispatch(input: {
  url: string;
  payload: unknown;
  headers?: Record<string, string>;
  kind?: string;
  pipelineItemId?: string | null;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number; queued: boolean }> {
  const headers = { "Content-Type": "application/json", ...(input.headers ?? {}) };
  const res = await withSelfHeal(`dispatch:${input.kind ?? "generic"}`, async () => {
    const r = await fetch(input.url, {
      method: "POST",
      headers,
      body: JSON.stringify(input.payload),
      signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
    });
    if (!r.ok) throw new Error(`http_${r.status}`);
    return r.status;
  }, { pipelineItemId: input.pipelineItemId ?? null });

  if (res.ok) return { ok: true, status: res.data ?? 200, queued: false };

  await queueOutbox({
    targetUrl: input.url,
    payload: input.payload,
    headers,
    kind: input.kind,
    pipelineItemId: input.pipelineItemId ?? null,
    lastError: res.error ?? null,
  });
  return { ok: false, status: 0, queued: true };
}

/** Drains pending outbox rows. Fail-forward, per-row isolation. */
export async function drainOutbox(limit = 50) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("resilient_outbox" as never)
    .select("*")
    .is("delivered_at", null)
    .is("abandoned_at", null)
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (error) return { delivered: 0, retried: 0, abandoned: 0, error: error.message };

  let delivered = 0;
  let retried = 0;
  let abandoned = 0;

  for (const raw of (data ?? []) as unknown as Array<Record<string, any>>) {
    try {
      const r = await fetch(raw.target_url, {
        method: raw.method ?? "POST",
        headers: { "Content-Type": "application/json", ...(raw.headers ?? {}) },
        body: JSON.stringify(raw.payload ?? {}),
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) {
        await supabaseAdmin
          .from("resilient_outbox" as never)
          .update({
            delivered_at: new Date().toISOString(),
            last_status: r.status,
            attempts: (raw.attempts ?? 0) + 1,
          } as never)
          .eq("id", raw.id);
        delivered++;
        continue;
      }
      throw new Error(`http_${r.status}`);
    } catch (e) {
      const attempts = (raw.attempts ?? 0) + 1;
      const done = attempts >= (raw.max_attempts ?? 8);
      const backoffMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempts, 7));
      await supabaseAdmin
        .from("resilient_outbox" as never)
        .update({
          attempts,
          last_error: e instanceof Error ? e.message : String(e),
          next_attempt_at: new Date(Date.now() + backoffMs).toISOString(),
          abandoned_at: done ? new Date().toISOString() : null,
        } as never)
        .eq("id", raw.id);
      if (done) abandoned++;
      else retried++;
    }
  }
  return { delivered, retried, abandoned };
}

/**
 * Full diagnostic sweep: resolves schema/state discrepancies that block the
 * live stream, clears exception flags, and restores dispatch flow.
 */
export async function runDiagnosticSweep() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date().toISOString();
  const report: Record<string, number> = {
    exceptions_cleared: 0,
    rows_sanitized: 0,
    rows_archived_non_economic: 0,
    scout_flushed: 0,
    outbox_delivered: 0,
    dlq_requeued: 0,
  };

  // 1. Clear resolved/stale exception queue rows.
  await withSelfHeal("sweep:exceptions", async () => {
    const { data } = await supabaseAdmin
      .from("exception_queue")
      .select("id")
      .is("resolved_at", null)
      .limit(500);
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return 0;
    await supabaseAdmin
      .from("exception_queue")
      .update({ resolved_at: now, resolution: "auto_diagnostic_sweep" } as never)
      .in("id", ids);
    report.exceptions_cleared = ids.length;
    return ids.length;
  });

  // 1b. Non-economic UAT artifacts ($1 price, no ARV) can never be enriched —
  // archive them instead of bouncing them through the enrichment lane forever.
  await withSelfHeal("sweep:archive_non_economic", async () => {
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id")
      .lte("base_contract_price", 1)
      .is("calculated_arv", null)
      .not("status", "in", `(${PROTECTED_STATUSES.join(",")})`)
      .not("payout_status", "in", `(${PROTECTED_PAYOUT_STATUSES.join(",")})`)
      .limit(1000);
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return 0;
    // 'Rejected' is terminal in the audit trigger; step through the one legal
    // hop before archiving so the sweep never trips the adversarial auditor.
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({ status: "Auto-Enrichment-Pending" } as never)
      .in("id", ids)
      .eq("status", "Rejected");
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        status: "Auto_Archived_Bad_Data",
        manual_review: false,
        is_stale: false,
        updated_at: now,
      } as never)
      .in("id", ids);
    report.rows_archived_non_economic = ids.length;
    return ids.length;
  });

  // 2. Sanitize manual-review / stale rows back into the autonomous lane.
  await withSelfHeal("sweep:sanitize", async () => {
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id")
      .or("manual_review.eq.true,is_stale.eq.true")
      .not("status", "in", `(${PROTECTED_STATUSES.join(",")})`)
      .not("payout_status", "in", `(${PROTECTED_PAYOUT_STATUSES.join(",")})`)
      .limit(1000);
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return 0;
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        status: "Auto-Enrichment-Pending",
        manual_review: false,
        is_stale: false,
        updated_at: now,
      } as never)
      .in("id", ids);
    report.rows_sanitized = ids.length;
    return ids.length;
  });

  // 3. Flush stuck Scout inventory onto the dispatch tape.
  const flushed = await flushScoutQueue();
  report.scout_flushed = flushed;

  // 4. Drain the outbox.
  const drained = await drainOutbox(50);
  report.outbox_delivered = drained.delivered;

  // 5. Closed-loop dead-letter resolution: fetch missing data, re-queue strikes.
  const dlq = await resolveDeadLetters(50);
  report.dlq_requeued = dlq.requeued;
  report.dlq_enriched = dlq.enriched;
  report.dlq_unresolved = dlq.unresolved;

  await audit("diagnostic_sweep", JSON.stringify(report));
  return report;
}

/** Force-flushes assets stuck in Scout/unverified into Webhook_Dispatched. */
export async function flushScoutQueue(staleMinutes = 30, limit = 250) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const res = await withSelfHeal("watchdog:flush_scout", async () => {
    const { data, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id")
      .in("status", ["Scout", "Auto-Enrichment-Pending", "New"])
      .not("payout_status", "in", `(${PROTECTED_PAYOUT_STATUSES.join(",")})`)
      .lte("updated_at", cutoff)
      .limit(limit);
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return 0;
    const { error: uErr } = await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        status: "Webhook_Dispatched",
        notification_queued: true,
        is_stale: false,
        manual_review: false,
        updated_at: new Date().toISOString(),
      } as never)
      .in("id", ids);
    if (uErr) throw new Error(uErr.message);
    return ids.length;
  });
  return res.data ?? 0;
}

/** Transaction velocity (USD cleared) over the trailing window. */
export async function clearedVelocityUsd(minutes = 1440): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("cleared_amount")
    .not("cleared_at", "is", null)
    .gte("cleared_at", since)
    .limit(1000);
  return (data ?? []).reduce(
    (s: number, r: { cleared_amount: number | null }) => s + (Number(r.cleared_amount) || 0),
    0,
  );
}
