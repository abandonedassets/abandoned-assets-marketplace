import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getM2MNodeHealth } from "@/lib/m2m-observability.functions";

export function AlgoNodeHeartbeat() {
  const fetchNodes = useServerFn(getM2MNodeHealth);
  const q = useQuery({
    queryKey: ["m2m", "node-health"],
    queryFn: () => fetchNodes({ data: undefined as never }),
    refetchInterval: 20_000,
    retry: false,
  });

  const nodes = q.data?.nodes ?? [];
  const reachable = q.data?.reachable ?? 0;

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          active algo connections
        </h2>
        <span
          className={`font-mono text-[10px] ${reachable > 0 ? "text-emerald-500" : "text-destructive"}`}
        >
          {reachable}/{nodes.length} NODES LIVE
        </span>
      </div>

      {nodes.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No M2M buy boxes configured.</p>
      ) : (
        <div className="mt-3 max-h-72 overflow-auto">
          <table className="w-full font-mono text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 font-normal">NODE</th>
                <th className="py-1 font-normal">HOST</th>
                <th className="py-1 text-right font-normal">HTTP</th>
                <th className="py-1 text-right font-normal">LAT</th>
                <th className="py-1 text-right font-normal">ACC/ATT</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.box_id} className="border-t border-border/50">
                  <td className="py-1 pr-2">
                    <span className={n.reachable ? "text-emerald-500" : "text-destructive"}>●</span>{" "}
                    <span className="truncate">{n.label ?? n.box_id.slice(0, 8)}</span>
                  </td>
                  <td className="py-1 pr-2 truncate text-muted-foreground" title={n.last_error ?? ""}>
                    {n.host}
                  </td>
                  <td className="py-1 text-right">
                    {n.last_status ?? (n.last_error ? "ERR" : "—")}
                  </td>
                  <td className="py-1 text-right">
                    {n.last_latency_ms != null ? `${n.last_latency_ms}ms` : "—"}
                  </td>
                  <td className="py-1 text-right">
                    {n.total_accepts}/{n.total_attempts}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nodes.length > 0 && reachable === 0 && (
        <p className="mt-3 rounded border border-destructive/40 bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
          NO REACHABLE COUNTERPARTY NODES — every configured webhook_url resolves to a dead or
          placeholder host. M2M clearing cannot execute until a real fund endpoint is saved.
        </p>
      )}
    </section>
  );
}
