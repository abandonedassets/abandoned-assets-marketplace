import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getLedgerTape, runLedgerBackfill, runBtrAssembly, runCreSweep } from "@/lib/btr.functions";
import { deriveExecutionState, accentFor } from "@/lib/execution-states";
import { LEDGER_LABELS, type LedgerKey } from "@/lib/btr-routing";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin/ledger-tape")({
  head: () => ({
    meta: [
      { title: "Unified Ledger Tape — BTR Routing" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: LedgerTapeView,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-destructive">Tape offline: {(error as Error).message}</p>
        <button
          className="mt-2 underline"
          onClick={() => {
            reset();
            router.invalidate();
          }}
        >
          Retry
        </button>
      </div>
    );
  },
});

const usd = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const LEDGER_ACCENT: Record<LedgerKey, string> = {
  PRIMARY: "border-emerald-500/50 text-emerald-400",
  JACQUITA: "border-sky-500/50 text-sky-400",
  DAUGHTER: "border-amber-500/50 text-amber-400",
};

function LedgerTapeView() {
  const tapeFn = useServerFn(getLedgerTape);
  const backfillFn = useServerFn(runLedgerBackfill);
  const assemblyFn = useServerFn(runBtrAssembly);
  const creFn = useServerFn(runCreSweep);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["ledger-tape"], queryFn: () => tapeFn() });

  const run = async (kind: "route" | "assemble" | "cre") => {
    setBusy(kind);
    setMsg(null);
    try {
      if (kind === "route") {
        const r = (await backfillFn()) as any;
        setMsg(
          `Routed ${r.scanned} assets · ${r.updated} retagged · quarantined ${r.quarantined} · Operator ${r.counts.PRIMARY} / Jaquita ${r.counts.JACQUITA} / Jazmin ${r.counts.DAUGHTER}`,
        );
      } else if (kind === "cre") {
        const r = (await creFn()) as any;
        setMsg(
          `CRE sweep: ${r.scanned} scanned · ${r.stamped} stamped · ${r.commercial} commercial · ${r.distress} debt-distress · ${r.rollup_candidates} roll-up candidates`,
        );
      } else {
        const r = (await assemblyFn()) as any;
        setMsg(
          `${r.block_count} contiguous BTR blocks · ${r.parcels_in_blocks} parcels packaged · ${r.tagged} tagged`,
        );
      }
      await q.refetch();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };


  const totals = (q.data?.totals ?? {}) as Record<string, { count: number; basis: number }>;

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Unified Ledger Tape</h1>
            <p className="text-sm text-muted-foreground">
              Every asset class, its internal ledger, BTR/ESG compliance flags and live
              execution state. Backend truth only.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => run("route")} disabled={busy !== null}>
              {busy === "route" ? "Routing…" : "Run Ledger Routing"}
            </Button>
            <Button
              variant="outline"
              onClick={() => run("assemble")}
              disabled={busy !== null}
            >
              {busy === "assemble" ? "Assembling…" : "Assemble BTR Blocks"}
            </Button>
            <Button variant="outline" onClick={() => run("cre")} disabled={busy !== null}>
              {busy === "cre" ? "Sweeping…" : "Run CRE Sweep"}
            </Button>

          </div>
        </header>

        {msg && (
          <div className="rounded border border-border p-3 text-xs font-mono">{msg}</div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {(["PRIMARY", "JACQUITA", "DAUGHTER"] as LedgerKey[]).map((k) => (
            <Card key={k} className={`border ${LEDGER_ACCENT[k]}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{LEDGER_LABELS[k]}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-mono">{totals[k]?.count ?? 0}</div>
                <div className="text-xs text-muted-foreground font-mono">
                  {usd(totals[k]?.basis ?? 0)} basis
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Asset</th>
                <th className="p-2 text-left">Class</th>
                <th className="p-2 text-right">Basis</th>
                <th className="p-2 text-right">Fee (bps)</th>
                <th className="p-2 text-right">NOI / Cap</th>
                <th className="p-2 text-right">WALT</th>
                <th className="p-2 text-left">Tenant</th>
                <th className="p-2 text-left">Lane</th>
                <th className="p-2 text-left">Env</th>
                <th className="p-2 text-left">Ledger</th>
                <th className="p-2 text-left">Flags</th>
                <th className="p-2 text-left">State</th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.tape ?? []).map((r) => {
                const state = deriveExecutionState(r);
                const cre = (r as any).cre_class as string | null;
                return (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="p-2">
                      {r.address ?? "—"}
                      <span className="text-muted-foreground">
                        {" "}
                        {[r.city, r.state, r.zip].filter(Boolean).join(" ")}
                      </span>
                    </td>
                    <td className="p-2">
                      {cre && cre !== "NON_COMMERCIAL"
                        ? cre
                        : (r.asset_class ?? r.asset_type ?? "—")}
                    </td>
                    <td className="p-2 text-right">{usd(r.basis)}</td>
                    <td className="p-2 text-right">
                      {(r as any).fee_bps ? `${(r as any).fee_bps} bps` : "—"}
                    </td>
                    <td className="p-2 text-right">
                      {(r as any).noi_usd ? usd((r as any).noi_usd) : "—"}
                      {(r as any).cap_rate
                        ? ` / ${(((r as any).cap_rate as number) * 100).toFixed(2)}%`
                        : ""}
                    </td>
                    <td className="p-2 text-right">
                      {(r as any).walt_years ? `${(r as any).walt_years}y` : "—"}
                    </td>
                    <td className="p-2">
                      {(r as any).tenant_credit_tier === "INVESTMENT_GRADE" ? (
                        <span className="text-emerald-400">IG</span>
                      ) : (r as any).tenant_credit_tier === "NON_INVESTMENT_GRADE" ? (
                        <span className="text-amber-400">NON-IG</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-2">
                      {(r as any).cre_lane ?? "—"}
                      {(r as any).debt_distress_flag ? (
                        <span className="ml-1 text-destructive">⚑</span>
                      ) : null}
                    </td>
                    <td className="p-2">
                      {(r as any).env_status === "PHASE1_CLEAR" ? (
                        <span className="text-emerald-400">CLEAR</span>
                      ) : (
                        ((r as any).env_status ?? "—")
                      )}
                    </td>
                    <td className="p-2">
                      <Badge variant="outline" className={LEDGER_ACCENT[r.ledger as LedgerKey]}>
                        {r.ledger}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {r.flags.map((f) => (
                          <Badge key={f} variant="outline" className="text-[10px]">
                            {f}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className={`p-2 ${accentFor(state)}`}>{state}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {q.isLoading && <div className="p-3 text-xs text-muted-foreground">Loading tape…</div>}
          {!q.isLoading && (q.data?.tape ?? []).length === 0 && (
            <div className="p-3 text-xs text-muted-foreground">No assets on tape.</div>
          )}
        </div>
      </div>
    </div>
  );
}
