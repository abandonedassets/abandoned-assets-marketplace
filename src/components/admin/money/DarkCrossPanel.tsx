import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDarkCrossState, runDarkCrossNow } from "@/lib/dark-cross.functions";
import { Button } from "@/components/ui/button";

const usd = (n: number) =>
  `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

export function DarkCrossPanel() {
  const fetchState = useServerFn(getDarkCrossState);
  const kick = useServerFn(runDarkCrossNow);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["dark-cross-state"],
    queryFn: () => fetchState(),
    refetchInterval: 20_000,
  });

  const run = useMutation({
    mutationFn: () => kick(),
    onSettled: () => qc.invalidateQueries({ queryKey: ["dark-cross-state"] }),
  });

  const proof = data?.escrow_proof;

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          cryptographic dark crossing · proof-of-escrow · micro-TIF
        </h2>
        <Button
          size="sm"
          variant="outline"
          disabled={run.isPending}
          onClick={() => run.mutate()}
          className="font-mono text-[10px]"
        >
          {run.isPending ? "CROSSING…" : "RUN BLIND CROSS"}
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="SEALED INTENTS OPEN" value={String(data?.totals.open ?? 0)} />
        <Stat label="CROSSED" value={String(data?.totals.crossed ?? 0)} tone="emerald" />
        <Stat label="LIVE MICRO-LOCKS" value={String(data?.micro_tif.live_locks ?? 0)} />
        <Stat
          label="OVERDUE (DECAYING)"
          value={String(data?.micro_tif.overdue ?? 0)}
          tone={(data?.micro_tif.overdue ?? 0) > 0 ? "amber" : undefined}
        />
      </div>

      {proof ? (
        <div className="mt-4 rounded border border-border/60 bg-muted/30 p-3 font-mono text-[11px]">
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span className="uppercase tracking-widest text-[10px]">escrow state proof</span>
            <span className={proof.verified ? "text-emerald-500" : "text-destructive"}>
              {proof.verified ? "SIGNATURE VERIFIED" : `INVALID (${proof.verify_reason})`}
            </span>
            <span>key {proof.key_id}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
            <Row k="cleared" v={usd(proof.balances.cleared_usd)} />
            <Row k="pending wire" v={usd(proof.balances.pending_wire_usd)} />
            <Row k="escrow locked" v={usd(proof.balances.escrow_locked_usd)} />
            <Row k="available" v={usd(proof.balances.available_usd)} />
          </div>
          <div className="mt-2 truncate text-muted-foreground">
            state_root {proof.state_root.slice(0, 32)}… · ttl{" "}
            {proof.expires_at - proof.issued_at}s
          </div>
        </div>
      ) : null}

      {(data?.micro_tif.strikes.length ?? 0) > 0 ? (
        <div className="mt-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            latency strikes (stalled handshakes)
          </div>
          <table className="mt-1 w-full font-mono text-[11px]">
            <tbody>
              {(data?.micro_tif.strikes ?? []).map((s: Record<string, any>) => (
                <tr key={String(s["id"])} className="border-t border-border/50">
                  <td className="py-1 pr-3 truncate">{String(s["label"] ?? s["id"])}</td>
                  <td className="py-1 text-right text-amber-500">{Number(s["latency_strikes"]) || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-4 max-h-56 overflow-y-auto">
        <table className="w-full font-mono text-[11px]">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 font-normal">INTENT</th>
              <th className="py-1 font-normal">STATUS</th>
              <th className="py-1 font-normal text-right">MAX NOTIONAL</th>
            </tr>
          </thead>
          <tbody>
            {(data?.intents ?? []).map((r) => (
              <tr key={r.id} className="border-t border-border/50">
                <td className="py-1 pr-3">enc:{r.hash}…</td>
                <td
                  className={`py-1 pr-3 ${r.status === "CROSSED" ? "text-emerald-500" : ""}`}
                >
                  {r.status}
                </td>
                <td className="py-1 text-right">{r.max_notional ? usd(r.max_notional) : "—"}</td>
              </tr>
            ))}
            {!(data?.intents ?? []).length ? (
              <tr>
                <td colSpan={3} className="py-3 text-center text-muted-foreground">
                  no sealed intents posted yet · POST /api/public/v1/intents
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "amber" }) {
  return (
    <div className="rounded border border-border/60 p-2">
      <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className={`font-mono text-lg ${
          tone === "emerald" ? "text-emerald-500" : tone === "amber" ? "text-amber-500" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
