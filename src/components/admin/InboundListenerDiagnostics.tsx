import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getInboundDiagnostics,
  provisionInboundAccounts,
} from "@/lib/inbound-wire.functions";

const toneFor = (l: string) =>
  l === "critical"
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : l === "warn"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";

export function InboundListenerDiagnostics() {
  const fetchFn = useServerFn(getInboundDiagnostics);
  const provisionFn = useServerFn(provisionInboundAccounts);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["inbound-diagnostics"],
    queryFn: () => fetchFn(),
    refetchInterval: 60_000,
    retry: false,
  });

  const provision = useMutation({
    mutationFn: () => provisionFn(),
    onSuccess: (r) => {
      toast.success(`FBO accounts minted :: ${r.provisioned}/${r.scanned}`);
      qc.invalidateQueries({ queryKey: ["inbound-diagnostics"] });
    },
    onError: (e: Error) => toast.error(`Provision failed :: ${e.message}`),
  });

  if (error) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4 font-mono text-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">
          Inbound Listener Diagnostics
        </h2>
        <button
          onClick={() => provision.mutate()}
          disabled={provision.isPending}
          className="rounded border border-border px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-50"
        >
          {provision.isPending ? "MINTING…" : "MINT FBO ACCOUNTS"}
        </button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">scanning inbound rails…</p>
      ) : data ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["AWAITING FUNDS", data.awaiting_funds],
              ["FBO PROVISIONED", data.fbo_provisioned],
              ["FBO FUNDED", data.fbo_funded],
              ["ROUTING", data.routing_configured ? "LIVE" : "MISSING"],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded border border-border p-2">
                <div className="text-[10px] text-muted-foreground">{k}</div>
                <div className="text-base font-semibold">{String(v)}</div>
              </div>
            ))}
          </div>

          <ul className="mb-3 space-y-1">
            {data.findings.map((f, i) => (
              <li key={i} className={`rounded border p-2 ${toneFor(f.level)}`}>
                <span className="font-semibold">[{f.level.toUpperCase()}]</span>{" "}
                {f.endpoint} — {f.detail}
              </li>
            ))}
          </ul>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-[10px] text-muted-foreground">
                <tr>
                  <th className="py-1">TIME</th>
                  <th>FBO</th>
                  <th>AMOUNT</th>
                  <th>MATCH</th>
                  <th>REASON</th>
                </tr>
              </thead>
              <tbody>
                {data.events.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-2 text-muted-foreground">
                      no inbound wire payloads received yet
                    </td>
                  </tr>
                ) : (
                  data.events.map((e: Record<string, any>) => (
                    <tr key={e["id"]} className="border-t border-border/50">
                      <td className="py-1">
                        {new Date(e["created_at"]).toISOString().slice(5, 16).replace("T", " ")}
                      </td>
                      <td>{e["fbo_account_number"] ?? "—"}</td>
                      <td>${Number(e["amount_usd"] ?? 0).toLocaleString()}</td>
                      <td
                        className={
                          e["match_status"] === "matched"
                            ? "text-emerald-400"
                            : "text-amber-400"
                        }
                      >
                        {e["match_status"]}
                      </td>
                      <td className="text-muted-foreground">{e["reason"] ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
