import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getAllocations, type AllocationSnapshot } from "@/lib/allocations.functions";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function useAllocations() {
  const fetchAlloc = useServerFn(getAllocations);
  const [snap, setSnap] = useState<AllocationSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSnap(await fetchAlloc({ data: undefined } as never));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [fetchAlloc]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void load(), 800);
    };
    const ch = supabase
      .channel("alloc-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "closing_pipeline_items" }, bump)
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      supabase.removeChannel(ch);
    };
  }, [load]);

  return { snap, err, reload: load };
}

export const BENEFICIARY_BADGE: Record<string, { label: string; className: string }> = {
  JAZMIN: { label: "JAZMIN · Ironclad Assets", className: "text-emerald-400 border-emerald-500/60 bg-emerald-500/10" },
  JAQUITA: { label: "JAQUITA · IN Reserve", className: "text-cyan-400 border-cyan-500/60 bg-cyan-500/10" },
  OWNER: { label: "OWNER · Institutional Floor", className: "text-amber-400 border-amber-500/60 bg-amber-500/10" },
};

export function EntityBadge({ beneficiary }: { beneficiary: string | null | undefined }) {
  const b = BENEFICIARY_BADGE[beneficiary ?? "OWNER"] ?? BENEFICIARY_BADGE["OWNER"]!;
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${b.className}`}>{b.label}</span>;
}

export default function AllocationHeader({ snap, err }: { snap: AllocationSnapshot | null; err?: string | null }) {
  const t = snap?.totals;
  const cards = useMemo(
    () => [
      { k: "MASTER STRIPE GROSS INGEST", v: t?.gross ?? 0, c: "text-foreground" },
      { k: "OWNER LIQUIDITY RESERVE", v: t?.owner ?? 0, c: "text-amber-400" },
      { k: "JAZMIN / IRONCLAD ASSETS", v: t?.jazmin ?? 0, c: "text-emerald-400" },
      { k: "JAQUITA SHARE (IN)", v: t?.jaquita ?? 0, c: "text-cyan-400" },
    ],
    [t],
  );

  return (
    <section className="mb-5">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.k} className="rounded border border-border bg-card/40 p-3">
            <div className="text-[10px] tracking-widest text-muted-foreground">{c.k}</div>
            <div className={`mt-1 text-lg font-bold tabular-nums ${c.c}`}>{usd(c.v)}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[10px] tracking-wide text-muted-foreground">
        Gross Inflow: Master Corporate Stripe (Direct ACH Routing Enabled)
        {err ? <span className="ml-3 text-red-500">ERR :: {err}</span> : null}
      </div>
    </section>
  );
}
