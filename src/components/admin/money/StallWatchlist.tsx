import type { StallRow } from "@/lib/admin-money.functions";
import { Sparkles } from "lucide-react";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function CriticalStallBadge({ hours }: { hours: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
      <Sparkles className="h-3 w-3" />
      PRIME_OPPORTUNITY · {hours}h
    </span>
  );
}

export function StallWatchlist({ rows }: { rows: StallRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border-2 border-emerald-500/40 bg-emerald-500/5">
      <div className="flex items-center justify-between border-b border-emerald-500/30 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
          <Sparkles className="h-4 w-4" />
          Prime Opportunity Assets
        </h2>
        <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
          {rows.length} ready to close
        </span>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Tranche</th>
              <th className="px-4 py-2 font-medium">ZIP</th>
              <th className="px-4 py-2 font-medium">Contract</th>
              <th className="px-4 py-2 font-medium">Stage</th>
              <th className="px-4 py-2 font-medium">Seasoned</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pipeline_item_id} className="border-t border-emerald-500/15">
                <td className="px-4 py-2 font-mono text-xs text-card-foreground">
                  {r.pipeline_item_id.slice(0, 8)}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-card-foreground">
                  {r.zip}
                </td>
                <td className="px-4 py-2 font-mono text-xs tabular-nums text-card-foreground">
                  {fmt.format(r.base_contract_price)}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {r.package_status}
                </td>
                <td className="px-4 py-2">
                  <CriticalStallBadge hours={r.hours_since_handshake} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
