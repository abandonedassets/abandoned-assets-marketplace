import type { CviMetrics } from "@/lib/cvi.functions";

function fmtHours(h: number) {
  if (!isFinite(h) || h <= 0) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}

function Sparkline({ values }: { values: number[] }) {
  const w = 160;
  const h = 36;
  const max = Math.max(...values, 0.001);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CapitalVelocityIndex({ data }: { data: CviMetrics }) {
  const cur = Number(data.current_avg_hours) || 0;
  const prev = Number(data.previous_avg_hours) || 0;
  const hasPrev = prev > 0 && data.previous_sample > 0;
  const deltaPct = hasPrev ? ((cur - prev) / prev) * 100 : 0;
  const faster = hasPrev && cur < prev;
  const slower = hasPrev && cur > prev;
  const deltaColor = !hasPrev
    ? "text-muted-foreground"
    : faster
      ? "text-emerald-500"
      : slower && Math.abs(deltaPct) > 25
        ? "text-red-500"
        : slower
          ? "text-amber-500"
          : "text-muted-foreground";
  const arrow = !hasPrev ? "·" : faster ? "▼" : slower ? "▲" : "·";
  const series = (data.daily ?? []).map((d) => Number(d.avg_hours) || 0);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Capital Velocity Index
          </div>
          <div className="mt-1 text-2xl font-semibold">
            Avg Time to Clear: {fmtHours(cur)}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            7-day rolling · n={data.current_sample}
          </div>
        </div>
        <div className={`text-right ${deltaColor}`}>
          <div className="font-mono text-sm font-semibold">
            {arrow} {hasPrev ? `${Math.abs(deltaPct).toFixed(1)}%` : "—"}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            vs prior 7d
          </div>
        </div>
      </div>
      <div className={`mt-3 ${faster ? "text-emerald-500" : slower ? "text-amber-500" : "text-muted-foreground"}`}>
        <Sparkline values={series.length ? series : [0, 0]} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{data.daily?.[0]?.day?.slice(5) ?? ""}</span>
        <span>{data.daily?.[data.daily.length - 1]?.day?.slice(5) ?? ""}</span>
      </div>
    </div>
  );
}
