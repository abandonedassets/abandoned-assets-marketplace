import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getSystemAudit } from "@/lib/admin-audit.functions";
import { getImmutableAuditLog, type AuditLogRow } from "@/lib/audit-log.functions";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  head: () => ({
    meta: [
      { title: "System Activity Audit · Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AuditPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-red-500" role="alert">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const ts = (s: string | null) => (s ? new Date(s).toLocaleString() : "—");

function AuditPage() {
  const fetchAudit = useServerFn(getSystemAudit);
  const { data, isLoading, error, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ["system-audit"],
    queryFn: () => fetchAudit({ data: {} as any }),
    refetchInterval: 15_000,
  });

  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-6 space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">System Activity Audit</h1>
          <p className="text-xs text-muted-foreground">
            Live signal from the last 24 hours · last refresh {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—"}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">
          {(error as Error).message}
        </div>
      ) : null}

      {isLoading && !data ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-48 rounded-lg border border-border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* Pipeline status snapshot */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold mb-3">Pipeline State (by status)</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.pipeline_status_counts).length === 0 ? (
                <span className="text-sm text-muted-foreground">No pipeline items yet.</span>
              ) : (
                Object.entries(data.pipeline_status_counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([s, n]) => (
                    <span
                      key={s}
                      className="px-2 py-1 rounded-md border border-border text-xs bg-muted/40"
                    >
                      <strong>{n}</strong> {s}
                    </span>
                  ))
              )}
            </div>
          </section>

          {/* Ingest audit */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold mb-3">Ingest Audit (latest 50 runs)</h2>
            {data.ingest_runs.length === 0 ? (
              <p className="text-sm text-amber-400">
                ⚠ No ingest runs recorded. The worker is failing silently or has never executed. Trigger
                <code className="mx-1 px-1 bg-muted rounded">/api/public/hooks/county-ingest</code>
                to verify.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-2">When</th>
                      <th className="py-1 pr-2">Source</th>
                      <th className="py-1 pr-2">Status</th>
                      <th className="py-1 pr-2">Rows</th>
                      <th className="py-1 pr-2">Inserted</th>
                      <th className="py-1 pr-2">DLQ</th>
                      <th className="py-1 pr-2">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ingest_runs.map((r) => (
                      <tr key={r.id} className="border-t border-border/60">
                        <td className="py-1 pr-2 whitespace-nowrap">{ts(r.created_at)}</td>
                        <td className="py-1 pr-2">{r.source}</td>
                        <td className={`py-1 pr-2 ${r.status === "ok" || r.status === "success" ? "text-emerald-400" : "text-red-400"}`}>{r.status}</td>
                        <td className="py-1 pr-2">{r.total_rows}</td>
                        <td className="py-1 pr-2">{r.inserted}</td>
                        <td className="py-1 pr-2">{r.dlq}</td>
                        <td className="py-1 pr-2 max-w-[280px] truncate" title={r.note ?? ""}>{r.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Pipeline recent transitions */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold mb-3">Pipeline Transitions (latest 50 by updated_at)</h2>
            {data.pipeline_recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pipeline items.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-2">Updated</th>
                      <th className="py-1 pr-2">ZIP</th>
                      <th className="py-1 pr-2">Status</th>
                      <th className="py-1 pr-2">Escrow</th>
                      <th className="py-1 pr-2">Base</th>
                      <th className="py-1 pr-2">Premium</th>
                      <th className="py-1 pr-2">Buyer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pipeline_recent.map((r) => (
                      <tr key={r.id} className="border-t border-border/60">
                        <td className="py-1 pr-2 whitespace-nowrap">{ts(r.updated_at)}</td>
                        <td className="py-1 pr-2">{r.zip}</td>
                        <td className="py-1 pr-2">{r.status}</td>
                        <td className="py-1 pr-2">{r.escrow_status ?? "—"}</td>
                        <td className="py-1 pr-2">{fmt(r.base_contract_price)}</td>
                        <td className="py-1 pr-2">{r.optimized_acquisition_premium != null ? fmt(r.optimized_acquisition_premium) : "—"}</td>
                        <td className="py-1 pr-2">{r.matched_buyer_id ? String(r.matched_buyer_id).slice(0, 8) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Event stream */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold mb-3">System Console (latest 50 events)</h2>
            {data.event_stream.length === 0 ? (
              <p className="text-sm text-amber-400">
                ⚠ No events in the last 24h. The clearinghouse is idle.
              </p>
            ) : (
              <ul className="font-mono text-xs space-y-1 max-h-[420px] overflow-y-auto">
                {data.event_stream.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="text-muted-foreground whitespace-nowrap">{ts(e.at)}</span>
                    <span className={`uppercase text-[10px] px-1 rounded ${e.success === false ? "bg-red-500/20 text-red-400" : e.success ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      {e.kind}
                    </span>
                    <span className="flex-1">{e.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Counterparty activity */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold mb-3">Counterparty Activity (24h)</h2>
            {data.counterparty_activity.length === 0 ? (
              <p className="text-sm text-amber-400">
                ⚠ No routing endpoints configured. Buy-side has nowhere to talk to.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-2">Endpoint</th>
                      <th className="py-1 pr-2">Last interaction</th>
                      <th className="py-1 pr-2">Total</th>
                      <th className="py-1 pr-2">Success</th>
                      <th className="py-1 pr-2">Fail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.counterparty_activity.map((c) => (
                      <tr key={c.endpoint_id} className="border-t border-border/60">
                        <td className="py-1 pr-2">{c.endpoint_name}</td>
                        <td className={`py-1 pr-2 whitespace-nowrap ${!c.last_at ? "text-amber-400" : ""}`}>
                          {c.last_at ? ts(c.last_at) : "never (24h)"}
                        </td>
                        <td className="py-1 pr-2">{c.total_24h}</td>
                        <td className="py-1 pr-2 text-emerald-400">{c.success_24h}</td>
                        <td className="py-1 pr-2 text-red-400">{c.fail_24h}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* DLQ */}
          {data.dlq_recent.length > 0 ? (
            <section className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
              <h2 className="font-semibold mb-3 text-red-400">Dead Letter Queue (latest 25)</h2>
              <ul className="font-mono text-xs space-y-1">
                {data.dlq_recent.map((d) => (
                  <li key={d.id} className="flex gap-2">
                    <span className="text-muted-foreground whitespace-nowrap">{ts(d.created_at)}</span>
                    <span>retries={d.retry_count}</span>
                    <span className="flex-1 truncate" title={d.error_reason ?? ""}>{d.error_reason ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      <ImmutableAuditLog />
    </main>
  );
}

function ImmutableAuditLog() {
  const fetchLog = useServerFn(getImmutableAuditLog);
  const { data, isLoading, error } = useQuery({
    queryKey: ["immutable-audit-log"],
    queryFn: () => fetchLog({ data: {} as any }),
    refetchInterval: 20_000,
  });

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold mb-1">Immutable Audit Log</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Append-only record of inbound M2M email, intent scores, e-signature events and deal resuscitations.
      </p>
      {error ? (
        <div className="text-sm text-red-400">{(error as Error).message}</div>
      ) : isLoading ? (
        <div className="h-24 rounded-md bg-muted/30 animate-pulse" />
      ) : !data || data.length === 0 ? (
        <div className="text-sm text-muted-foreground">No audit events recorded yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3">Time</th>
                <th className="py-1 pr-3">Event</th>
                <th className="py-1 pr-3">Conf.</th>
                <th className="py-1 pr-3">IP</th>
                <th className="py-1 pr-3">Asset</th>
                <th className="py-1">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r: AuditLogRow) => (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="py-1 pr-3 whitespace-nowrap text-muted-foreground">{ts(r.created_at)}</td>
                  <td className="py-1 pr-3">{r.event_type ?? "—"}</td>
                  <td className="py-1 pr-3">
                    {r.llm_confidence_score == null ? (
                      "—"
                    ) : (
                      <span className={r.llm_confidence_score >= 1 ? "text-emerald-400" : "text-amber-400"}>
                        {r.llm_confidence_score.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-3">{r.ip_address ?? "—"}</td>
                  <td className="py-1 pr-3">{r.pipeline_item_id ? r.pipeline_item_id.slice(0, 8) : "—"}</td>
                  <td className="py-1 max-w-[380px] truncate" title={r.reason}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

