import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  getEscrowBoundCapital,
  getTransmissionTelemetry,
  getStallWatch,
} from "@/lib/admin-money.functions";
import { listPipelineItems } from "@/lib/pipeline.functions";
import { settlementBinding, BLOCKER_LABEL } from "@/lib/settlement-binding";
import { listFboPairs } from "@/lib/inbound-wire.functions";
import { getRolloverStatus, getRecentCleared } from "@/lib/rollover.functions";
import { getCviMetrics } from "@/lib/cvi.functions";
import { getAutoReleaseStatus } from "@/lib/banking.functions";
import { getLedgerTape } from "@/lib/btr.functions";
import { LEDGER_LABELS, type LedgerKey } from "@/lib/btr-routing";
import { sectorBadges, SECTOR_TONE } from "@/lib/sector-badges";
import { getStateResetDiagnostics } from "@/lib/state-reset.functions";
import { deriveExecutionState, isUnmapped } from "@/lib/execution-states";
import { wireEta } from "@/lib/wire-eta";

import { setDealStatusAndDispatch } from "@/lib/status-dispatch.functions";
import { EscrowCapitalTicker } from "@/components/admin/money/EscrowCapitalTicker";
import { StallWatchlist } from "@/components/admin/money/StallWatchlist";
import { TransmissionTelemetryLog } from "@/components/admin/money/TransmissionTelemetryLog";
import { TomorrowPipeline } from "@/components/admin/money/TomorrowPipeline";
import { ClearedDaysToBank } from "@/components/admin/money/ClearedDaysToBank";
import { CapitalVelocityIndex } from "@/components/admin/money/CapitalVelocityIndex";
import { AssemblageRadar } from "@/components/admin/money/AssemblageRadar";
import { OutboundTelemetryCard } from "@/components/admin/money/OutboundTelemetryCard";
import { DeliveryAuditTable } from "@/components/admin/money/DeliveryAuditTable";
import { LiveSettlementFeed } from "@/components/admin/money/LiveSettlementFeed";
import { AlgoNodeHeartbeat } from "@/components/admin/money/AlgoNodeHeartbeat";
import { StateTransitionMatrix } from "@/components/admin/money/StateTransitionMatrix";
import { UatEnclavePanel } from "@/components/admin/money/UatEnclavePanel";
import { DarkCrossPanel } from "@/components/admin/money/DarkCrossPanel";

import { InboundListenerDiagnostics } from "@/components/admin/InboundListenerDiagnostics";
import { GatewayConnector } from "@/components/admin/GatewayConnector";
import { BeneficiaryLiability } from "@/components/admin/BeneficiaryLiability";
import { RecipientSplitRouting } from "@/components/admin/RecipientSplitRouting";
import { ExecutionPipelineTelemetry } from "@/components/admin/money/ExecutionPipelineTelemetry";
import { AutonomousResolution } from "@/components/admin/AutonomousResolution";
import { WidgetBoundary } from "@/components/WidgetBoundary";
import { useIsViewer } from "@/hooks/use-viewer-role";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Master Settlement Terminal — Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: MasterTerminal,
});

