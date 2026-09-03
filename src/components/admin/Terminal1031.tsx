import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import AllocationHeader, { EntityBadge, useAllocations } from "@/components/admin/AllocationHeader";
import {
  get1031Terminal,
  type Terminal1031Snapshot,
  type TerminalBuyer,
  type TerminalDeal,
} from "@/lib/terminal-1031.functions";
import {
  getLockDiagnostics,
  simulateWireSettlement,
  type LockDiagnostics,
} from "@/lib/lock-diagnostics.functions";

const CRONS = ["dlq-replay", "preflight-validate", "price-decay", "self-heal"] as const;

const usd = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(Number(n)).toLocaleString()}`;

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

function countdown(iso: string | null, now: number): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - now;
  if (!isFinite(ms)) return "—";
  if (ms <= 0) return "EXPIRED";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 70%-rule equity spread, the institutional alpha proxy. */
function alpha(d: TerminalDeal): number {
  const arv = Number(d.calculated_arv ?? 0);
  const rehab = Number(d.estimated_repairs ?? 0);
  const price = Number(d.base_contract_price ?? 0);
  if (!arv || !price) return 0;
  return arv * 0.7 - rehab - price;
}

function timberYield(d: TerminalDeal): number {
  return Number(d.estimated_stumpage_mbf ?? 0) || Number(d.timber_density_score ?? 0) * Number(d.acreage ?? 0);
}

function isLive(d: TerminalDeal, now: number): boolean {
  return !!d.m2m_expires_at && Date.parse(d.m2m_expires_at) > now;
}

export default function Terminal1031() {
  const fetchSnap = useServerFn(get1031Terminal);
  const { snap: alloc, err: allocErr } = useAllocations();
  const [snap, setSnap] = useState<Terminal1031Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchDiag = useServerFn(getLockDiagnostics);
  const runSim = useServerFn(simulateWireSettlement);
  const [diag, setDiag] = useState<LockDiagnostics | null>(null);
  const [simMsg, setSimMsg] = useState<string | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        fetchSnap({ data: undefined } as never),
        fetchDiag({ data: undefined } as never).catch(() => null),
      ]);
      setSnap(s);
      if (d) setDiag(d);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [fetchSnap, fetchDiag]);

  const simulate = useCallback(async () => {
    setSimBusy(true);
    try {
      const r = await runSim({ data: { dealId: null } } as never);
      setSimMsg((r as { message: string }).message);
      await load();
    } catch (e) {
      setSimMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSimBusy(false);
    }
  }, [runSim, load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Live bind: any pipeline or buy-box mutation refreshes the tape (debounced).
  useEffect(() => {
    const bump = () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => void load(), 800);
    };
    const channel = supabase
      .channel("terminal-1031")
      .on("postgres_changes", { event: "*", schema: "public", table: "closing_pipeline_items" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "buyer_buy_boxes" }, bump)
      .subscribe();
    return () => {
      if (pending.current) clearTimeout(pending.current);
      supabase.removeChannel(channel);
    };
  }, [load]);

  const buyers = snap?.buyers ?? [];
  const criticalBuyers = useMemo(
    () =>
      buyers.filter((b) => {
        const d = daysLeft(b.irs_identification_deadline ?? b.exchange_deadline_at);
        return b.is_1031_buyer && d != null && d <= 10 && d >= 0;
      }),
    [buyers],
  );
  const criticalZips = useMemo(
    () => new Set(criticalBuyers.flatMap((b) => b.target_zip_codes ?? [])),
    [criticalBuyers],
  );

  const deals = useMemo(() => {
    const rows = (snap?.deals ?? []).slice();
    rows.sort((a, b) => alpha(b) - alpha(a) || timberYield(b) - timberYield(a));
    return rows;
  }, [snap]);

  const allocById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of alloc?.rows ?? []) m.set(r.id, r.primary_beneficiary);
    return m;
  }, [alloc]);

  const outboundById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of diag?.outbound ?? []) m.set(o.deal_id, o.state);
    return m;
  }, [diag]);

  const cronHealth = useMemo(() => {
    const errs = snap?.errors ?? [];
    return CRONS.map((c) => {
      const last = errs.find((e) => e.route.includes(c));
      return { cron: c, last: last ?? null };
    });
  }, [snap]);

  return (
    <div className="min-h-screen bg-background p-4 font-mono text-xs text-foreground">
      <header className="mb-4 flex flex-wrap items-baseline gap-4 border-b border-border pb-3">
        <h1 className="text-base font-bold tracking-widest text-emerald-400">
          1031 COMMERCIAL EXECUTION TERMINAL
        </h1>
        <span className="text-muted-foreground">
          {snap ? `SYNC ${new Date(snap.at).toISOString().slice(11, 19)}Z` : "SYNCING…"}
        </span>
        <span className="text-muted-foreground">DEALS {deals.length}</span>
        <span className="text-amber-400">1031 CRITICAL BUYERS {criticalBuyers.length}</span>
        {err && <span className="text-red-500">ERR :: {err}</span>}
        <button
          type="button"
          onClick={() => void simulate()}
          disabled={simBusy}
          className="ml-auto rounded border border-emerald-400 bg-emerald-500/15 px-2 py-1 font-bold tracking-widest text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {simBusy ? "SETTLING…" : "⚡ SIMULATE WIRE SETTLEMENT"}
        </button>
        {simMsg && <span className="text-emerald-400">[{simMsg}]</span>}
      </header>

      <AllocationHeader snap={alloc} err={allocErr} />

      <section className="mb-5 rounded border border-border p-3">
        <h2 className="mb-2 tracking-widest text-muted-foreground">
          LOCK LIFECYCLE &amp; RELEASE DIAGNOSTICS
        </h2>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {(diag?.events ?? []).length === 0 && (
            <div className="text-muted-foreground">No lock transitions recorded.</div>
          )}
          {(diag?.events ?? []).map((e) => (
            <div key={e.id} className="flex flex-wrap gap-x-3 border-b border-border/40 pb-1">
              <span className="text-muted-foreground">
                {new Date(e.at).toISOString().slice(5, 19)}
              </span>
              <span>{e.deal_id.slice(0, 8)}</span>
              <span className="text-muted-foreground">
                {e.from ?? "—"} → {e.to ?? "—"}
              </span>
              <span
                className={
                  e.reason === "SETTLED"
                    ? "text-emerald-400"
                    : e.reason === "STATE_TRANSITION"
                      ? "text-muted-foreground"
                      : "text-amber-400"
                }
              >
                {e.reason}
              </span>
            </div>
          ))}
        </div>
      </section>




      <section className="mb-5">
        <h2 className="mb-2 tracking-widest text-muted-foreground">45-DAY IDENTIFICATION CLOCKS</h2>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {buyers.length === 0 && <div className="text-muted-foreground">No active buy boxes.</div>}
          {buyers.map((b: TerminalBuyer) => {
            const dl = b.irs_identification_deadline ?? b.exchange_deadline_at;
            const d = daysLeft(dl);
            const critical = b.is_1031_buyer && d != null && d <= 10 && d >= 0;
            return (
              <div
                key={b.id}
                className={`rounded border p-2 ${critical ? "border-amber-500/70 bg-amber-500/5" : "border-border"}`}
              >
                <div className="flex justify-between gap-2">
                  <span className="truncate font-bold">{b.label ?? b.legal_name ?? b.id.slice(0, 8)}</span>
                  <span className="text-muted-foreground">{b.persona}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className={critical ? "text-amber-400" : "text-muted-foreground"}>
                    {dl ? countdown(dl, now) : "NO 1031 CLOCK"}
                  </span>
                  <span>{usd(b.capital_to_deploy_usd)}</span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {(b.target_zip_codes ?? []).length} zips · urgency {b.urgency_score}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-2 tracking-widest text-muted-foreground">
          LIVE DEAL TAPE — BLIND (address sealed pre-lock)
        </h2>
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full min-w-[900px]">
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                {["ASSET", "ZIP", "TYPE", "STATE", "PRICE", "ARV", "ALPHA", "ACRES", "TIMBER", "ENTITY", "OUTBOUND", "LOCK"].map((h) => (
                  <th key={h} className="px-2 py-1 text-left font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => {
                const live = isLive(d, now);
                const critical = d.reverse_strike_ready && d.zip != null && criticalZips.has(d.zip);
                return (
                  <tr
                    key={d.id}
                    className={`border-t border-border/60 ${
                      live ? "bg-emerald-500/10" : critical ? "bg-amber-500/10" : ""
                    }`}
                  >
                    <td className="px-2 py-1 text-muted-foreground">{d.id.slice(0, 8)}</td>
                    <td className="px-2 py-1">{d.zip ?? "—"}</td>
                    <td className="px-2 py-1">{d.asset_type ?? "—"}</td>
                    <td className="px-2 py-1">
                      {critical ? (
                        <span className="text-amber-400">CRITICAL_1031_MATCH</span>
                      ) : d.reverse_strike_ready ? (
                        <span className="text-emerald-400">REVERSE_STRIKE_READY</span>
                      ) : (
                        <span className="text-muted-foreground">{d.status ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-1">{usd(d.base_contract_price)}</td>
                    <td className="px-2 py-1">{usd(d.calculated_arv)}</td>
                    <td className={`px-2 py-1 ${alpha(d) > 0 ? "text-emerald-400" : "text-red-500"}`}>
                      {usd(alpha(d))}
                    </td>
                    <td className="px-2 py-1">{d.acreage ?? "—"}</td>
                    <td className="px-2 py-1">{timberYield(d) ? timberYield(d).toFixed(1) : "—"}</td>
                    <td className="px-2 py-1">
                      <EntityBadge beneficiary={allocById.get(d.id)} />
                    </td>
                    <td className="px-2 py-1">
                      {(() => {
                        const s = outboundById.get(d.id) ?? "NONE";
                        const cls =
                          s === "ACKNOWLEDGED"
                            ? "text-emerald-400"
                            : s === "PENDING DISPATCH"
                              ? "text-amber-400"
                              : s === "TIMED OUT"
                                ? "text-red-500"
                                : "text-muted-foreground";
                        return <span className={cls}>{s === "NONE" ? "—" : s}</span>;
                      })()}
                    </td>
                    <td className="px-2 py-1">
                      {d.lock_phase === "WIRE_IN_FLIGHT" ? (
                        <span className="rounded border border-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 font-bold text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.6)]">
                          WIRE IN FLIGHT · 24H LOCK ACTIVE {countdown(d.m2m_expires_at, now)}
                        </span>
                      ) : live ? (
                        <span className="font-bold text-emerald-400">STRIKE CLAIMED {countdown(d.m2m_expires_at, now)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {deals.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-muted-foreground" colSpan={12}>
                    No inventory on tape.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded border border-border p-3">
          <h2 className="mb-2 tracking-widest text-muted-foreground">AUTONOMOUS CRON STATUS</h2>
          {cronHealth.map(({ cron, last }) => (
            <div key={cron} className="flex justify-between border-b border-border/50 py-1 last:border-0">
              <span>{cron}</span>
              <span className={last ? "text-red-500" : "text-emerald-400"}>
                {last ? `FAULT ${new Date(last.created_at).toISOString().slice(11, 19)}Z` : "NOMINAL"}
              </span>
            </div>
          ))}
        </div>
        <div className="rounded border border-border p-3">
          <h2 className="mb-2 tracking-widest text-muted-foreground">SELF-HEALING TELEMETRY</h2>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {(snap?.errors ?? []).length === 0 && <div className="text-emerald-400">No errors logged.</div>}
            {(snap?.errors ?? []).map((e) => (
              <div key={e.id} className="border-b border-border/40 pb-1">
                <span className={e.severity === "CRITICAL" ? "text-red-500" : "text-amber-400"}>
                  [{e.severity}]
                </span>{" "}
                <span className="text-muted-foreground">{new Date(e.created_at).toISOString().slice(5, 19)}</span>{" "}
                {e.route} — {e.message.slice(0, 140)}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
