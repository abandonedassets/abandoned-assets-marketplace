import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  listEscrowItems,
  listFullPipeline,
  listStatusBuckets,
  accelerateDeal,
  openTitleEscrow,
  getTitlePackage,
  listTitlePackages,
  type EscrowItem,
} from "@/lib/escrow.functions";

import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/escrow")({
  head: () => ({
    meta: [
      { title: "Escrow Terminal — Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: EscrowPage,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="p-6 font-mono text-sm">404 :: no escrow records</div>
  ),
});

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

const fmtDate = (d: string | null) =>
  d ? new Date(d).toISOString().slice(0, 10) : "—";

const fmtTime = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  const diff = Date.now() - dt.getTime();
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return dt.toISOString().slice(0, 10);
};

function statusTone(s: string | null) {
  switch (s) {
    case "Funds-Cleared": return "text-emerald-400 border-emerald-500/40 bg-emerald-500/5";
    case "Locked-Escrow-Pending": return "text-sky-300 border-sky-500/40 bg-sky-500/5";
    case "Buyer-Signed": return "text-amber-300 border-amber-500/40 bg-amber-500/5";
    case "House-Bid": return "text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/5";
    case "New": return "text-zinc-200 border-zinc-600 bg-zinc-800/30";
    case "Scout": return "text-zinc-400 border-zinc-700 bg-zinc-900/30";
    case "Rejected":
    case "Dead": return "text-rose-300 border-rose-500/40 bg-rose-500/5";
    default: return "text-zinc-300 border-zinc-700 bg-zinc-900/30";
  }
}

