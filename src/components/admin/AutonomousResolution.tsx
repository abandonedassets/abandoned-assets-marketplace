import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listGateResolution, kickGateResolution } from "@/lib/gate-resolution.functions";

const STATE_STYLE: Record<string, string> = {
  AUTO_DISPATCHING: "border-amber-400/60 bg-amber-500/15 text-amber-300",
  AWAITING_EXTERNAL_RESPONSE: "border-sky-400/60 bg-sky-500/15 text-sky-300",
  RESOLVED: "border-emerald-400/60 bg-emerald-500/15 text-emerald-300",
  FAILED: "border-red-400/60 bg-red-500/15 text-red-300",
};

const GATE_LABEL: Record<string, string> = {
  CONTRACT: "Signature dispatch",
  COUNTERPARTY: "Counterparty push",
  TITLE_ESCROW: "Title / escrow order",
};

export function AutonomousResolution() {
  const list = useServerFn(listGateResolution);
  const kick = useServerFn(kickGateResolution);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["gate-resolution"],
    queryFn: () => list(),
    refetchInterval: 30_000,
  });

  const run = useMutation({
    mutationFn: () => kick(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gate-resolution"] }),
  });

  const t = data?.totals;

  return (
    <section className="rounded-lg border border-border bg-card/60 p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide">AUTONOMOUS RESOLUTION LOOPS</h2>
          <p className="text-xs text-muted-foreground">
            The engine dispatches contracts, pushes payloads to counterparties and orders title
            automatically. No manual legwork.
          </p>
        </div>
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          {run.isPending ? "Running…" : "Run cycle now"}
        </button>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["AUTO-DISPATCHING", t?.dispatching ?? 0, "AUTO_DISPATCHING"],
          ["AWAITING RESPONSE", t?.awaiting ?? 0, "AWAITING_EXTERNAL_RESPONSE"],
          ["RESOLVED", t?.resolved ?? 0, "RESOLVED"],
          ["UNRESPONSIVE", t?.failed ?? 0, "FAILED"],
        ].map(([label, value, key]) => (
          <div
            key={String(key)}
            className={`rounded border px-2 py-1.5 text-xs ${STATE_STYLE[String(key)]}`}
          >
            <div className="font-mono text-lg leading-tight">{Number(value)}</div>
            <div className="opacity-80">{label}</div>
          </div>
        ))}
      </div>

      <div className="max-h-72 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-2">Asset</th>
              <th className="py-1 pr-2">Loop</th>
              <th className="py-1 pr-2">Status</th>
              <th className="py-1 pr-2">Detail</th>
              <th className="py-1">Tries</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r: Record<string, any>) => (
              <tr key={String(r["id"])} className="border-t border-border/50">
                <td className="py-1 pr-2 font-mono">{String(r["pipeline_item_id"]).slice(0, 8)}</td>
                <td className="py-1 pr-2">{GATE_LABEL[String(r["gate"])] ?? String(r["gate"])}</td>
                <td className="py-1 pr-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 font-semibold ${STATE_STYLE[String(r["state"])] ?? ""}`}
                  >
                    {String(r["state"]).replace(/_/g, " ")}
                  </span>
                </td>
                <td className="py-1 pr-2 text-muted-foreground">{r["last_detail"] ?? "—"}</td>
                <td className="py-1 font-mono">{Number(r["attempts"] ?? 0)}</td>
              </tr>
            ))}
            {!(data?.rows ?? []).length && (
              <tr>
                <td colSpan={5} className="py-3 text-center text-muted-foreground">
                  No open resolution loops.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
