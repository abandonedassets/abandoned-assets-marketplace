import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { listEscrowItems, type EscrowItem } from "@/lib/escrow.functions";
import { supabase } from "@/integrations/supabase/client";

const ACTIVE = new Set(["Locked-Escrow-Pending", "Buyer-Signed", "In-Escrow"]);

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

function statusTone(s: string | null) {
  switch (s) {
    case "In-Escrow": return "text-emerald-400 border-emerald-500/40 bg-emerald-500/5";
    case "Locked-Escrow-Pending": return "text-sky-300 border-sky-500/40 bg-sky-500/5";
    case "Buyer-Signed": return "text-amber-300 border-amber-500/40 bg-amber-500/5";
    default: return "text-zinc-300 border-zinc-700 bg-zinc-900/30";
  }
}

export default function AlphaStreamLedger() {
  const fetchFn = useServerFn(listEscrowItems);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["alpha-ledger"],
    queryFn: () => fetchFn(),
    refetchInterval: 30_000,
  });

  const [flash, setFlash] = useState<Record<string, string>>({});

  useEffect(() => {
    const ch = supabase
      .channel("cpi-ledger")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "closing_pipeline_items" },
        (payload) => {
          const id =
            (payload.new as { id?: string } | null)?.id ??
            (payload.old as { id?: string } | null)?.id;
          if (id) {
            setFlash((f) => ({ ...f, [id]: "bg-emerald-500/15" }));
            setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[id]; return n; }), 1500);
          }
          refetch();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetch]);

  const rows: EscrowItem[] = (data ?? []).filter((r) => ACTIVE.has(r.status ?? ""));
  const totalPrem = rows.reduce((s, r) => s + (r.optimized_acquisition_premium ?? 0), 0);
  const totalContract = rows.reduce((s, r) => s + (r.base_contract_price ?? 0), 0);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 font-mono">
      <div className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">/alpha · ledger</div>
          <h1 className="text-lg font-bold text-emerald-400">ALPHA STREAM LEDGER</h1>
        </div>
        <div className="flex items-center gap-6 text-[10px] uppercase tracking-[0.2em]">
          <div><span className="text-zinc-500">rows </span><span className="text-zinc-100">{rows.length}</span></div>
          <div><span className="text-zinc-500">Σ premium </span><span className="text-emerald-400">{fmtMoney(totalPrem)}</span></div>
          <div><span className="text-zinc-500">Σ contract </span><span className="text-zinc-100">{fmtMoney(totalContract)}</span></div>
        </div>
      </div>

      {error && (
        <div className="m-6 border border-rose-500/40 bg-rose-500/10 p-3 text-rose-400 text-xs">
          ERR :: {(error as Error).message}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900/60 text-zinc-500">
            <tr className="text-left">
              <th className="px-4 py-2 font-normal uppercase tracking-wider text-[10px] w-[45%]">Address</th>
              <th className="px-4 py-2 font-normal uppercase tracking-wider text-[10px]">Status</th>
              <th className="px-4 py-2 font-normal uppercase tracking-wider text-[10px] text-right">Acquisition Premium</th>
              <th className="px-4 py-2 font-normal uppercase tracking-wider text-[10px] text-right">Contract Amount</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={4} className="px-4 py-6 text-zinc-500">loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-zinc-500">NO ACTIVE ESCROW</td></tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className={`border-t border-zinc-900 transition-colors duration-1000 ${flash[r.id] ?? "hover:bg-zinc-900/40"}`}
              >
                <td className="px-4 py-2 text-zinc-100 truncate">
                  {r.address ?? "—"}
                  {(r.city || r.state) && (
                    <span className="text-zinc-500"> · {[r.city, r.state, r.zip].filter(Boolean).join(" ")}</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-block border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${statusTone(r.status)}`}>
                    {r.status ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right text-emerald-400 tabular-nums font-semibold">
                  {fmtMoney(r.optimized_acquisition_premium)}
                </td>
                <td className="px-4 py-2 text-right text-zinc-100 tabular-nums">
                  {fmtMoney(r.base_contract_price)}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-zinc-900/40 text-zinc-400">
              <tr className="border-t border-zinc-800">
                <td className="px-4 py-2 uppercase tracking-wider text-[10px]">Totals</td>
                <td className="px-4 py-2 text-[10px]">{rows.length} active</td>
                <td className="px-4 py-2 text-right text-emerald-400 tabular-nums font-semibold">{fmtMoney(totalPrem)}</td>
                <td className="px-4 py-2 text-right text-zinc-100 tabular-nums">{fmtMoney(totalContract)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
