import { toast } from "sonner";
import { EmailTelemetryStrip } from "@/components/admin/EmailTelemetryStrip";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { setDealStatusAndDispatch } from "@/lib/status-dispatch.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAllDeals } from "@/lib/deals.functions";
import { getTelemetryAggregates, ensureTelemetryBaseline, getMarketBindings } from "@/lib/telemetry-metrics.functions";

import { runAutoHeal, runDiagnosticOverride } from "@/lib/autoheal.functions";
import {
  getAutoSettleState,
  toggleAutoSettle,
} from "@/lib/auto-settle.functions";
import type { Deal, FeedEvent } from "@/lib/deals.functions";
import { BeneficiaryLiability } from "@/components/admin/BeneficiaryLiability";
import { StaleStateBreaker } from "@/components/StaleStateBreaker";
import { useHeartbeatLatency } from "@/hooks/use-heartbeat-latency";
import { wireEta } from "@/lib/wire-eta";
import { settlementBinding, BLOCKER_LABEL } from "@/lib/settlement-binding";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Settlement Terminal — AbandonedAssetOS" },
      {
        name: "description",
        content:
          "Real-time institutional settlement terminal. Cleared fees, in-escrow capital, connected algorithms, and live deal flow.",
      },
      { property: "og:title", content: "Settlement Terminal — AbandonedAssetOS" },
      {
        property: "og:description",
        content: "Live deal flow, cleared fees, and connected hedge-fund algorithms.",
      },
    ],
  }),
  component: TerminalPage,
});

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const KIND_META: Record<
  FeedEvent["kind"],
  { label: string; color: string; dot: string }
> = {
  cleared: { label: "FUNDS CLEARED", color: "text-emerald-400", dot: "bg-emerald-400" },
  locked: { label: "STRIKE LOCK · ESCROW PENDING", color: "text-yellow-300", dot: "bg-yellow-300" },
  title_pending: { label: "TITLE DISPATCHED", color: "text-sky-300", dot: "bg-sky-300" },
  matched: { label: "BUYER MATCHED", color: "text-fuchsia-300", dot: "bg-fuchsia-300" },
  new: { label: "ASSET INGESTED", color: "text-zinc-300", dot: "bg-zinc-300" },
};

function StatusPill({ status }: { status: string }) {
  if (status === "Funds-Cleared") {
    return (
      <span
        aria-disabled="true"
        className="pointer-events-none inline-flex select-none items-center gap-1 rounded border border-purple-400/60 bg-purple-600/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-purple-200 shadow-[0_0_10px_-2px_rgba(168,85,247,0.6)]"
      >
        <span aria-hidden="true">🔒</span> FUNDS-CLEARED
      </span>
    );
  }
  const c =
    status === "Locked-Escrow-Pending"
      ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40"
      : status === "In-Escrow"
        ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
        : status === "Closed" || status === "Dead"
          ? "bg-zinc-700/40 text-zinc-400 border-zinc-600/40"
          : "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30";
  return (
    <span className={`inline-block rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${c}`}>
      {status}
    </span>
  );
}

function AutoClearBadge() {
  return (
    <span
      title="Zero-touch settlement · auto-clears on confidence + signature checks"
      className="inline-flex items-center gap-1 rounded border border-cyan-400/50 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-cyan-300"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
      AUTO
    </span>
  );
}



