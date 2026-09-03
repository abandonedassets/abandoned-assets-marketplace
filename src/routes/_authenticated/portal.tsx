import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import AllocationHeader, { EntityBadge, useAllocations } from "@/components/admin/AllocationHeader";

export const Route = createFileRoute("/_authenticated/portal")({
  head: () => ({
    meta: [
      { title: "Partner Allocation Portal — Ironclad Assets" },
      { name: "description", content: "Live partner allocation ledger: national land, timber and split-parcel holdings with real-time execution state." },
      { property: "og:title", content: "Partner Allocation Portal — Ironclad Assets" },
      { property: "og:description", content: "Live partner allocation ledger with real-time execution state." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PortalPage,
});

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function PortalPage() {
  const { snap, err } = useAllocations();
  const role = snap?.role ?? "ADMIN";
  const rows = snap?.rows ?? [];

  const header =
    role === "JAZMIN"
      ? "Ironclad Assets — National Land, Timber & Commercial Split Holdings"
      : role === "JAQUITA"
        ? "Indiana Land, Timber & Modular Portfolio"
        : "Master Allocation Ledger — All Entities";

  const metrics = useMemo(() => {
    const equity = rows.reduce((s, r) => s + (Number(r.contract_price) || 0), 0);
    const acreage = rows.reduce((s, r) => s + (Number(r.acreage) || 0), 0);
    const oddShare = rows
      .filter((r) => r.is_odd_parcel && (Number(r.contract_price) || 0) < 100000)
      .reduce((s, r) => s + (Number(r.jasmine_share) || 0), 0);
    const locked = rows
      .filter((r) => (r.status ?? "").toUpperCase().includes("LOCK"))
      .reduce((s, r) => s + (Number(r.assignment_fee) || 0), 0);
    return { equity, acreage, oddShare, locked };
  }, [rows]);

  return (
    <div className="min-h-screen bg-background p-4 font-mono text-xs text-foreground">
      <h1 className="mb-4 border-b border-border pb-3 text-base font-bold tracking-widest text-emerald-400">
        {header}
      </h1>

      <AllocationHeader snap={snap} err={err} />

      <div className="mb-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { k: "TOTAL ALLOCATED EQUITY", v: usd(metrics.equity) },
          { k: role === "JAQUITA" ? "ACTIVE INDIANA ACREAGE" : "ACTIVE ACREAGE", v: metrics.acreage.toFixed(1) },
          role === "JAQUITA"
            ? { k: "LOCKED ASSIGNMENT FEES", v: usd(metrics.locked) }
            : { k: "SUB-$100K ODD PARCEL SHARE", v: usd(metrics.oddShare) },
          { k: "POSITIONS", v: String(rows.length) },
        ].map((m) => (
          <div key={m.k} className="rounded border border-border bg-card/40 p-3">
            <div className="text-[10px] tracking-widest text-muted-foreground">{m.k}</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{m.v}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full min-w-[880px]">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              {["ASSET", "ZIP", "ST", "CLASS", "PARCEL", "PRICE", "FEE", "STATUS", "ENTITY"].map((h) => (
                <th key={h} className="px-2 py-1 text-left font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border/60">
                <td className="px-2 py-1 text-muted-foreground">{r.id.slice(0, 8)}</td>
                <td className="px-2 py-1">{r.zip ?? "—"}</td>
                <td className="px-2 py-1">{r.state ?? "—"}</td>
                <td className="px-2 py-1">{r.asset_class ?? "—"}</td>
                <td className="px-2 py-1">{r.is_odd_parcel ? "ODD" : "EVEN"}</td>
                <td className="px-2 py-1">{usd(Number(r.contract_price) || 0)}</td>
                <td className="px-2 py-1 text-emerald-400">{usd(Number(r.assignment_fee) || 0)}</td>
                <td className="px-2 py-1 text-muted-foreground">{r.status ?? "—"}</td>
                <td className="px-2 py-1"><EntityBadge beneficiary={r.primary_beneficiary} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-muted-foreground" colSpan={9}>No allocated positions.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
