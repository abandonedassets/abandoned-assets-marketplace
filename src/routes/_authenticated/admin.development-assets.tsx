import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listPipelineItems,
  getAssetRecord,
  type PipelineItem,
} from "@/lib/pipeline.functions";
import { generateSiteSheet } from "@/lib/deal-pdf";
import { isDirt } from "./admin.pipeline";

export const Route = createFileRoute("/_authenticated/admin/development-assets")({
  head: () => ({
    meta: [
      { title: "Development Desk — Land & Infill" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DevAssetsPage,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 font-mono text-sm">404</div>,
});

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

function DevAssetsPage() {
  const fetchFn = useServerFn(listPipelineItems);
  const recFn = useServerFn(getAssetRecord);

  const { data, isLoading } = useQuery({
    queryKey: ["pipeline-items"],
    queryFn: () => fetchFn(),
    refetchInterval: 60_000,
  });

  const rows = (data ?? []).filter(isDirt);

  const sheet = async (i: PipelineItem) => {
    try {
      const rec = await recFn({ data: { id: i.id } });
      await generateSiteSheet(rec as Record<string, unknown>);
      toast.success("Site sheet generated");
    } catch (e) {
      toast.error(`Site sheet failed :: ${(e as Error).message}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0E14] font-mono text-zinc-200">
      <header className="border-b border-zinc-800 px-4 py-3 md:px-6">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          /admin/development-assets
        </div>
        <h1 className="text-lg font-bold text-cyan-400">DEVELOPMENT DESK · LAND &amp; INFILL</h1>
        <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          manual distribution only · no API webhook dispatch on this desk
        </p>
      </header>

      {/* DESKTOP */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500">
            <tr className="text-left">
              <th className="px-3 py-2 font-normal">Parcel</th>
              <th className="px-3 py-2 font-normal">Zoning</th>
              <th className="px-3 py-2 text-right font-normal">Lot SqFt</th>
              <th className="px-3 py-2 text-right font-normal">Price</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 text-right font-normal">Site Sheet</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-3 py-8 text-zinc-500">loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-zinc-500">NO DEVELOPMENT PARCELS</td></tr>
            )}
            {rows.map((i) => (
              <tr key={i.id} className="border-t border-zinc-900 hover:bg-zinc-900/40">
                <td className="max-w-[320px] truncate px-3 py-2 text-zinc-100">
                  {i.address ?? "—"}{i.city ? `, ${i.city}` : ""} {i.zip ?? ""}
                </td>
                <td className="px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-400">
                  {i.zoning_class ?? i.asset_type ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {i.lot_sqft ? i.lot_sqft.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(i.base_contract_price)}</td>
                <td className="px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-400">
                  {i.status ?? "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void sheet(i)}
                    className="border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-cyan-300 transition hover:bg-cyan-500/20"
                  >
                    ⬇ generate site sheet
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* DRIVER VIEW */}
      <div className="divide-y divide-zinc-900 pb-16 md:hidden">
        {isLoading && <div className="px-4 py-6 text-xs text-zinc-500">loading…</div>}
        {!isLoading && rows.length === 0 && (
          <div className="px-4 py-6 text-xs text-zinc-500">NO DEVELOPMENT PARCELS</div>
        )}
        {rows.map((i) => (
          <div key={i.id} className="p-4">
            <div className="text-base font-bold text-zinc-100">{i.address ?? "—"}</div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {i.zoning_class ?? i.asset_type ?? "—"} ·{" "}
              {i.lot_sqft ? `${i.lot_sqft.toLocaleString()} sf` : "—"} ·{" "}
              {fmtMoney(i.base_contract_price)}
            </div>
            <button
              type="button"
              onClick={() => void sheet(i)}
              className="mt-3 h-14 w-full border border-cyan-500/50 bg-cyan-500/10 text-sm font-bold uppercase tracking-[0.15em] text-cyan-300 active:bg-cyan-500/25"
            >
              Generate Site Sheet
            </button>
          </div>
        ))}
      </div>

    </div>
  );
}
