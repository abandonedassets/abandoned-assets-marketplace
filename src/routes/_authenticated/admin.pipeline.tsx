import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  listPipelineItems,
  executeLiquidationBlast,
  type PipelineItem,
} from "@/lib/pipeline.functions";

export const Route = createFileRoute("/_authenticated/admin/pipeline")({
  head: () => ({
    meta: [
      { title: "Deal Tape — Asset Segmentation" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PipelinePage,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 font-mono text-sm">404</div>,
});

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

type TabKey = "yield" | "dirt" | "stagnant" | "shadow";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "yield", label: "Yield Assets" },
  { key: "dirt", label: "Development/Dirt" },
  { key: "stagnant", label: "Stagnant (DUE)" },
  { key: "shadow", label: "Shadow Inventory" },
];

export function isDirt(i: PipelineItem) {
  const t = `${i.asset_type ?? ""} ${i.zoning_class ?? ""}`.toLowerCase();
  const tags = (i.enrichment_tags ?? []).join(" ").toUpperCase();
  return (
    /land|lot|dirt|vacant|infill|commercial/.test(t) ||
    tags.includes("COMMERCIAL-INFILL") ||
    tags.includes("ASSEMBLAGE-OPPORTUNITY") ||
    (!i.year_built && (i.lot_sqft ?? 0) > 0)
  );
}

function segment(i: PipelineItem): TabKey {
  if (i.status === "Shadow_Inventory") return "shadow";
  if (i.is_stale || i.status === "CRITICAL_STALL" || i.status === "Queued-For-Tomorrow")
    return "stagnant";
  if (isDirt(i)) return "dirt";
  return "yield";
}

function PipelinePage() {
  const fetchFn = useServerFn(listPipelineItems);
  const blastFn = useServerFn(executeLiquidationBlast);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["pipeline-items"],
    queryFn: () => fetchFn(),
    refetchInterval: 60_000,
  });

  const [tab, setTab] = useState<TabKey>("yield");
  const [sel, setSel] = useState<Record<string, boolean>>({});

  const items = data ?? [];
  const buckets = useMemo(() => {
    const b: Record<TabKey, PipelineItem[]> = { yield: [], dirt: [], stagnant: [], shadow: [] };
    for (const i of items) b[segment(i)].push(i);
    return b;
  }, [items]);

  const rows = buckets[tab];
  const selectedIds = Object.keys(sel).filter((k) => sel[k]);
  const allChecked = rows.length > 0 && rows.every((r) => sel[r.id]);

  const blast = useMutation({
    mutationFn: (ids: string[]) => blastFn({ data: { ids } }),
    onSuccess: (res) => {
      toast.success(`Liquidation blast dispatched :: ${res.dispatched} assets`);
      setSel({});
      qc.invalidateQueries({ queryKey: ["pipeline-items"] });
    },
    onError: (e: Error) => toast.error(`Blast failed :: ${e.message}`),
  });

  const totals = rows.reduce(
    (a, i) => {
      a.base += Number(i.base_contract_price ?? 0);
      a.fee += Number(i.optimized_acquisition_premium ?? 0);
      return a;
    },
    { base: 0, fee: 0 },
  );

  return (
    <div className="min-h-screen bg-[#0B0E14] font-mono text-zinc-200">
      <header className="border-b border-zinc-800 px-4 py-3 md:px-6">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">/admin/pipeline</div>
        <h1 className="text-lg font-bold text-cyan-400">DEAL TAPE · ASSET SEGMENTATION</h1>
      </header>

      {/* TABS */}
      <div className="flex overflow-x-auto border-b border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap border-r border-zinc-900 px-4 py-3 text-[11px] uppercase tracking-[0.15em] transition ${
              tab === t.key
                ? "bg-cyan-500/10 text-cyan-300"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}{" "}
            <span className="tabular-nums text-zinc-600">[{buckets[t.key].length}]</span>
          </button>
        ))}
      </div>

      {/* ACTION BAR */}
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3 md:px-6">
        <button
          type="button"
          disabled={selectedIds.length === 0 || blast.isPending}
          onClick={() => blast.mutate(selectedIds)}
          className="h-12 border border-cyan-500/50 bg-cyan-500/10 px-4 text-xs font-bold uppercase tracking-[0.15em] text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-30 md:h-9"
        >
          ▸ Execute Algorithmic Liquidation Blast ({selectedIds.length})
        </button>
        <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Σ base {fmtMoney(totals.base)} · Σ spread{" "}
          <span className="text-emerald-400">{fmtMoney(totals.fee)}</span>
        </span>
        <Link
          to="/admin/development-assets"
          className="ml-auto text-[10px] uppercase tracking-[0.2em] text-zinc-500 underline hover:text-zinc-300"
        >
          development desk →
        </Link>
      </div>

      {/* DESKTOP GRID */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500">
            <tr className="text-left">
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={(e) => {
                    const next = { ...sel };
                    for (const r of rows) next[r.id] = e.target.checked;
                    setSel(next);
                  }}
                />
              </th>
              <th className="px-3 py-2 font-normal">Address</th>
              <th className="px-3 py-2 font-normal">ZIP</th>
              <th className="px-3 py-2 font-normal">Type / Zoning</th>
              <th className="px-3 py-2 text-right font-normal">Base</th>
              <th className="px-3 py-2 text-right font-normal">Spread</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 font-normal">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="px-3 py-8 text-zinc-500">loading tape…</td></tr>
            )}
            {error && (
              <tr><td colSpan={8} className="px-3 py-8 text-rose-400">{(error as Error).message}</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-zinc-500">NO RECORDS</td></tr>
            )}
            {rows.map((i) => (
              <tr key={i.id} className="border-t border-zinc-900 hover:bg-zinc-900/40">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={!!sel[i.id]}
                    onChange={(e) => setSel((s) => ({ ...s, [i.id]: e.target.checked }))}
                  />
                </td>
                <td className="max-w-[300px] truncate px-3 py-2 text-zinc-100">
                  {i.address ?? "—"}
                  {i.city ? `, ${i.city}` : ""}
                </td>
                <td className="px-3 py-2 text-zinc-400">{i.zip ?? "—"}</td>
                <td className="px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-400">
                  {i.asset_type ?? "—"}{i.zoning_class ? ` · ${i.zoning_class}` : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(i.base_contract_price)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-400">
                  {fmtMoney(i.optimized_acquisition_premium)}
                </td>
                <td className="px-3 py-2">
                  <span className="border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">
                    {i.status ?? "—"}
                  </span>
                </td>
                <td className="px-3 py-2 text-zinc-500">
                  {new Date(i.created_at).toISOString().slice(0, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* DRIVER VIEW */}
      <div className="divide-y divide-zinc-900 pb-24 md:hidden">
        {isLoading && <div className="px-4 py-6 text-xs text-zinc-500">loading tape…</div>}
        {!isLoading && rows.length === 0 && (
          <div className="px-4 py-6 text-xs text-zinc-500">NO RECORDS</div>
        )}
        {rows.map((i) => (
          <div key={i.id} className="p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={!!sel[i.id]}
                onChange={(e) => setSel((s) => ({ ...s, [i.id]: e.target.checked }))}
              />
              <span className="flex-1">
                <span className="block text-base font-bold text-zinc-100">{i.address ?? "—"}</span>
                <span className="mt-1 flex items-center gap-2 text-[11px]">
                  <span className="border border-zinc-700 px-1.5 py-0.5 uppercase tracking-wider text-zinc-400">
                    {i.status ?? "—"}
                  </span>
                  <span className="font-semibold tabular-nums text-emerald-400">
                    {fmtMoney(i.optimized_acquisition_premium)}
                  </span>
                </span>
              </span>
            </label>
          </div>
        ))}
      </div>

      {/* MOBILE STICKY ACTIONS */}
      <div className="fixed bottom-0 left-0 right-0 z-40 grid gap-2 border-t border-zinc-800 bg-[#0B0E14] p-3 md:hidden">
        <button
          type="button"
          disabled={selectedIds.length === 0 || blast.isPending}
          onClick={() => blast.mutate(selectedIds)}
          className="h-14 w-full border border-cyan-500/50 bg-cyan-500/10 text-sm font-bold uppercase tracking-[0.15em] text-cyan-300 active:bg-cyan-500/25 disabled:opacity-30"
        >
          Bulk Liquidate ({selectedIds.length})
        </button>
        <div className="grid grid-cols-2 gap-2">
          <Link
            to="/admin/escrow"
            className="flex h-14 items-center justify-center border border-emerald-500/50 bg-emerald-500/10 text-sm font-bold uppercase tracking-[0.15em] text-emerald-300 active:bg-emerald-500/25"
          >
            Dispatch Escrow
          </Link>
        </div>
      </div>

    </div>
  );
}
