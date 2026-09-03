import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getUatRuns, runUatEnclave, runBurstTest } from "@/lib/uat-enclave.functions";
import type { BurstResult } from "@/lib/uat-burst.server";

export function UatEnclavePanel() {
  const fetchRuns = useServerFn(getUatRuns);
  const fireRun = useServerFn(runUatEnclave);
  const fireBurst = useServerFn(runBurstTest);
  const qc = useQueryClient();
  const [last, setLast] = useState<string | null>(null);
  const [burst, setBurst] = useState<BurstResult | null>(null);

  const burstRun = useMutation({
    mutationFn: () =>
      fireBurst({ data: { origin: window.location.origin, count: 200, concurrency: 25 } }),
    onSuccess: (r: BurstResult) => setBurst(r),
    onError: (e: Error) =>
      setBurst({
        requested: 0,
        fired: 0,
        accepted: 0,
        replayed: 0,
        rejected: 0,
        duplicates_fired: 0,
        duplicates_caught: 0,
        reject_reasons: {},
        wall_ms: 0,
        tps: 0,
        p50_ms: 0,
        p95_ms: 0,
        max_ms: 0,
        error: e.message,
      }),
  });

  const runs = useQuery({
    queryKey: ["m2m", "uat-runs"],
    queryFn: () => fetchRuns(),
    refetchInterval: 30_000,
    retry: false,
  });

  const run = useMutation({
    mutationFn: () =>
      fireRun({
        data: { origin: window.location.origin, amountUsd: 0.01 },
      }),
    onSuccess: (r: import("@/lib/uat-enclave.server").UatRun) => {
      setLast(
        `${r.ok ? "PASS" : "FAIL"} · sig ${r.signature_ok ? "OK" : "REJECTED"} · handshake ${r.handshake_status ?? "—"} · idempotent ${r.replay_was_idempotent ? "YES" : "NO"} · rail ${r.rail_status ?? "—"}${r.error ? ` · ${r.error}` : ""}`,
      );
      void qc.invalidateQueries({ queryKey: ["m2m", "uat-runs"] });
    },
    onError: (e: Error) => setLast(`ERROR · ${e.message}`),
  });

  const rows = runs.data?.runs ?? [];

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          uat enclave · live-rail acceptance test
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          KEY {runs.data?.key_id ?? "unprovisioned"}
        </span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Signs an HMAC-SHA256 order as an external counterparty, posts it to the live execute
        endpoint, replays the same transaction id to prove no double-execution, then settles a real
        $0.01 through the production banking rail.
      </p>

      <button
        onClick={() => run.mutate()}
        disabled={run.isPending}
        className="mt-3 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-emerald-400 disabled:opacity-50"
      >
        {run.isPending ? "executing handshake…" : "run closed-loop test"}
      </button>

      <button
        onClick={() => burstRun.mutate()}
        disabled={burstRun.isPending}
        className="ml-2 mt-3 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-amber-400 disabled:opacity-50"
      >
        {burstRun.isPending ? "flooding rails…" : "burst load · 200 strikes"}
      </button>

      {burst && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-md border bg-muted/40 p-2 font-mono text-[10px] sm:grid-cols-4">
          {burst.error ? (
            <span className="col-span-full text-destructive">ERROR · {burst.error}</span>
          ) : (
            <>
              <span>FIRED {burst.fired}</span>
              <span className="text-emerald-500">ACCEPTED {burst.accepted}</span>
              <span>REPLAYED {burst.replayed}</span>
              <span className={burst.rejected ? "text-amber-400" : ""}>
                REJECTED {burst.rejected}
              </span>
              <span>TPS {burst.tps}</span>
              <span>p50 {burst.p50_ms}ms</span>
              <span>p95 {burst.p95_ms}ms</span>
              <span>
                DUP-GUARD {burst.duplicates_caught}/{burst.duplicates_fired}
              </span>
              {Object.entries(burst.reject_reasons).length > 0 && (
                <span className="col-span-full text-muted-foreground">
                  {Object.entries(burst.reject_reasons)
                    .map(([k, v]) => `${k}×${v}`)
                    .join(" · ")}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {last && (
        <div className="mt-2 rounded-md border bg-muted/40 p-2 font-mono text-[11px]">{last}</div>
      )}

      {rows.length > 0 && (
        <ul className="mt-3 space-y-1">
          {rows.map((r) => (
            <li
              key={r.id}
              className="grid grid-cols-2 gap-x-3 rounded-md border px-2 py-1.5 font-mono text-[10px] sm:grid-cols-5"
            >
              <span className={r.signature_ok ? "text-emerald-500" : "text-destructive"}>
                SIG {r.signature_ok ? "OK" : "FAIL"}
              </span>
              <span>HTTP {r.handshake_status ?? "—"}</span>
              <span>${Number(r.amount_usd).toFixed(2)}</span>
              <span className={r.rail_status === "failed" ? "text-destructive" : ""}>
                RAIL {r.rail_status ?? "—"}
              </span>
              <span className="text-muted-foreground">{r.latency_ms ?? 0}ms</span>
              {r.error_text && (
                <span className="col-span-2 truncate text-destructive sm:col-span-5">
                  {r.error_text}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
