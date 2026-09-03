import type { ClearedAsset } from "@/lib/rollover.functions";

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function ClearedDaysToBank({ rows }: { rows: ClearedAsset[] }) {
  if (!rows.length) {
    return (
      <section className="rounded-lg border bg-card p-4">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          cleared assets · days to bank
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">
          No cleared assets yet. Estimates use Stripe&apos;s standard rolling 2-business-day payout.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          cleared assets · days to bank
        </h2>
        <span className="text-[10px] text-muted-foreground">est. standard payout</span>
      </div>
      <ul className="mt-3 divide-y text-sm">
        {rows.map((r) => (
          <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{r.address || "—"} · {r.zip || "—"}</div>
              <div className="text-[11px] text-muted-foreground">
                Cleared {new Date(r.cleared_at).toLocaleString()} · {fmt(r.cleared_amount)}
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-emerald-500">
                {r.days_to_bank === 0 ? "Arriving today" : `In ${r.days_to_bank}d`}
              </div>
              <div className="text-[11px] text-muted-foreground">~{r.bank_date}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
