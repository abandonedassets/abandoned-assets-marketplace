import type { HeartbeatState } from "@/hooks/use-heartbeat-latency";

/** Terminal-wide banner for the Stale-State Circuit Breaker. */
export function StaleStateBreaker({
  hb,
  suspended,
}: {
  hb: HeartbeatState;
  suspended: number;
}) {
  if (!hb.stale) {
    return (
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-emerald-400">
        <span>●</span>
        <span>socket live · {hb.latencyMs ?? "—"}ms rtt</span>
      </div>
    );
  }

  return (
    <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-amber-300">
      ● stale-state circuit breaker engaged ·{" "}
      {hb.reason === "disconnected"
        ? "socket disconnected"
        : `heartbeat ${hb.latencyMs ?? "—"}ms over 500ms budget`}{" "}
      · {suspended} reverse_strike_ready asset{suspended === 1 ? "" : "s"} suspended
    </div>
  );
}
