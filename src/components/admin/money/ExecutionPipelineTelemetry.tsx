import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getExecutionSnapshot } from "@/lib/execution-telemetry.functions";
import {
  EXECUTION_STATES,
  accentFor,
  deriveExecutionState,
  type ExecutionRow,
  type ExecutionState,
} from "@/lib/execution-states";

type Pulse = {
  key: string;
  id: string;
  label: string;
  from: ExecutionState | null;
  to: ExecutionState;
  fee: number;
  at: string;
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * Backend-truth telemetry. Initial state = one server snapshot.
 * Every subsequent transition is pushed by Postgres realtime — no timers,
 * no optimistic transitions, no synthetic rows. Quiet DB = quiet UI.
 */
export function ExecutionPipelineTelemetry() {
  const fetchSnapshot = useServerFn(getExecutionSnapshot);
  const snap = useQuery({
    queryKey: ["mt", "execution-snapshot"],
    queryFn: () => fetchSnapshot({ data: undefined as never }),
    retry: false,
    staleTime: Infinity,
  });

  const [rows, setRows] = useState<Map<string, ExecutionRow>>(new Map());
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [live, setLive] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (!snap.data) return;
    setRows(new Map(snap.data.rows.map((r) => [r.id, r])));
  }, [snap.data]);

  useEffect(() => {
    const channel = supabase
      .channel("execution-telemetry")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "closing_pipeline_items" },
        (payload) => {
          const next = payload.new as ExecutionRow | null;
          if (!next?.id) return;
          const prev = rowsRef.current.get(next.id) ?? null;
          const to = deriveExecutionState(next);
          const from = prev ? deriveExecutionState(prev) : null;

          setRows((m) => {
            const copy = new Map(m);
            copy.set(next.id, { ...(prev ?? {}), ...next });
            return copy;
          });
          setLastEventAt(new Date().toISOString());

          if (from !== to) {
            setPulses((p) =>
              [
                {
                  key: `${next.id}-${Date.now()}`,
                  id: next.id,
                  label: next.address ?? next.zip ?? next.id.slice(0, 8),
                  from,
                  to,
                  fee: Number(next.optimized_acquisition_premium ?? 0),
                  at: new Date().toISOString(),
                },
                ...p,
              ].slice(0, 40),
            );
          }
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const buckets = useMemo(() => {
    const b = new Map<ExecutionState, { count: number; fee: number }>(
      EXECUTION_STATES.map((s) => [s, { count: 0, fee: 0 }]),
    );
    for (const r of rows.values()) {
      const s = deriveExecutionState(r);
      const cur = b.get(s) ?? { count: 0, fee: 0 };
      cur.count += 1;
      cur.fee += Number(r.optimized_acquisition_premium ?? 0);
      b.set(s, cur);
    }
    return b;
  }, [rows]);

  // Known lanes first, then every unmapped raw status surfaced explicitly.
  const laneKeys = useMemo(
    () => [
      ...EXECUTION_STATES,
      ...[...buckets.keys()].filter((k) => !(EXECUTION_STATES as readonly string[]).includes(k)).sort(),
    ],
    [buckets],
  );

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          execution pipeline · backend truth
        </h2>
        <span
          className={`font-mono text-[10px] ${live ? "text-emerald-500" : "text-muted-foreground"}`}
        >
          ● {live ? "SSE STREAM LIVE" : "STREAM CONNECTING"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {laneKeys.map((s) => {
          const v = buckets.get(s) ?? { count: 0, fee: 0 };
          const hot = pulses[0]?.to === s;
          return (
            <div
              key={s}
              className={`rounded-md border bg-background/50 p-2 transition-colors ${accentFor(s)} ${
                hot ? "ring-1 ring-current" : ""
              }`}
            >
              <div className="font-mono text-[9px] uppercase tracking-widest">
                {s.replaceAll("_", " ")}
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                {v.count.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">{fmt(v.fee)}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 max-h-64 overflow-auto rounded border border-border bg-background/60 p-2 font-mono text-[10px]">
        {pulses.length === 0 ? (
          <p className="text-muted-foreground">
            {live
              ? "Rail armed. No state transitions broadcast yet — this log only writes when the database moves."
              : "Awaiting realtime channel…"}
          </p>
        ) : (
          pulses.map((p) => (
            <div key={p.key} className="flex flex-wrap gap-x-2 border-b border-border/40 py-1">
              <span className="text-muted-foreground">
                {new Date(p.at).toISOString().replace("T", " ").slice(11, 23)}
              </span>
              <span className="text-muted-foreground">{p.from ?? "NEW"}</span>
              <span>→</span>
              <span className={accentFor(p.to).split(" ").pop()}>{p.to}</span>
              <span className="truncate">{p.label}</span>
              <span className="ml-auto text-emerald-500">{fmt(p.fee)}</span>
            </div>
          ))
        )}
      </div>

      {lastEventAt && (
        <p className="mt-1 font-mono text-[9px] text-muted-foreground">
          last backend broadcast {new Date(lastEventAt).toLocaleTimeString()}
        </p>
      )}
    </section>
  );
}
