import type { TelemetryRow } from "@/lib/admin-money.functions";

function signature(r: TelemetryRow) {
  const seed = `${r.endpoint_name}:${r.http_status ?? "x"}:${r.latency_ms ?? "x"}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

function statusClass(s: number | null) {
  if (s == null) return "bg-destructive/15 text-destructive";
  if (s >= 200 && s < 300) return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (s >= 400 && s < 500) return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-destructive/15 text-destructive";
}

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function TransmissionTelemetryLog({
  rows,
  updatedAt,
}: {
  rows: TelemetryRow[];
  updatedAt: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-card-foreground">
          Successful Handshakes
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live · updated {relTime(new Date(updatedAt).toISOString())}
        </div>
      </div>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Endpoint</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Latency</th>
              <th className="px-4 py-2 font-medium">Signature</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  No dispatches recorded yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td
                  className="px-4 py-2 text-xs text-muted-foreground"
                  title={new Date(r.dispatched_at).toISOString()}
                >
                  {relTime(r.dispatched_at)}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-card-foreground">
                  {r.endpoint_name}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-0.5 font-mono text-xs ${statusClass(r.http_status)}`}
                  >
                    {r.http_status ?? "ERR"}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-xs tabular-nums text-card-foreground">
                  {r.latency_ms ?? "—"}
                  {r.latency_ms != null && "ms"}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {signature(r)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