// Backend-truth only: refetch is driven by realtime broadcasts, not timers.
const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(Number(n)).toLocaleString()}`;

const TABS = ["Terminal Overview", "Deal Tape", "Inbound Rail", "Banking & Credentials", "System Logs"] as const;
type Tab = (typeof TABS)[number];

const LEDGER_ACCENT: Record<LedgerKey, string> = {
  PRIMARY: "border-emerald-500/50 text-emerald-400",
  JACQUITA: "border-sky-500/50 text-sky-400",
  DAUGHTER: "border-amber-500/50 text-amber-400",
};
const LEDGER_SHORT: Record<LedgerKey, string> = {
  PRIMARY: "Operator",
  JACQUITA: "Jaquita — IN Modular",
  DAUGHTER: "Jazmin — ESG",
};

const SETTLED = ["Funds-Cleared", "Closed"];
const IN_TRANSIT = ["Buyer-Signed", "Locked-Escrow-Pending", "In-Escrow", "Webhook_Dispatched", "Wire-Sent"];

function MasterTerminal() {
  const { isViewer } = useIsViewer();
  useRealtimeRefresh("mt");
  const [tab, setTab] = useState<Tab>("Terminal Overview");
  const [filter, setFilter] = useState<"All" | "Due Now" | "Fees in Transit" | "Settled">("All");
  const [q, setQ] = useState("");

  const fetchCapital = useServerFn(getEscrowBoundCapital);
  const fetchTelemetry = useServerFn(getTransmissionTelemetry);
  const fetchStall = useServerFn(getStallWatch);
  const fetchPipeline = useServerFn(listPipelineItems);
  const fetchRollover = useServerFn(getRolloverStatus);
  const fetchCleared = useServerFn(getRecentCleared);
  const fetchCvi = useServerFn(getCviMetrics);
  const fetchFbo = useServerFn(listFboPairs);
  const fetchRelease = useServerFn(getAutoReleaseStatus);
  const dispatchStatus = useServerFn(setDealStatusAndDispatch);
  const fetchLedger = useServerFn(getLedgerTape);
  const fetchResets = useServerFn(getStateResetDiagnostics);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function mutateStatus(id: string, status: string) {
    setBusyId(id);
    try {
      await dispatchStatus({ data: { id, status } });
      await pipeline.refetch();
    } catch (e) {
      console.error("[terminal] status dispatch failed", e);
    } finally {
      setBusyId(null);
    }
  }

  const capital = useQuery({ queryKey: ["mt", "capital"], queryFn: () => fetchCapital() });
  const telemetry = useQuery({ queryKey: ["mt", "telemetry"], queryFn: () => fetchTelemetry() });
  const stall = useQuery({ queryKey: ["mt", "stall"], queryFn: () => fetchStall() });
  const pipeline = useQuery({ queryKey: ["mt", "pipeline"], queryFn: () => fetchPipeline() });
  const rollover = useQuery({ queryKey: ["mt", "rollover"], queryFn: () => fetchRollover() });
  const cleared = useQuery({ queryKey: ["mt", "cleared"], queryFn: () => fetchCleared() });
  const cvi = useQuery({ queryKey: ["mt", "cvi"], queryFn: () => fetchCvi() });
  const fbo = useQuery({ queryKey: ["mt", "fbo"], queryFn: () => fetchFbo(), retry: false });
  const release = useQuery({ queryKey: ["mt", "release"], queryFn: () => fetchRelease(), retry: false });
  const ledger = useQuery({ queryKey: ["mt", "ledger"], queryFn: () => fetchLedger(), retry: false });
  const resets = useQuery({ queryKey: ["mt", "resets"], queryFn: () => fetchResets(), retry: false });

  const resetMap = useMemo(() => {
    const m = new Map<string, { at: string; source: string; detail: string }>();
    for (const r of resets.data ?? [])
      m.set(r.pipeline_item_id, { at: r.at, source: r.source, detail: r.detail });
    return m;
  }, [resets.data]);


  const ledgerMap = useMemo(() => {
    const m = new Map<string, { ledger: LedgerKey; flags: string[]; block_id: string | null }>();
    for (const r of ledger.data?.tape ?? [])
      m.set(r.id, { ledger: r.ledger as LedgerKey, flags: r.flags, block_id: r.block_id });
    return m;
  }, [ledger.data]);

  const blockCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ledger.data?.tape ?? [])
      if (r.block_id) m.set(r.block_id, (m.get(r.block_id) ?? 0) + 1);
    return m;
  }, [ledger.data]);

  const ledgerTotals = (ledger.data?.totals ?? {}) as Record<string, { count: number; basis: number }>;

  const items = pipeline.data ?? [];
  const fboMap = useMemo(() => {
    const m = new Map<string, { acct: string; routing: string; status: string }>();
    for (const f of fbo.data ?? [])
      m.set(f.pipeline_item_id, { acct: f.fbo_account_number, routing: f.routing_number, status: f.status });
    return m;
  }, [fbo.data]);

  const portfolioVolume = items.reduce((s, i) => s + Number(i.base_contract_price ?? 0), 0);
  const inTransit = items.filter((i) => IN_TRANSIT.includes(String(i.status)));
  const settled = items.filter(
    (i) => SETTLED.includes(String(i.status)) || String(i.payout_status) === "SETTLED_PAID",
  );
  const feesInTransit = inTransit.reduce((s, i) => s + Number(i.optimized_acquisition_premium ?? 0), 0);
  const settledCapital = settled.reduce((s, i) => s + Number(i.optimized_acquisition_premium ?? 0), 0);
  const railsLive = Boolean((release.data as any)?.rails_ok ?? (release.data as any)?.ok);

  const tape = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((i) => {
      const st = String(i.status);
      if (filter === "Due Now" && !["Webhook_Dispatched", "Locked-Escrow-Pending", "In-Escrow"].includes(st)) return false;
      if (filter === "Fees in Transit" && !IN_TRANSIT.includes(st)) return false;
      if (filter === "Settled" && !SETTLED.includes(st)) return false;
      if (!term) return true;
      return `${i.address ?? ""} ${i.zip ?? ""} ${i.external_id ?? ""} ${i.id}`.toLowerCase().includes(term);
    });
  }, [items, filter, q]);

  return (
    <main className="min-h-screen bg-background p-3 md:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              /admin · master settlement terminal
            </h1>
            <p className="text-xl font-semibold sm:text-2xl">Unified Control Room</p>
          </div>
          <span
            className={`rounded-full border px-3 py-1 font-mono text-[11px] ${
              railsLive
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/40 bg-amber-500/10 text-amber-400"
            }`}
          >
            ● {railsLive ? "AUTONOMOUS TRANSIT ACTIVE" : "RAILS PENDING VERIFICATION"}
          </span>
        </header>

        {/* Unified financial bar */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Portfolio Volume" value={fmtMoney(portfolioVolume)} />
          <Stat label="Fees in Transit" value={fmtMoney(feesInTransit)} />
          <Stat label="Cleared / Settled" value={fmtMoney(settledCapital)} accent />
          <Stat label="FBO Accounts" value={(fbo.data?.length ?? 0).toLocaleString()} />
          <Stat label="Active Assets" value={items.length.toLocaleString()} />
        </div>

        {/* Persistent in-app tabs */}
        <nav className="flex flex-wrap gap-1 rounded-lg border bg-card p-1 font-mono text-[11px]">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1.5 uppercase tracking-wide transition ${
                tab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {t}
            </button>
          ))}
          <div className="ml-auto flex gap-1">
            <Link to="/admin/pipeline" className="rounded px-3 py-1.5 hover:bg-muted">Pipeline</Link>
            <Link to="/admin/ingest" className="rounded px-3 py-1.5 hover:bg-muted">Ingest</Link>
            <Link to="/admin/mission-control" className="rounded px-3 py-1.5 hover:bg-muted">Mission Control</Link>
            <Link to="/admin/treasury" className="rounded px-3 py-1.5 hover:bg-muted">Treasury</Link>
          </div>
        </nav>

        {/* Unified ledger split — backend truth from the BTR routing engine */}
        <div className="grid gap-3 sm:grid-cols-3">
          {(["PRIMARY", "JACQUITA", "DAUGHTER"] as LedgerKey[]).map((k) => (
            <div key={k} className={`rounded-lg border bg-card p-3 ${LEDGER_ACCENT[k]}`}>
              <div className="font-mono text-[10px] uppercase tracking-widest opacity-80">
                {LEDGER_LABELS[k]}
              </div>
              <div className="mt-1 font-mono text-xl">{ledgerTotals[k]?.count ?? 0}</div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {fmtMoney(ledgerTotals[k]?.basis ?? 0)} basis
              </div>
            </div>
          ))}
        </div>

        {tab === "Terminal Overview" && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <WidgetBoundary label="autonomous-resolution">
                <AutonomousResolution />
              </WidgetBoundary>
              <WidgetBoundary label="execution-pipeline">
                <ExecutionPipelineTelemetry />
              </WidgetBoundary>
              <WidgetBoundary label="settlement-feed">
                <LiveSettlementFeed />
              </WidgetBoundary>
              <WidgetBoundary label="algo-nodes">
                <AlgoNodeHeartbeat />
              </WidgetBoundary>
              <WidgetBoundary label="state-matrix">
                <StateTransitionMatrix />
              </WidgetBoundary>
              <WidgetBoundary label="uat-enclave">
                <UatEnclavePanel />
              </WidgetBoundary>
              <WidgetBoundary label="dark-cross">
                <DarkCrossPanel />
              </WidgetBoundary>

              <WidgetBoundary label="cvi">
                {cvi.data ? <CapitalVelocityIndex data={cvi.data} /> : <Skel h="h-32" />}
              </WidgetBoundary>
              <WidgetBoundary label="outbound-telemetry">
                <OutboundTelemetryCard />
              </WidgetBoundary>
              <WidgetBoundary label="delivery-audit">
                <DeliveryAuditTable />
              </WidgetBoundary>
              <AssemblageRadar />


              <WidgetBoundary label="escrow-capital">
                {capital.data ? <EscrowCapitalTicker data={capital.data} /> : <Skel h="h-32" />}
              </WidgetBoundary>
              <WidgetBoundary label="days-to-bank">
                {cleared.data ? <ClearedDaysToBank rows={cleared.data} /> : <Skel h="h-40" />}
              </WidgetBoundary>
            </div>
            <div className="space-y-4">
              <WidgetBoundary label="inbound-diagnostics">
                <InboundListenerDiagnostics />
              </WidgetBoundary>
              <WidgetBoundary label="tomorrow-pipeline">
                {rollover.data ? <TomorrowPipeline data={rollover.data} /> : <Skel h="h-32" />}
              </WidgetBoundary>
              <WidgetBoundary label="stall-watch">
                {stall.data ? <StallWatchlist rows={stall.data} /> : <Skel h="h-32" />}
              </WidgetBoundary>
            </div>
          </div>
        )}

        {tab === "Deal Tape" && (
          <section className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b p-3 font-mono text-[11px]">
              {(["All", "Due Now", "Fees in Transit", "Settled"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded border px-2 py-1 uppercase ${
                    filter === f ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  {f}
                </button>
              ))}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="search address / zip / id"
                className="ml-auto w-52 rounded border bg-background px-2 py-1"
              />
              <span className="text-muted-foreground">{tape.length} rows</span>
            </div>
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full font-mono text-[11px]">
                <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">Asset</th>
                    <th className="p-2">Ledger</th>
                    <th className="p-2">BTR Block</th>
                    <th className="p-2">Compliance</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Last State Reset Reason</th>
                    <th className="p-2">FBO Account</th>
                    <th className="p-2">Routing</th>
                    <th className="p-2">Buyer Match</th>
                    <th className="p-2 text-right">Fee</th>
                    <th className="p-2">Payout Route</th>
                    <th className="p-2">ETA to Bluevine</th>
                    <th className="p-2">Dispatch</th>
                  </tr>
                </thead>
                <tbody>
                  {tape.slice(0, 800).map((i) => {
                    const f = fboMap.get(i.id);
                    const lg = ledgerMap.get(i.id);
                    const lk = (lg?.ledger ?? "PRIMARY") as LedgerKey;
                    const adjacent = lg?.block_id ? (blockCounts.get(lg.block_id) ?? 0) : 0;
                    return (
                      <tr
                        key={i.id}
                        className={`border-t border-border/60 hover:bg-muted/30 ${
                          adjacent > 1 ? "bg-emerald-500/5 border-l-2 border-l-emerald-500/60" : ""
                        }`}
                      >
                        <td className="p-2">
                          <div className="max-w-[220px] truncate">{i.address ?? i.external_id ?? i.id.slice(0, 8)}</div>
                          <div className="text-muted-foreground">{i.city ?? ""} {i.zip ?? ""}</div>
                        </td>
                        <td className="p-2">
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${LEDGER_ACCENT[lk]}`}>
                            {LEDGER_SHORT[lk]}
                          </span>
                        </td>
                        <td className="p-2">
                          {lg?.block_id ? (
                            <span className="text-emerald-400">
                              {lg.block_id.slice(0, 8)} · {adjacent} parcels
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            {(lg?.flags ?? []).map((fl) => (
                              <span
                                key={fl}
                                className={`rounded border px-1 py-0.5 text-[9px] ${
                                  fl === "ESG_CARBON_CREDIT_ELIGIBLE"
                                    ? "border-amber-500/50 text-amber-400"
                                    : "border-sky-500/50 text-sky-400"
                                }`}
                              >
                                {fl}
                              </span>
                            ))}
                            {sectorBadges(i, lk, Boolean(lg?.block_id)).map((b) => (
                              <span
                                key={b.tag}
                                className={`rounded border px-1 py-0.5 text-[9px] ${SECTOR_TONE[b.tone]}`}
                              >
                                {b.tag}
                              </span>
                            ))}
                          </div>
                        </td>

                        <td className="p-2">{settlementLabel(i)}</td>
                        <td className="p-2">
                          {isUnmapped(deriveExecutionState(i as never)) ? (
                            (() => {
                              const rr = resetMap.get(i.id);
                              return rr ? (
                                <span
                                  title={`${rr.source} · ${rr.at} · ${rr.detail}`}
                                  className="block max-w-[240px] truncate text-amber-400"
                                >
                                  {rr.source}: {rr.detail}
                                </span>
                              ) : (
                                <span className="text-muted-foreground" title="No reset event recorded — status is simply unmapped by deriveExecutionState()">
                                  unmapped status ({String(i.status)})
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2">{f?.acct ?? <span className="text-amber-500">unassigned</span>}</td>
                        <td className="p-2">{f?.routing ?? "—"}</td>
                        <td className="p-2">{f ? (f.status === "funded" ? "FUNDED" : "AWAITING WIRE") : "—"}</td>
                        <td className="p-2 text-right">{fmtMoney(i.optimized_acquisition_premium)}</td>
                        <td className="p-2 text-muted-foreground">Bluevine Primary</td>
                        <td className="p-2">
                          {isPendingWire(i as never) ? (
                            (() => {
                              const eta = wireEta((i as never as { payout_at?: string | null; updated_at?: string | null }).payout_at ?? (i as never as { updated_at?: string | null }).updated_at ?? null);
                              return (
                                <span
                                  className="font-semibold text-violet-300"
                                  title={`FedWire T+2 banking days · projected ${eta.arrival.toDateString()}`}
                                >
                                  {eta.label}
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2">
                          {isViewer ? (
                            <span className="text-muted-foreground">read-only</span>
                          ) : (
                          <select
                            disabled={busyId === i.id}
                            value=""
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v) void mutateStatus(i.id, v);
                            }}
                            className="rounded border bg-background px-1 py-0.5 text-[10px]"
                          >
                            <option value="">{busyId === i.id ? "sending…" : "set status"}</option>
                            <option value="SETTLEMENT">SETTLEMENT</option>
                            <option value="DUE">DUE</option>
                            <option value="CLOSED">CLOSED</option>
                          </select>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "Inbound Rail" && (
          <WidgetBoundary label="inbound-rail">
            <InboundListenerDiagnostics />
          </WidgetBoundary>
        )}

        {tab === "Banking & Credentials" && isViewer && (
          <div className="rounded-lg border bg-card p-6 font-mono text-[11px] text-muted-foreground">
            READ-ONLY SEAT — banking credentials and payout routing are hidden.
          </div>
        )}

        {tab === "Banking & Credentials" && !isViewer && (
          <div className="space-y-4">
            <WidgetBoundary label="gateway"><GatewayConnector /></WidgetBoundary>
            <WidgetBoundary label="liability"><BeneficiaryLiability /></WidgetBoundary>
            <WidgetBoundary label="splits"><RecipientSplitRouting /></WidgetBoundary>
          </div>
        )}

        {tab === "System Logs" && (
          <WidgetBoundary label="telemetry">
            {telemetry.data ? (
              <TransmissionTelemetryLog rows={telemetry.data} updatedAt={telemetry.dataUpdatedAt} />
            ) : (
              <Skel h="h-64" />
            )}
          </WidgetBoundary>
        )}
      </div>
    </main>
  );
}

function isPendingWire(i: { status?: string | null; payout_status?: string | null }) {
  return IN_TRANSIT.includes(String(i.status)) || String(i.payout_status) === "WIRE_PENDING_VERIFICATION";
}

function settlementLabel(i: {
  status: string | null;
  payout_status?: string | null;
  payout_at?: string | null;
  updated_at?: string | null;
  cleared_at?: string | null;
  payout_provider_transfer_id?: string | null;
  verification_status?: string | null;
  signed_contract_hash?: string | null;
  verified_counterparty_id?: string | null;
  title_escrow_file_number?: string | null;
}) {
  if (String(i.status) === "REVERSE_STRIKE_READY") {
    return (
      <span className="rounded border border-emerald-400/60 bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-300">
        REVERSE STRIKE CLEARED
      </span>
    );
  }
  if (isPendingWire(i)) {
    const gate = settlementBinding(i as never);
    return gate.bound ? (
      <span className="rounded border border-emerald-400/60 bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-300">
        STATUS: GREEN_GO_VERIFIED
      </span>
    ) : (
      <span
        className="rounded border border-red-400/60 bg-red-500/15 px-1.5 py-0.5 font-semibold text-red-300"
        title={gate.blockers.map((b) => BLOCKER_LABEL[b]).join(" · ")}
      >
        BLOCKED: AWAITING_REAL_WORLD_DATA
      </span>
    );
  }
  if (String(i.payout_status) === "SETTLED_PAID") {
    const start = i.payout_at ? new Date(i.payout_at) : new Date();
    const dep = new Date(start);
    let left = 2;
    while (left > 0) {
      dep.setDate(dep.getDate() + 1);
      const dow = dep.getDay();
      if (dow !== 0 && dow !== 6) left--;
    }
    const days = Math.max(0, Math.ceil((dep.getTime() - Date.now()) / 86_400_000));
    return (
      <span className="rounded border border-emerald-500/50 px-1.5 py-0.5 text-emerald-400">
        {days === 0 ? "FUNDS CLEARED" : `WIRED • ${days}D TO DEPOSIT`}
      </span>
    );
  }
  return <span className="text-muted-foreground">{String(i.status ?? "—")}</span>;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold sm:text-xl ${accent ? "text-emerald-500" : ""}`}>{value}</div>
    </div>
  );
}

function Skel({ h }: { h: string }) {
  return <div className={`${h} animate-pulse rounded-lg border bg-muted/40`} />;
}