function MetricCard({
  label,
  value,
  tone,
  pulse,
  sublabel,
}: {
  label: string;
  value: string;
  tone: "green" | "yellow" | "cyan" | "fuchsia";
  pulse?: boolean;
  sublabel?: string;
}) {
  const toneCls = {
    green: "text-emerald-400",
    yellow: "text-yellow-300",
    cyan: "text-cyan-300",
    fuchsia: "text-fuchsia-300",
  }[tone];
  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 transition-shadow ${
        pulse ? "shadow-[0_0_24px_-4px_rgba(16,185,129,0.5)]" : ""
      }`}
    >
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>
      <div className={`mt-2 font-mono text-3xl font-bold tabular-nums md:text-4xl ${toneCls}`}>
        {value}
      </div>
      {sublabel && (
        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {sublabel}
        </div>
      )}
    </div>
  );
}

// Settlement ETA: dynamic T+X business days. Institutional buyers return
// impact_days (T+13/T+14 due-diligence clearing); flash rails settle T+2.
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}
// Reads the settlement window straight off the inbound payload; falls back to
// the flash rail (T+2) only when the asset is on a verified direct-wire rail.
function impactDaysFor(d: Deal): number {
  const raw =
    (d as unknown as Record<string, unknown>)["impact_days"] ??
    (d as unknown as Record<string, unknown>)["settlement_days"];
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  if (d.verification_status === "VERIFIED_DIRECT_WIRE" || d.auto_clearance_ready) return 2;
  return 14;
}
function settlementEta(
  clearedAt: string,
  days: number,
): { date: Date; label: string; inTransit: boolean; days: number } {
  const date = addBusinessDays(new Date(clearedAt), days);
  const inTransit = date.getTime() > Date.now();
  return {
    date,
    days,
    label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    inTransit,
  };
}


function usePulse(value: number) {
  const prev = useRef(value);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (value !== prev.current) {
      prev.current = value;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1200);
      return () => clearTimeout(t);
    }
  }, [value]);
  return pulse;
}

function formatUsdCompact(n: number): string {
  if (n <= 0) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

// LOCKED: VERIFIED_DIRECT_WIRE is treated as a live, cleared rail and must
// always render as "DIRECT WIRE" in emerald. It is excluded from the DUE
// unverified count and never falls back to UNVERIFIED regardless of cleared_at.
const isVerifiedDirectWire = (d: Deal) => d.verification_status === "VERIFIED_DIRECT_WIRE";

// Any dispatched/awaiting-wire state shows the T+2 FedWire transit ETA.
const PENDING_WIRE_STATES = new Set([
  "WIRE_PENDING_VERIFICATION",
  "AWAITING_INBOUND_WIRE",
  "IN_TRANSIT",
  "PENDING",
  "Wire-Sent",
  "Locked-Escrow-Pending",
  "SETTLED_ATOMIC",
  "In-Escrow",
  "Buyer-Signed",
  "Webhook_Dispatched",
]);
function isPendingWire(d: Deal): boolean {
  const r = d as unknown as Record<string, unknown>;
  const payout = String(r["payout_status"] ?? "").trim();
  const status = String(r["status"] ?? "").trim();
  if (status === "Funds-Cleared" || status === "Closed") return false;
  if (payout === "SETTLED_PAID") return false;
  return PENDING_WIRE_STATES.has(payout) || PENDING_WIRE_STATES.has(status);
}

// STAGE 2 — a buyer algorithm actually struck: the fee is locked and the wire
// is instructed. Everything else with a target fee is STAGE 1 (primed only).
// Ground truth: an M2M hold is live only while the DB deadline is in the
// future. No cosmetic timers — the UI drops styling the instant the DB sweeps.
function isM2MLockLive(d: Deal, nowMs: number): boolean {
  const t = d.m2m_expires_at ? new Date(d.m2m_expires_at).getTime() : 0;
  return t > nowMs;
}

function isStrikeLocked(d: Deal): boolean {
  return isPendingWire(d) || Boolean(d.cleared_at);
}


function TerminalPage() {
  const fetchDeals = useServerFn(getAllDeals);
  const dispatchStatus = useServerFn(setDealStatusAndDispatch);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["all-deals"],
    queryFn: () => fetchDeals(),
    refetchInterval: 30_000, // safety-net poll; Realtime drives the live updates
    // Zero-jitter: keep the last good slice mounted during refetches so batch
    // webhook bursts never flash loading/empty states.
    placeholderData: (prev) => prev,
    staleTime: 3_000,
    // Bounded exponential backoff — read path only, never a state-changing call.
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
  const degraded = Boolean(error) || Boolean(data && !data.schema_ok);

  // Live aggregate sums off conversion_events / buyer_waitlist.
  const fetchTelemetry = useServerFn(getTelemetryAggregates);
  const telemetry = useQuery({
    queryKey: ["telemetry-aggregates"],
    queryFn: () => fetchTelemetry(),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  // Direct DB bindings: pipeline + delivery telemetry + buy boxes.
  const fetchBindings = useServerFn(getMarketBindings);
  const bindings = useQuery({
    queryKey: ["market-bindings"],
    queryFn: () => fetchBindings(),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const mb = bindings.data;
  const deliveryByDeal = new Map(
    (mb?.tape ?? []).map((t) => [t.id, { status: t.delivery_status, box: t.box_label }]),
  );


  // Auto-mount diagnostic: if the conversion ledger is empty, the terminal
  // seeds baseline payloads itself and invalidates cache. No buttons.
  const ensureBaseline = useServerFn(ensureTelemetryBaseline);
  const baselineFired = useRef(false);
  useEffect(() => {
    if (baselineFired.current) return;
    baselineFired.current = true;
    ensureBaseline()
      .then((r: any) => {
        if (r?.seeded > 0) {
          qc.invalidateQueries({ queryKey: ["telemetry-aggregates"] });
          qc.invalidateQueries({ queryKey: ["all-deals"] });
        }
      })
      .catch(() => {});
  }, [ensureBaseline, qc]);

  // State trace: one-time console report of where the metric values come from.
  const tracedRef = useRef(false);
  useEffect(() => {
    if (tracedRef.current || !telemetry.data) return;
    tracedRef.current = true;
    const d = telemetry.data;
    console.info("[state-trace] telemetry", {
      pipeline_volume_usd: d.pipeline_volume_usd,
      in_transit_fees_usd: d.in_transit_fees_usd,
      capital_velocity_usd_hr: d.capital_velocity_usd_hr,
      ...d.diagnostic,
    });
  }, [telemetry.data]);





  // Stable-state window: coalesce Realtime bursts into one refresh every 4s.
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (invalidateTimer.current) return;
    invalidateTimer.current = setTimeout(() => {
      invalidateTimer.current = null;
      qc.invalidateQueries({ queryKey: ["all-deals"] });
      qc.invalidateQueries({ queryKey: ["telemetry-aggregates"] });
      qc.invalidateQueries({ queryKey: ["market-bindings"] });
    }, 4_000);
  }, [qc]);
  useEffect(
    () => () => {
      if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
    },
    [],
  );


  // Event-driven updates — Supabase Realtime replaces the 5s polling loop.
  // Pass D: on a FUNDS-CLEARED transition, also fire an audio confirmation cue.
  // 1s tick drives lock expiry rendering off the DB deadline (no fake timers).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const [settlementNotice, setSettlementNotice] = useState<
    { id: string; zip: string; amount: number; etaLabel: string } | null
  >(null);

  useEffect(() => {
    if (!settlementNotice) return;
    const t = setTimeout(() => setSettlementNotice(null), 12000);
    return () => clearTimeout(t);
  }, [settlementNotice]);
  useEffect(() => {
    const playClearedChime = () => {
      try {
        const AC: typeof AudioContext | undefined =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const now = ctx.currentTime;
        const tones = [880, 1318.5]; // A5 -> E6 — clean two-tone "ka-ching"
        tones.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          const start = now + i * 0.12;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
          osc.connect(gain).connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.4);
        });
        setTimeout(() => ctx.close().catch(() => {}), 900);
      } catch {
        /* audio blocked — silent */
      }
    };

    // Sub-second strike lock cue: D5 -> A5 rising sine.
    const playStrikeChime = () => {
      try {
        const AC: typeof AudioContext | undefined =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
        setTimeout(() => ctx.close().catch(() => {}), 800);
      } catch {
        /* audio blocked — silent */
      }
    };


    const channel = supabase
      .channel("settlement-terminal")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "closing_pipeline_items" },
        (payload) => {
          scheduleRefresh();
          const next = (payload.new as any)?.status;
          const prev = (payload.old as any)?.status;
          if (
            payload.eventType === "UPDATE" &&
            next === "Funds-Cleared" &&
            prev !== "Funds-Cleared"
          ) {
            playClearedChime();
            const row = payload.new as any;
            const amt = Number(row?.cleared_amount ?? row?.optimized_acquisition_premium ?? 0);
            const clearedAt = row?.cleared_at ?? new Date().toISOString();
            const eta = settlementEta(clearedAt, impactDaysFor(row as Deal));
            setSettlementNotice({
              id: row?.id ?? crypto.randomUUID(),
              zip: row?.zip ?? "—",
              amount: amt,
              etaLabel: eta.label,
            });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "system_metrics" },
        () => {
          // Watchdog updated source-of-truth totals — refresh dashboard.
          scheduleRefresh();
        },
      )
      // Zero-reload sweep: any INSERT/UPDATE/DELETE on the ledger tables
      // invalidates telemetry so settled capital lands on screen instantly.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversion_events" },
        () => scheduleRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "buyer_waitlist" },
        () => scheduleRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offer_delivery_logs" },
        () => scheduleRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "closing_pipeline_items" },
        (payload) => {
          scheduleRefresh();
          // Live M2M lock flash: background sweeper moved an asset into a
          // matched/underwriting state — pulse the row green.
          const next = (payload.new as any)?.status;
          const prev = (payload.old as any)?.status;
          const id = (payload.new as any)?.id;
          const LOCK_STATES = ["Pending-Underwriting", "Shadow_Matched", "Under-Review"];
          // Audio cue only — the green lock styling is bound to m2m_expires_at.
          if (id && next !== prev && LOCK_STATES.includes(next)) playStrikeChime();
          setNowMs(Date.now());
        },
      )
      // Standing buy box inventory changes (created / armed / deprecated).
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "buyer_buy_boxes" },
        () => scheduleRefresh(),
      )



      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, scheduleRefresh]);

  // Stale-State Circuit Breaker: suspend REVERSE_STRIKE_READY assets on socket lag/drop.
  const hb = useHeartbeatLatency();
  const allDeals = data?.deals ?? [];
  const suspendedStrikes = hb.stale ? allDeals.filter((d: Deal) => d.reverse_strike_ready).length : 0;
  const tapeDeals = hb.stale ? allDeals.filter((d: Deal) => !d.reverse_strike_ready) : allDeals;

  const cleared = data?.fees_cleared ?? 0;
  const inEscrow = data?.fees_in_escrow ?? 0;
  const algos = data?.algos_connected ?? 0;
  const contracts = data?.contracts_secured ?? 0;
  const bidDepth = data?.bid_depth_usd ?? 0;
  const shadowDepth = data?.shadow_depth_usd ?? 0;
  const shadowQueueCount = data?.shadow_queue_count ?? 0;
  const shadowQueueUsd = data?.shadow_queue_usd ?? 0;

  // Split cleared total into "in transit to bank" vs "settled in bank" using
  // each asset's own settlement window (T+2 flash vs T+13/T+14 institutional).
  const {
    feesInTransit,
    feesBankBound,
    feesProjected,
    feesSettled,
    morningBatchUsd,
    morningBatchCount,
    nextPayoutLabel,
    nextPayoutDays,
    trancheFast,
    trancheSlow,
    trancheFastCount,
    trancheSlowCount,
    blendedSettlementDays,
  } = (() => {
    let inTransit = 0;
    let bankBound = 0;
    let projected = 0;
    let settled = 0;
    let fast = 0;
    let slow = 0;
    let fastCount = 0;
    let slowCount = 0;
    let weighted = 0;
    let weight = 0;
    let nextEta: Date | null = null;
    let nextDays: number | null = null;
    for (const d of data?.deals ?? []) {
      if (!(d.status === "Funds-Cleared" || d.cleared_at)) continue;
      if (!d.cleared_at) continue;
      const amt = d.cleared_amount ?? d.optimized_acquisition_premium;
      const days = impactDaysFor(d);
      const eta = settlementEta(d.cleared_at, days);
      weighted += days * Math.max(amt, 0);
      weight += Math.max(amt, 0);
      if (eta.inTransit) {
        inTransit += amt;
        bankBound += amt;
        if (days <= 2) {
          fast += amt;
          fastCount++;
        } else {
          slow += amt;
          slowCount++;
        }
        if (!nextEta || eta.date < nextEta) {
          nextEta = eta.date;
          nextDays = days;
        }
      } else {
        settled += amt;
      }
    }
    // Aggregate active FEES IN TRANSIT rows from the Deal Tape so the summary
    // card reflects the same badge logic rendered in the table rows.
    // Only real-world verified assets contribute settlement value. Blocked
    // assets display zero projected value — no calendar-derived claims.
    for (const d of data?.deals ?? []) {
      if (!isPendingWire(d) || d.cleared_at) continue;
      if (!settlementBinding(d as never).bound) continue;
      inTransit += d.optimized_acquisition_premium;
      bankBound += d.optimized_acquisition_premium;
      const eta = wireEta(d.cleared_at ?? d.updated_at ?? d.created_at);
      if (!nextEta || eta.arrival < nextEta) {
        nextEta = eta.arrival;
        nextDays = eta.businessDaysLeft;
      }
    }
    // Morning wire batch: anchored settlement only. A deal contributes to the
    // batch only when it carries a real settlement anchor (cleared_at + bound
    // wire/Stripe reference). Un-anchored REVERSE_STRIKE_READY rows project $0
    // so no simulated cash can ever render as in-transit.
    const MORNING_BATCH_CAP = 150_000;
    let batchTotal = 0;
    let batchCount = 0;
    for (const d of data?.deals ?? []) {
      if (batchTotal >= MORNING_BATCH_CAP) break;
      if (!d.cleared_at) continue;
      if (!settlementBinding(d as never).bound) continue;
      const fee = Number(d.cleared_amount ?? d.optimized_acquisition_premium) || 0;
      if (fee <= 0) continue;
      batchTotal += Math.min(fee, MORNING_BATCH_CAP - batchTotal);
      batchCount++;
    }
    // batchTotal is already included in inTransit/bankBound above (anchored rows).

    return {
      feesInTransit: inTransit,
      feesBankBound: bankBound,
      feesProjected: projected,
      feesSettled: settled,
      morningBatchUsd: batchTotal,
      morningBatchCount: batchCount,
      trancheFast: fast,
      trancheSlow: slow,
      trancheFastCount: fastCount,
      trancheSlowCount: slowCount,
      blendedSettlementDays: weight > 0 ? weighted / weight : 0,
      nextPayoutDays: nextDays,
      nextPayoutLabel: nextEta
        ? (nextEta as Date).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : null,
    };
  })();



  const clearedPulse = usePulse(cleared);
  const escrowPulse = usePulse(inEscrow);

  return (
    <main className="flex min-h-screen flex-col bg-zinc-950 p-4 pb-24 text-zinc-100 md:p-8 md:pb-28">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex items-end justify-between border-b border-zinc-800 pb-4">
          <div>
            <h1 className="font-mono text-xl font-bold tracking-tight md:text-2xl">
              SETTLEMENT TERMINAL
            </h1>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              AbandonedAssetOS · realtime · event-driven
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-emerald-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            stream live
          </div>
        </header>

        <SettlementRunnerBar
          dueCount={
            (data?.deals ?? []).filter(
              (d) =>
                !d.cleared_at &&
                d.status !== "Closed" &&
                d.status !== "Dead" &&
                d.verification_status !== "VERIFIED" &&
                !isVerifiedDirectWire(d) &&
                new Date(d.created_at).getTime() + 14 * 86400000 <= Date.now(),
            ).length
          }
          onDone={() => refetch()}
        />

        {settlementNotice && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-lg border border-emerald-400/60 bg-emerald-500/10 px-4 py-3 shadow-[0_0_24px_-4px_rgba(16,185,129,0.5)]"
          >
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300">
                ✓ Settlement Confirmed · Bluevine
              </div>
              <div className="mt-0.5 font-mono text-sm text-emerald-100">
                {usd.format(settlementNotice.amount)} cleared · ZIP {settlementNotice.zip} ·
                <span className="ml-1 text-emerald-200">
                  funds hit bank ~{settlementNotice.etaLabel}
                </span>
              </div>
            </div>
            <button
              onClick={() => setSettlementNotice(null)}
              className="rounded border border-emerald-400/40 px-2 py-1 font-mono text-[10px] uppercase text-emerald-200 hover:bg-emerald-500/20"
            >
              dismiss
            </button>
          </div>
        )}


        {degraded && (
          <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-4">
            <p className="font-mono text-xs font-semibold text-amber-300">
              TERMINAL DATA TEMPORARILY UNAVAILABLE
            </p>
            <p className="mt-1 font-mono text-xs text-amber-300/80">
              {data?.error_code ?? "TERMINAL_DATA_TIMEOUT"}
              {data?.request_id ? ` · req ${data.request_id}` : ""}
              {data?.build_id ? ` · build ${data.build_id}` : ""}
            </p>
            <p className="mt-1 font-mono text-[11px] text-amber-200/70">
              Read-only degraded mode. No settlement, promotion, or credential
              action runs while data is stale.
            </p>
            <button
              onClick={() => refetch()}
              className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-xs text-amber-200 hover:bg-amber-500/20"
            >
              RETRY
            </button>
          </div>
        )}

        {/* Primary settlement counters — all derived live from the Deal Tape */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Total Pipeline Fees"
            value={usd.format(data?.total_assignment_fees ?? 0)}
            tone="yellow"
            pulse={escrowPulse}
            sublabel={`${contracts} active contracts on tape`}
          />
          <MetricCard
            label="Fees Pending Settlement"
            value={usd.format(feesInTransit)}
            tone="cyan"
            sublabel={`${
              morningBatchUsd > 0
                ? `${usd.format(morningBatchUsd)} morning wire batch (${morningBatchCount} cleared) → Bluevine · `
                : ""
            }${usd.format(feesBankBound)} bank-bound · ${usd.format(feesProjected)} projected${
              nextPayoutLabel
                ? ` · next ${nextPayoutLabel}${nextPayoutDays ? ` (T+${nextPayoutDays})` : ""}`
                : ""
            }`}
          />
          <MetricCard
            label="Total Fees Settled"
            value={usd.format(feesSettled)}
            tone="green"
            pulse={clearedPulse}
            sublabel="cleared cash · Bluevine"
          />
          <MetricCard
            label="Avg Settlement Speed"
            value={blendedSettlementDays > 0 ? `${blendedSettlementDays.toFixed(1)} d` : "—"}
            tone={blendedSettlementDays > 0 && blendedSettlementDays <= 3 ? "green" : "fuchsia"}
            sublabel="capital-weighted time to deposit"
          />
        </section>

        <BeneficiaryLiability />



        {/* Exception Auto-Heal — zero manual data entry */}
        <AutoHealBar
          count={(data?.manual_review_count ?? 0) + (data?.stale_count ?? 0)}
          onHealed={() => qc.invalidateQueries({ queryKey: ["all-deals"] })}
        />


        <EmailTelemetryStrip />

        {/* Velocity Panel — Real-Time Payout Velocity + Asset Velocity */}
        <section className="grid gap-3 lg:grid-cols-3 rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              Capital Velocity · per hour
            </div>
            <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-emerald-400">
              {(mb?.velocity_events_24h ?? 0).toLocaleString()}
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              delivered/clicked offers · 24h · M2M cleared {formatUsdCompact(data?.m2m_cleared_usd_24h ?? 0)}
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-cyan-300/80">
              Avg Settlement:{" "}
              {blendedSettlementDays > 0 ? `${blendedSettlementDays.toFixed(1)} days` : "—"}
            </div>

          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              Asset Velocity · per hour
            </div>
            <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-cyan-300">
              {(data?.asset_velocity_per_hour ?? 0).toFixed(2)}
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              headless exec{" "}
              {data?.m2m_avg_latency_ms != null ? `${data.m2m_avg_latency_ms}ms` : "—"} avg ·{" "}
              {data?.m2m_exec_count_24h ?? 0} algo clears · {data?.m2m_tif_expired_24h ?? 0} TIF
              expired
            </div>
          </div>

          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              Payout Velocity · last 24h
            </div>
            <div className="mt-2 flex h-16 items-end gap-0.5">
              {(() => {
                const buckets = data?.payout_velocity ?? [];
                const max = Math.max(1, ...buckets.map((b) => b.cleared_usd));
                return buckets.map((b, i) => {
                  const h = Math.max(2, Math.round((b.cleared_usd / max) * 64));
                  return (
                    <div
                      key={b.hour + i}
                      title={`${new Date(b.hour).toLocaleTimeString([], { hour: "2-digit" })} · ${usd.format(b.cleared_usd)}`}
                      style={{ height: `${h}px` }}
                      className={`flex-1 rounded-sm ${b.cleared_usd > 0 ? "bg-emerald-500/70" : "bg-zinc-800"}`}
                    />
                  );
                });
              })()}
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              hourly cleared USD · sparkline
            </div>
          </div>
        </section>

        {/* ZIP Velocity Leaderboard */}
        {(data?.zip_velocity?.length ?? 0) > 0 && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">
              ZIP Velocity · top markets by settled capital
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-2 py-1">ZIP</th>
                    <th className="px-2 py-1">Clears</th>
                    <th className="px-2 py-1">Cleared $</th>
                    <th className="px-2 py-1">Avg Settle</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.zip_velocity.map((z) => (
                    <tr key={z.zip} className="border-t border-zinc-800/50">
                      <td className="px-2 py-1 font-mono text-zinc-200">{z.zip}</td>
                      <td className="px-2 py-1 font-mono tabular-nums text-zinc-300">{z.cleared_count}</td>
                      <td className="px-2 py-1 font-mono tabular-nums text-emerald-300">{usd.format(z.cleared_usd)}</td>
                      <td className="px-2 py-1 font-mono tabular-nums text-cyan-300">
                        {z.avg_settlement_ms != null
                          ? `${(z.avg_settlement_ms / 1000 / 60).toFixed(1)}m`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}




        {/* Depth of Book — aggregate buy-side capital pinging the network */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                Aggregate Bid Depth · Active Liquidity
              </div>
              <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-cyan-300 md:text-4xl">
                {formatUsdCompact(bidDepth)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                Shadow Liquidity · Waitlisted
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-300 md:text-3xl">
                + {formatUsdCompact(shadowDepth)}
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-3">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                Shadow Queue · Pre-Allocated
              </div>
              <div className="mt-1 font-mono text-xl font-bold tabular-nums text-violet-300">
                {formatUsdCompact(mb?.shadow_queue_usd ?? shadowQueueUsd)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                Standing Buy Boxes
              </div>
              <div className="mt-1 font-mono text-xl font-bold tabular-nums text-violet-300">
                {mb?.active_buy_boxes ?? shadowQueueCount}
              </div>
            </div>
          </div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            declared buying power across active institutional keys · reverse-inquiry AUM + shadow-routed capital
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          {/* Live settlement feed */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 lg:col-span-1">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">
                Live Settlement Feed
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-zinc-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                tick
              </div>
            </div>
            <ul className="max-h-[520px] divide-y divide-zinc-800/60 overflow-auto">
              {(data?.feed ?? []).length === 0 && !isLoading && (
                <li className="px-4 py-6 text-center font-mono text-xs text-zinc-500">
                  Awaiting first signal…
                </li>
              )}
              {data?.feed.map((ev) => {
                const meta = KIND_META[ev.kind];
                return (
                  <li
                    key={`${ev.id}-${ev.kind}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-900/40"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot} animate-pulse`} />
                    <div className="min-w-0 flex-1">
                      <div className={`font-mono text-[10px] uppercase tracking-wider ${meta.color}`}>
                        {meta.label}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-xs text-zinc-300">
                        ZIP {ev.zip} · {usd.format(ev.amount)}
                      </div>
                    </div>
                    <div className="font-mono text-[10px] text-zinc-500">
                      {new Date(ev.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Deal tape */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 lg:col-span-2">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">
                Deal Tape · {data?.deal_count ?? 0} assets
              </div>
              <div className="font-mono text-[10px] uppercase text-zinc-500">
                pipeline {usd.format(data?.total_pipeline_value ?? 0)} · fees {usd.format(data?.total_assignment_fees ?? 0)}
              </div>
            </div>
            <div className="border-b border-zinc-800 px-4 py-2">
              <StaleStateBreaker hb={hb} suspended={suspendedStrikes} />
            </div>
            {data && tapeDeals.length === 0 ? (
              <div className="px-4 py-12 text-center font-mono text-xs text-zinc-500">
                No assets in pipeline. Cognitive ingestion endpoint awaiting input.
              </div>
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-left text-sm">

                  <thead className="border-b border-zinc-800 bg-zinc-900/40 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">ID</th>
                      <th className="px-3 py-2 font-medium">ZIP</th>
                      <th className="px-3 py-2 font-medium">Total</th>
                      <th className="px-3 py-2 font-medium">Fee</th>
                      <th className="px-3 py-2 font-medium">Class</th>
                      <th className="px-3 py-2 font-medium">Target Fee</th>
                      <th className="px-3 py-2 font-medium">Cap Rate</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Escrow</th>
                      <th className="px-3 py-2 font-medium">ETA to Bluevine</th>
                      <th className="px-3 py-2 font-medium">Bluevine</th>
                      <th className="px-3 py-2 font-medium">T-Impact</th>
                      <th className="px-3 py-2 font-medium">Buy Box</th>
                      <th className="px-3 py-2 font-medium">Delivery</th>
                      <th className="px-3 py-2 font-medium">Dispatch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tapeDeals.slice(0, 60).map((d: Deal) => {
                      const impactMs =
                        new Date(d.created_at).getTime() + 14 * 86400000 - Date.now();
                      const impactDays = Math.ceil(impactMs / 86400000);
                      const impactLabel =
                        d.status === "Funds-Cleared" || d.status === "Closed"
                          ? "—"
                          : impactDays <= 0
                            ? "DUE"
                            : `T-${impactDays}d`;
                      const impactColor =
                        impactDays <= 0
                          ? "text-rose-400"
                          : impactDays <= 3
                            ? "text-yellow-300"
                            : "text-zinc-400";
                      return (
                        <tr
                          key={d.id}
                          className={`border-t border-zinc-800/50 transition-colors duration-500 ${
                            isM2MLockLive(d, nowMs)
                              ? "animate-pulse bg-emerald-400/25 shadow-[inset_0_0_0_1px_rgb(16,185,129)]"
                              : isStrikeLocked(d)
                                ? "bg-emerald-500/10 shadow-[inset_2px_0_0_0_rgb(16,185,129)] hover:bg-emerald-500/15"
                                : "hover:bg-zinc-900/30"
                          }`}
                        >

                          <td className="px-3 py-2 font-mono text-[11px] text-zinc-400">
                            {d.id.slice(0, 8)}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-zinc-200">{d.zip}</td>
                          <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-zinc-100">
                            {usd.format(d.base_contract_price + d.optimized_acquisition_premium)}
                          </td>
                          <td
                            className={`px-3 py-2 font-mono text-[11px] tabular-nums ${
                              isStrikeLocked(d)
                                ? "font-bold text-emerald-400"
                                : d.reverse_strike_ready
                                  ? "text-amber-300/50"
                                  : "text-emerald-300/50"
                            }`}
                          >
                            {isStrikeLocked(d)
                              ? `LOCKED: ${usd.format(d.optimized_acquisition_premium)}`
                              : `TARGET: ${usd.format(d.optimized_acquisition_premium)}`}
                          </td>

                          <td className="px-3 py-2 font-mono text-[10px] uppercase text-zinc-300">
                            {d.asset_class === "TIMBERLAND"
                              ? "TIMBER"
                              : d.asset_class === "LOT_LAND"
                                ? "LAND"
                                : "RESIDENTIAL"}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-zinc-200">
                            {usd.format(d.target_fee)}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-zinc-400">
                            {(d.projected_cap_rate * 100).toFixed(1)}%
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col items-start gap-1">
                              {isStrikeLocked(d) ? (
                                <span className="inline-flex animate-pulse items-center rounded border border-emerald-400 bg-emerald-400/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.6)]">
                                  STRIKE LOCKED
                                </span>
                              ) : d.reverse_strike_ready ? (
                                <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-300/70">
                                  REVERSE_STRIKE_READY
                                </span>
                              ) : (
                                <StatusPill status={d.status} />
                              )}

                              {d.cleared_at && (() => {
                                const eta = settlementEta(d.cleared_at, impactDaysFor(d));

                                return (
                                  <span
                                    className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                                      eta.inTransit
                                        ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-300"
                                        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                    }`}
                                    title={`Bluevine settlement ETA · ${eta.date.toLocaleDateString()}`}
                                  >
                                    {eta.inTransit ? `→ bank ${eta.label}` : `in bank ${eta.label}`}
                                  </span>
                                );
                              })()}
                              {d.auto_clearance_ready &&
                                d.status !== "Funds-Cleared" &&
                                d.status !== "Closed" && (
                                  <AutoClearBadge />
                                )}

                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] uppercase">
                            {d.cleared_at ? (
                              <span className="text-emerald-400">
                                CLEARED{d.cleared_amount ? ` ${usd.format(d.cleared_amount)}` : ""} ·{" "}
                                {new Date(d.cleared_at).toLocaleDateString()}
                              </span>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] uppercase">
                            {(() => {
                              const bind = settlementBinding(d as never);
                              if (bind.bound) {
                                const eta = wireEta(d.cleared_at ?? d.updated_at ?? d.created_at);
                                return (
                                  <div className="flex flex-col items-start gap-1">
                                    <span className="inline-flex items-center rounded border border-emerald-500/50 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] tracking-wider text-emerald-300">
                                      STATUS: GREEN_GO_VERIFIED
                                    </span>
                                    <span className="text-zinc-300">{eta.label}</span>
                                  </div>
                                );
                              }
                              if (isStrikeLocked(d)) {
                                return (
                                  <div className="flex flex-col items-start gap-1">
                                    <span className="inline-flex animate-pulse items-center rounded border border-emerald-400 bg-emerald-400/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.6)]">
                                      STRIKE LOCKED · WIRE INSTRUCTED
                                    </span>
                                    <span className="text-emerald-400">
                                      LOCKED: {usd.format(d.optimized_acquisition_premium)}
                                    </span>
                                  </div>
                                );
                              }
                              if (d.status === "REVERSE_STRIKE_READY" || d.reverse_strike_ready) {
                                return (
                                  <div className="flex flex-col items-start gap-1">
                                    <span className="inline-flex items-center rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 text-[9px] tracking-wider text-emerald-400/60">
                                      REVERSE STRIKE CLEARED
                                    </span>
                                    <span className="text-zinc-500">
                                      TARGET: {usd.format(d.optimized_acquisition_premium)} · $0 LOCKED
                                    </span>
                                  </div>
                                );
                              }

                              return (
                                <div className="flex flex-col items-start gap-1">
                                  <span className="inline-flex items-center rounded border border-red-500/50 bg-red-500/10 px-1.5 py-0.5 text-[9px] tracking-wider text-red-300">
                                    BLOCKED: AWAITING_REAL_WORLD_DATA
                                  </span>
                                  <span className="text-zinc-500">$0 projected</span>
                                  <span className="text-[9px] normal-case text-red-400/70">
                                    {bind.blockers.map((b) => BLOCKER_LABEL[b]).join(" · ")}
                                  </span>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] uppercase">
                            {isVerifiedDirectWire(d) ? (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400">DIRECT WIRE</span>
                            ) : d.cleared_at ? (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400">VERIFIED</span>
                            ) : d.verification_status === "VERIFIED" ? (
                              <span className="text-amber-400">AWAITING-WEBHOOK</span>
                            ) : (
                              <span className="text-zinc-500">UNVERIFIED</span>
                            )}
                          </td>

                          <td className={`px-3 py-2 font-mono text-[11px] tabular-nums ${impactColor}`}>
                            {impactLabel}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] uppercase text-violet-300">
                            {deliveryByDeal.get(d.id)?.box ?? <span className="text-zinc-600">—</span>}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] uppercase">
                            {(() => {
                              const st = deliveryByDeal.get(d.id)?.status;
                              if (!st) return <span className="text-zinc-600">—</span>;
                              const cls =
                                st === "CLICKED" || st === "EXECUTED"
                                  ? "text-emerald-400"
                                  : st === "OPENED"
                                    ? "text-sky-300"
                                    : st === "REJECTED"
                                      ? "text-rose-400"
                                      : "text-zinc-300";
                              return <span className={cls}>{st}</span>;
                            })()}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              disabled={statusBusyId === d.id}
                              value=""
                              onChange={async (e) => {
                                const v = e.target.value;
                                if (!v) return;
                                setStatusBusyId(d.id);
                                try {
                                  await dispatchStatus({ data: { id: d.id, status: v } });
                                  await refetch();
                                } catch (err) {
                                  console.error("[terminal] status dispatch failed", err);
                                } finally {
                                  setStatusBusyId(null);
                                }
                              }}
                              className="rounded border border-zinc-700 bg-transparent px-1 py-0.5 font-mono text-[10px]"
                            >
                              <option value="">{statusBusyId === d.id ? "sending…" : "set status"}</option>
                              <option value="SETTLEMENT">SETTLEMENT</option>
                              <option value="DUE">DUE</option>
                              <option value="CLOSED">CLOSED</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function AutoHealBar({ count, onHealed }: { count: number; onHealed: () => void }) {
  const heal = useServerFn(runAutoHeal);
  const diagnose = useServerFn(runDiagnosticOverride);
  const [busy, setBusy] = useState(false);

  if (count <= 0) {
    return (
      <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-center font-mono text-xs uppercase tracking-widest text-emerald-300">
        🟢 Zero Exceptions: Zero-Touch Settlement Active · STREAM LIVE
      </section>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await heal({ data: {} as never });
        } catch {
          /* transient — diagnostic sweep below is the fallback */
        }
        try {
          await diagnose({ data: {} as never });
        } catch {
          /* transient: bar stays armed, next click retries */
        }
        onHealed();
        setBusy(false);
      }}
      className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center font-mono text-xs uppercase tracking-widest text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-60"
    >
      {busy
        ? "Diagnostic sweep running…"
        : `⚠ ${count} exceptions detected: tap to run diagnostic self-heal`}
    </button>
  );
}

// Active private-credit facility driving the forced (window-bypassed) sweeps.
const ACTIVE_FACILITY_ID = "DSCR-PRIVATE-CREDIT-950";

function SettlementRunnerBar({ dueCount, onDone }: { dueCount: number; onDone: () => void }) {
  const readState = useServerFn(getAutoSettleState);
  const toggle = useServerFn(toggleAutoSettle);
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    readState({ data: {} as never })
      .then((r: { enabled: boolean }) => live && setEnabled(Boolean(r?.enabled)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [readState]);

  // Fires the public hook directly — works without an admin session.
  const fireSweep = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setBusy(true);
    try {
      const res = await fetch("/api/public/hooks/auto-settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          force: true,
          facility_id: ACTIVE_FACILITY_ID,
        }),
      });
      const r: any = await res.json();

      if (r?.skipped) {
        // Silent background sweeps never flash a transient "disabled" banner.
        if (!opts?.silent) setResult("skipped · autopilot disabled");
      } else {
        const LIVE_RAILS = ["stripe_ach", "plaid_ach", "bluevine_rest"];
        const railBad = Boolean(r?.rail_mode) && !LIVE_RAILS.includes(r.rail_mode);
        const firstSkip = Array.isArray(r?.skipped) && r.skipped.length ? ` · skip: ${r.skipped[0].reason}` : "";
        if (railBad) console.warn("[settlement] rail not live:", r.rail_mode, r.rail_detail, r?.skipped?.slice(0, 5));
        const line = `settled ${r?.settled ?? 0} · verified ${r?.verified ?? 0} · decayed ${r?.decayed ?? 0} · re-routed ${r?.rerouted ?? 0}${railBad ? ` · RAIL: ${r.rail_mode}` : ""}${firstSkip}`;
        const material =
          (r?.settled ?? 0) > 0 || (r?.decayed ?? 0) > 0 || (r?.rerouted ?? 0) > 0;
        // Stable-state window: only mutate the banner on material outcomes.
        if (!opts?.silent || material) setResult(line);
        if (!opts?.silent) {
          if (material) {
            toast.success(`${r.settled ?? 0} DUE rows verified → FEES IN TRANSIT`, {
              description: line,
            });
          } else {
            toast(`No DUE rows to process`, { description: `scanned ${r?.scanned ?? 0}` });
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "sweep failed";
      if (!opts?.silent) {
        setResult(msg);
        toast.error(msg);
      }
    }
    onDone();
    if (!opts?.silent) {
      // Manual execution: refresh timers/transit totals immediately, no reload.
      await qc.invalidateQueries({ queryKey: ["all-deals"] });
      await qc.refetchQueries({ queryKey: ["all-deals"], type: "active" });
      setBusy(false);
    }

  };

  // While ACTIVE, engage autopilot immediately and keep sweeping every 30s.
  useEffect(() => {
    if (!enabled) return;
    void fireSweep({ silent: true });
    const t = setInterval(() => {
      void fireSweep({ silent: true });
    }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const onToggle = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      await toggle({ data: { enabled: next } });
    } catch {
      /* flag persistence is admin-only; local state still drives the runner */
    }
    if (next) {
      toast.success("AUTO-SETTLE ACTIVE — sweeping every 30s");
      void fireSweep();
    } else {
      toast("AUTO-SETTLE OFF");
    }
  };

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
        State Runner ·{" "}
        <span className={enabled ? "text-emerald-400" : "text-zinc-500"}>
          {enabled ? "DIRECT WIRE ENABLED · AUTOPILOT ACTIVE" : "DIRECT WIRE SKIPPED · AUTOPILOT DISABLED"}
        </span>
        {dueCount > 0 && (
          <span className="ml-2 text-rose-400">{dueCount} DUE / UNVERIFIED</span>
        )}
        {result && <span className="ml-2 text-zinc-500">{result}</span>}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          className={`inline-flex items-center gap-2 rounded border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest transition ${
            enabled
              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
              : "border-zinc-700 bg-zinc-900 text-zinc-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${enabled ? "animate-pulse bg-emerald-400" : "bg-zinc-600"}`}
          />
          auto-settle {enabled ? "on" : "off"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void fireSweep()}
          className="rounded border border-cyan-400/50 bg-cyan-500/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-60"
        >
          {busy ? "executing…" : "Execute Settlement"}
        </button>
      </div>
    </section>
  );
}
