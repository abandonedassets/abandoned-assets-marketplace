import type { EscrowCapital } from "@/lib/admin-money.functions";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function EscrowCapitalTicker({ data }: { data: EscrowCapital }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        Active Opportunities · Capital In Flow
      </div>
      <div className="mt-2 font-mono text-4xl font-bold tabular-nums text-card-foreground md:text-5xl">
        {fmt.format(data.total_capital)}
      </div>
      <div className="mt-2 text-sm text-muted-foreground">
        {data.package_count} package{data.package_count === 1 ? "" : "s"} in
        title pipeline
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {(["Queued", "Built", "Sent"] as const).map((s) => (
          <span
            key={s}
            className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground"
          >
            {s} · {data.by_status[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