function EscrowPage() {
  const fetchFn = useServerFn(listEscrowItems);
  const fetchPipeline = useServerFn(listFullPipeline);
  const fetchBuckets = useServerFn(listStatusBuckets);
  const accelerateFn = useServerFn(accelerateDeal);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["escrow-items"],
    queryFn: () => fetchFn(),
    refetchInterval: 30_000,
  });
  const pipelineQ = useQuery({
    queryKey: ["pipeline-full"],
    queryFn: () => fetchPipeline(),
    refetchInterval: 60_000,
  });
  const bucketsQ = useQuery({
    queryKey: ["status-buckets"],
    queryFn: () => fetchBuckets(),
    refetchInterval: 30_000,
  });

  const sysChkQ = useQuery({
    queryKey: ["sys-chk"],
    queryFn: async () => {
      const [hb, lep] = await Promise.all([
        supabase
          .from("closing_pipeline_items")
          .select("*", { count: "exact", head: true })
          .eq("status", "House-Bid"),
        supabase
          .from("closing_pipeline_items")
          .select("*", { count: "exact", head: true })
          .eq("status", "Locked-Escrow-Pending"),
      ]);
      return `SYS_CHK: ${(hb.count ?? 0)} / ${(lep.count ?? 0)}`;
    },
    refetchInterval: 30_000,
  });

  const accelerate = useMutation({
    mutationFn: (id: string) => accelerateFn({ data: { id } }),
    onSuccess: (res) => {
      toast.success(`Accelerated → ${res.to}`);
      qc.invalidateQueries({ queryKey: ["escrow-items"] });
      qc.invalidateQueries({ queryKey: ["pipeline-full"] });
      qc.invalidateQueries({ queryKey: ["status-buckets"] });
    },
    onError: (e: Error) => toast.error(`Accelerate failed :: ${e.message}`),
  });

  const fetchTitlePkgs = useServerFn(listTitlePackages);
  const titlePkgQ = useQuery({
    queryKey: ["title-packages"],
    queryFn: () => fetchTitlePkgs(),
    refetchInterval: 60_000,
  });

  const titleByDeal = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of titlePkgQ.data ?? []) m[p.pipeline_item_id] = p.package_status;
    return m;
  }, [titlePkgQ.data]);

  const openEscrowFn = useServerFn(openTitleEscrow);
  const openEscrow = useMutation({
    mutationFn: (id: string) => openEscrowFn({ data: { id } }),
    onSuccess: (res) => {
      toast.success(`Escrow opened :: ${res.from} → In-Escrow`);
      qc.invalidateQueries({ queryKey: ["escrow-items"] });
      qc.invalidateQueries({ queryKey: ["pipeline-full"] });
      qc.invalidateQueries({ queryKey: ["status-buckets"] });
    },
    onError: (e: Error) => toast.error(`Escrow dispatch failed :: ${e.message}`),
  });

  const pkgFn = useServerFn(getTitlePackage);
  const downloadPkg = async (id: string) => {
    try {
      const pkg = await pkgFn({ data: { id } });
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `title-package-${id.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Title package exported");
    } catch (e) {
      toast.error(`Export failed :: ${(e as Error).message}`);
    }
  };



  const [selected, setSelected] = useState<EscrowItem | null>(null);
  const [flash, setFlash] = useState<Record<string, "green" | "yellow" | "red">>({});
  const [tick, setTick] = useState(0);
  const wsRef = useRef<{ events: number; lastAt: number }>({ events: 0, lastAt: 0 });
  const [wsState, setWsState] = useState<{ connected: boolean; events: number; lastAt: number }>({
    connected: false, events: 0, lastAt: 0,
  });

  // Re-render "Xs ago" timestamps every 5s
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5_000);
    return () => clearInterval(t);
  }, []);
  void tick;

  // Supabase Realtime — stream INSERT/UPDATE/DELETE on closing_pipeline_items
  useEffect(() => {
    const ch = supabase
      .channel("cpi-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "closing_pipeline_items" },
        (payload) => {
          wsRef.current.events += 1;
          wsRef.current.lastAt = Date.now();
          setWsState({ connected: true, events: wsRef.current.events, lastAt: wsRef.current.lastAt });

          const id =
            (payload.new as { id?: string } | null)?.id ??
            (payload.old as { id?: string } | null)?.id;
          if (id) {
            const tone: "green" | "yellow" | "red" =
              payload.eventType === "INSERT"
                ? "green"
                : payload.eventType === "DELETE"
                  ? "red"
                  : "yellow";
            setFlash((f) => ({ ...f, [id]: tone }));
            setTimeout(() => {
              setFlash((f) => {
                const n = { ...f };
                delete n[id];
                return n;
              });
            }, 1800);
          }
          qc.invalidateQueries({ queryKey: ["escrow-items"] });
          qc.invalidateQueries({ queryKey: ["pipeline-full"] });
          qc.invalidateQueries({ queryKey: ["status-buckets"] });
          qc.invalidateQueries({ queryKey: ["sys-chk"] });
        },
      )
      .subscribe((status) => {
        setWsState((s) => ({ ...s, connected: status === "SUBSCRIBED" }));
      });
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const items = data ?? [];
  const totalPremium = useMemo(
    () => items.reduce((s, i) => s + (i.optimized_acquisition_premium ?? 0), 0),
    [items],
  );

  // Merge & sort the live stream — most recently touched rows on top.
  const streamRows = useMemo(() => {
    const all = pipelineQ.data ?? [];
    const meta = new Map(items.map((i) => [i.id, i]));
    return all
      .slice()
      .sort((a, b) => {
        const ta = a.locked_at ? new Date(a.locked_at).getTime() : 0;
        const tb = b.locked_at ? new Date(b.locked_at).getTime() : 0;
        return tb - ta;
      })
      .map((r) => ({ row: r, full: meta.get(r.id) }));
  }, [pipelineQ.data, items]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 font-mono">
      {/* HEADER */}
      <div className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">/admin/escrow</div>
          <h1 className="text-lg font-bold text-emerald-400">ALPHA STREAM · ORDER BOOK</h1>
        </div>
        <div className="flex items-center gap-4 text-[10px] uppercase tracking-[0.2em]">
          <span className="flex items-center gap-1.5">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                wsState.connected ? "bg-emerald-400 animate-pulse" : "bg-rose-500"
              }`}
            />
            <span className={wsState.connected ? "text-emerald-400" : "text-rose-400"}>
              {wsState.connected ? "ws · live" : "ws · offline"}
            </span>
          </span>
          <span className="text-zinc-500">events {wsState.events}</span>
          <span className="text-zinc-500">last {wsState.lastAt ? fmtTime(new Date(wsState.lastAt).toISOString()) : "—"}</span>
        </div>
      </div>

      {/* KPI STRIP — hidden on Driver View */}
      <div className="hidden md:grid grid-cols-2 md:grid-cols-5 gap-px bg-zinc-800 border-b border-zinc-800">
        <Kpi label="Active" value={isLoading ? "…" : String(items.length)} />
        <Kpi label="Σ Spread (Active)" value={isLoading ? "…" : fmtMoney(totalPremium)} accent="text-emerald-400" />
        {(() => {
          const top = (bucketsQ.data ?? []).slice().sort((a, b) => b.count - a.count).slice(0, 3);
          while (top.length < 3) top.push({ status: "—", count: 0, premium: 0 });
          return top.map((b, i) => (
            <div key={`${b.status}-${i}`} className="bg-zinc-950 px-6 py-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 truncate">{b.status}</div>
              <div className="text-lg font-bold mt-1 text-zinc-100 tabular-nums">
                {bucketsQ.isLoading ? "…" : b.count}
              </div>
              <div className="text-[10px] text-emerald-400 tabular-nums">
                Σ {bucketsQ.isLoading ? "…" : fmtMoney(b.premium)}
              </div>
            </div>
          ));
        })()}
      </div>

      {error && (
        <div className="m-6 border border-rose-500/40 bg-rose-500/10 p-3 text-rose-400 text-xs">
          ERR :: {(error as Error).message}
        </div>
      )}

      {/* DRIVER VIEW — mobile one-tap approval queue */}
      <div className="md:hidden divide-y divide-zinc-900 pb-16">
        {pipelineQ.isLoading && <div className="px-4 py-6 text-xs text-zinc-500">streaming…</div>}
        {!pipelineQ.isLoading && streamRows.length === 0 && (
          <div className="px-4 py-6 text-xs text-zinc-500">NO RECORDS</div>
        )}
        {streamRows.map(({ row, full }) => (
          <div key={row.id} className="p-4">
            <div className="text-base font-bold text-zinc-100">{row.address ?? "—"}</div>
            <div className="mt-1 flex items-center gap-2 text-[11px]">
              <span className={`border px-1.5 py-0.5 uppercase tracking-wider ${statusTone(row.status)}`}>
                {row.status ?? "—"}
              </span>
              <span className="text-emerald-400 tabular-nums font-semibold">
                {fmtMoney(row.optimized_acquisition_premium)}
              </span>
              <span className="text-zinc-500">{fmtTime(row.locked_at)}</span>
            </div>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                disabled={openEscrow.isPending}
                onClick={() => openEscrow.mutate(row.id)}
                className="h-14 w-full border border-cyan-500/50 bg-cyan-500/10 text-sm font-bold uppercase tracking-[0.15em] text-cyan-300 active:bg-cyan-500/25 disabled:opacity-40"
              >
                Dispatch Escrow
              </button>
              <button
                type="button"
                disabled={accelerate.isPending}
                onClick={() => accelerate.mutate(row.id)}
                className="h-14 w-full border border-emerald-500/50 bg-emerald-500/10 text-sm font-bold uppercase tracking-[0.15em] text-emerald-300 active:bg-emerald-500/25 disabled:opacity-40"
              >
                Execute Algo Match
              </button>
            </div>
            {full && (
              <div className="mt-2 text-[10px] uppercase tracking-wider text-zinc-500">
                matched {full.matched_buyers_count} · conf {full.confidence_score ?? 0}%
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ORDER BOOK — full-width live stream */}
      <div className="hidden md:block border-b border-zinc-800 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900/60 text-zinc-500 sticky top-0 z-10">
            <tr className="text-left">
              <th className="px-3 py-2 font-normal uppercase tracking-wider text-[10px] w-[28%]">Asset · Address</th>
              <th className="px-3 py-2 font-normal uppercase tracking-wider text-[10px]">Seller Status</th>
              <th className="px-3 py-2 font-normal uppercase tracking-wider text-[10px]">Buyer / Matched</th>
              <th className="px-3 py-2 font-normal uppercase tracking-wider text-[10px]">Contract Status</th>
              <th className="px-3 py-2 font-normal uppercase tracking-wider text-[10px] text-right">Spread</th>
              <th className="px-3 py-2 font-normal uppercase tracking-wider text-[10px]">Last Updated</th>
              <th className="px-3 py-2 font-normal uppercase tracking-wider text-[10px]">Title Pkg</th>
              <th className="px-3 py-2 font-normal uppercase tracking-wider text-[10px] text-right">⋯</th>
            </tr>
          </thead>
          <tbody>
            {pipelineQ.isLoading && (
              <tr><td colSpan={8} className="px-3 py-6 text-zinc-500">streaming…</td></tr>
            )}
            {!pipelineQ.isLoading && streamRows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-zinc-500">NO RECORDS</td></tr>
            )}
            {streamRows.map(({ row, full }) => {
              const tone = flash[row.id];
              const flashCls =
                tone === "green"
                  ? "bg-emerald-500/15 transition-colors duration-1000"
                  : tone === "yellow"
                    ? "bg-amber-500/15 transition-colors duration-1000"
                    : tone === "red"
                      ? "bg-rose-500/15 transition-colors duration-1000"
                      : "hover:bg-zinc-900/40 transition-colors";
              const seller = full?.enrichment_tags?.find((t) =>
                ["1031-TARGET", "LOW-EMD-ELIGIBLE", "COMMERCIAL-INFILL", "ASSEMBLAGE-OPPORTUNITY"].includes(t),
              ) ?? "—";
              const buyer = full?.matched_buyer_id
                ? `${full.matched_buyer_id.slice(0, 8)}… · ${full.matched_buyers_count}`
                : full?.matched_buyers_count
                  ? `${full.matched_buyers_count} candidates`
                  : "unmatched";
              return (
                <tr
                  key={row.id}
                  onClick={() => full && setSelected(full)}
                  className={`border-t border-zinc-900 cursor-pointer ${flashCls}`}
                >
                  <td className="px-3 py-2 text-zinc-100 truncate max-w-[360px]">
                    <div className="truncate">{row.address ?? "—"}</div>
                    <div className="text-[10px] text-zinc-500 truncate">{row.id.slice(0, 8)}…</div>
                  </td>
                  <td className="px-3 py-2 text-zinc-400 text-[10px] uppercase tracking-wider truncate">{seller}</td>
                  <td className="px-3 py-2 text-zinc-300 text-[10px] truncate">{buyer}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${statusTone(row.status)}`}>
                      {row.status ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-emerald-400 tabular-nums font-semibold">
                    {fmtMoney(row.optimized_acquisition_premium)}
                  </td>
                  <td className="px-3 py-2 text-zinc-400 tabular-nums">{fmtTime(row.locked_at)}</td>
                  <td className="px-3 py-2 text-[10px] text-zinc-400 uppercase tracking-wider">
                    {titleByDeal[row.id] ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                    {["Locked-Escrow-Pending", "Buyer-Signed"].includes(row.status ?? "") && (
                      <button
                        type="button"
                        disabled={openEscrow.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEscrow.mutate(row.id);
                        }}
                        className="border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-40 text-cyan-300 text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 transition"
                      >
                        ▸ open title escrow
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void downloadPkg(row.id);
                      }}
                      className="border border-zinc-600 bg-zinc-800/40 hover:bg-zinc-700/40 text-zinc-300 text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 transition"
                    >
                      ⬇ pkg
                    </button>
                    <button
                      type="button"
                      disabled={accelerate.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        accelerate.mutate(row.id);
                      }}
                      className="border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 text-emerald-300 text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 transition"
                    >
                      ▸ accel
                    </button>

                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-zinc-800 bg-zinc-950 px-4 py-2 text-center text-[10px] tabular-nums text-zinc-500 md:hidden">
        {sysChkQ.data ?? "SYS_CHK: — / —"}
      </div>

      <div className="relative hidden md:block px-6 py-3 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        // {streamRows.length} rows · streaming via supabase_realtime · status ∈ {`{Scout, New, Buyer-Signed, Locked-Escrow-Pending, In-Escrow, House-Bid, Funds-Cleared}`}
        <span className="absolute bottom-1 right-3 text-[10px] normal-case tracking-normal text-zinc-500 tabular-nums">
          {sysChkQ.data ?? "SYS_CHK: — / —"}
        </span>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="bg-zinc-950 text-zinc-200 font-mono border-l border-zinc-800 w-full sm:max-w-md overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="text-emerald-400 text-sm">
                  {selected.address ?? "UNKNOWN ADDRESS"}
                </SheetTitle>
                <SheetDescription className="text-zinc-500 text-xs">
                  {[selected.city, selected.state, selected.zip].filter(Boolean).join(" · ")}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-3 text-xs">
                <Row k="Status" v={selected.status ?? "—"} />
                <Row k="Asset Type" v={selected.asset_type ?? "—"} />
                <Row k="Matched Buyers" v={String(selected.matched_buyers_count)} />
                <Row k="Matched Buyer ID" v={selected.matched_buyer_id ?? "—"} mono />
                <Row k="Spread" v={fmtMoney(selected.optimized_acquisition_premium)} accent="text-emerald-400" />
                <Row k="Base Contract" v={fmtMoney(selected.base_contract_price)} />
                <Row k="Confidence" v={`${selected.confidence_score ?? 0}%`} />
                <Row k="Liquidity Score" v={`${selected.liquidity_match_score ?? 0}`} />
                <Row k="Locked At" v={fmtDate(selected.locked_at)} />
                <Row k="Created" v={fmtDate(selected.created_at)} />
                {selected.enrichment_tags && selected.enrichment_tags.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase text-zinc-500 mb-1">Tags</div>
                    <div className="flex flex-wrap gap-1">
                      {selected.enrichment_tags.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px] border-zinc-700">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="pt-4 border-t border-zinc-800">
                  <div className="text-[10px] uppercase text-zinc-500 mb-1">Record ID</div>
                  <div className="text-[10px] text-zinc-400 break-all">{selected.id}</div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-zinc-950 px-6 py-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      <div className={`text-lg font-bold mt-1 tabular-nums ${accent ?? "text-zinc-100"}`}>{value}</div>
    </div>
  );
}

function Row({ k, v, accent, mono }: { k: string; v: string; accent?: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline border-b border-zinc-900 pb-2">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</span>
      <span className={`${accent ?? "text-zinc-200"} ${mono ? "text-[10px] break-all max-w-[60%] text-right" : ""}`}>
        {v}
      </span>
    </div>
  );
}
