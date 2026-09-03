import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTriPartyLedger, triggerAtomicDebtSweep } from "@/lib/debt-sweep.functions";

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function TriPartySweepLedger() {
  const fetchLedger = useServerFn(getTriPartyLedger);
  const runSweep = useServerFn(triggerAtomicDebtSweep);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["triparty", "ledger"],
    queryFn: () => fetchLedger(),
    refetchInterval: 30_000,
  });

  const m = useMutation({
    mutationFn: () => runSweep(),
    onSettled: () => qc.invalidateQueries({ queryKey: ["triparty", "ledger"] }),
  });

  const rows = q.data?.rows ?? [];
  const totalDebt = rows.reduce((a, r) => a + r.debt_service_usd, 0);
  const totalNet = rows.reduce((a, r) => a + r.net_retained_usd, 0);

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Tri-Party Sweep Ledger · autonomous debt service
        </div>
        <button
          onClick={() => m.mutate()}
          disabled={m.isPending}
          className="rounded border px-3 py-1.5 font-mono text-[11px] hover:bg-muted disabled:opacity-50"
        >
          {m.isPending ? "Sweeping…" : "Run Sweep"}
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Cell
          label="Facility Counterparty"
          value={q.data?.facility.lender_name ?? "—"}
        />
        <Cell
          label="Daily Accrued Interest"
          value={usd(q.data?.daily_interest_usd ?? 0)}
        />
        <Cell
          label="Serviced / Retained (ledger)"
          value={`${usd(totalDebt)} / ${usd(totalNet)}`}
          accent
        />
      </div>

      <div className="mt-4 max-h-[45vh] overflow-auto rounded border">
        <table className="w-full min-w-[640px] font-mono text-[11px]">
          <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Swept</th>
              <th className="px-2 py-1.5 text-left">Deal</th>
              <th className="px-2 py-1.5 text-right">Gross Fee</th>
              <th className="px-2 py-1.5 text-right">Debt Service</th>
              <th className="px-2 py-1.5 text-right">Net Retained</th>
              <th className="px-2 py-1.5 text-left">Lender ACK</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.deal_id} className="border-t">
                <td className="px-2 py-1.5 text-muted-foreground">
                  {r.created_at ? new Date(r.created_at).toISOString().slice(5, 16).replace("T", " ") : "—"}
                </td>
                <td className="px-2 py-1.5">{r.deal_id.slice(0, 8)}</td>
                <td className="px-2 py-1.5 text-right">{usd(r.gross_fee_usd)}</td>
                <td className="px-2 py-1.5 text-right text-amber-500">
                  −{usd(r.debt_service_usd)}
                </td>
                <td className="px-2 py-1.5 text-right text-emerald-500">
                  {usd(r.net_retained_usd)}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{r.lender_ack}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">
                  {q.isLoading ? "Loading sweep ledger…" : "No autonomous sweeps journaled yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold sm:text-base ${accent ? "text-emerald-500" : ""}`}>
        {value}
      </div>
    </div>
  );
}
