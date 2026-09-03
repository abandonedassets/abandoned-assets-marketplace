import type { RolloverStatus } from "@/lib/rollover.functions";

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function TomorrowPipeline({ data }: { data: RolloverStatus }) {
  const pct = data.daily_cap_usd > 0
    ? Math.min(100, Math.round((data.cleared_today_usd / data.daily_cap_usd) * 100))
    : 0;
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          tomorrow pipeline · rollover queue
        </h2>
        <span className="text-[10px] text-muted-foreground">
          cap {fmt(data.daily_cap_usd)}/day
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Cell label="Queued for tomorrow" value={fmt(data.tomorrow_total_usd)} accent />
        <Cell label="Assets queued" value={data.tomorrow_count.toLocaleString()} />
        <Cell label="Cleared today" value={fmt(data.cleared_today_usd)} />
        <Cell label="Remaining today" value={fmt(data.remaining_today_usd)} />
      </div>

      <div>
        <div className="h-2 w-full overflow-hidden rounded bg-muted">
          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {pct}% of daily cap used · system-hold: {data.system_hold_count}
        </div>
      </div>
    </section>
  );
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded border bg-background p-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-base font-semibold ${accent ? "text-emerald-500" : ""}`}>
        {value}
      </div>
    </div>
  );
}
