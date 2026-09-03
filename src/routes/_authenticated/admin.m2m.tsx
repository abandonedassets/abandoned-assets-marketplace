import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getM2MTerminal, type M2MWire } from "@/lib/m2m-terminal.functions";

export const Route = createFileRoute("/_authenticated/admin/m2m")({
  head: () => ({
    meta: [
      { title: "M2M Routing Terminal" },
      { name: "description", content: "Live M2M supply, demand and settlement routing terminal." },
      { property: "og:title", content: "M2M Routing Terminal" },
      { property: "og:description", content: "Live M2M supply, demand and settlement routing terminal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: M2MTerminal,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 font-mono text-sm">404</div>,
});

const usd = (n: number) =>
  "$" + Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

function Countdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return <span className="text-destructive">T-0 :: LAPSED</span>;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return (
    <span className={h < 6 ? "text-destructive" : "text-foreground"}>
      T-{String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl tabular-nums">{value}</div>
    </div>
  );
}

function M2MTerminal() {
  const fetchStats = useServerFn(getM2MTerminal);
  const { data, isLoading, error } = useQuery({
    queryKey: ["m2m-terminal"],
    queryFn: () => fetchStats({ data: undefined as never }),
    refetchInterval: 15_000,
  });

  if (isLoading) return <div className="p-6 font-mono text-sm">LOADING LIVE ROWS…</div>;
  if (error) return <div className="p-6 font-mono text-sm text-destructive">ERR :: {(error as Error).message}</div>;
  if (!data) return <div className="p-6 font-mono text-sm">$0</div>;

  const wires: M2MWire[] = data.pending_wires;

  return (
    <div className="p-4 font-mono text-sm">
      <h1 className="mb-4 text-xs uppercase tracking-[0.3em] text-muted-foreground">
        M2M Routing Terminal
      </h1>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label="Active Inventory" value={String(data.active_inventory)} />
        <Stat label="Live Pipeline Value" value={usd(data.live_pipeline_value)} />
        <Stat label="Settled Cash" value={usd(data.settled_cash)} />
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label="Matched Buyers" value={String(data.matched_buyers)} />
        <Stat label="Live Buy Boxes" value={String(data.buy_boxes)} />
        <Stat label="Offers Dispatched" value={String(data.offers_dispatched)} />
      </div>

      <div className="mt-4 border border-border p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Velocity Projection Deck — 30d settled fee forecast
        </div>
        <div className="mt-1 text-2xl tabular-nums">{usd(data.projection_30d)}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          clearing window {usd(data.pending_value)} · match rate{" "}
          {(data.match_rate * 100).toFixed(1)}% · T+2 turnover
        </div>
      </div>

      <div className="mt-4 border border-border">
        <div className="border-b border-border p-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          T-Minus Clearance Countdown ({wires.length})
        </div>
        {wires.length === 0 ? (
          <div className="p-3 text-muted-foreground">NO PENDING WIRES · $0</div>
        ) : (
          <div className="divide-y divide-border">
            {wires.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <div className="min-w-0">
                  <div className="truncate">{w.address ?? "—"}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {w.zip ?? "—"} · MEMO {w.memo_id}
                  </div>
                </div>
                <div className="flex items-center gap-4 tabular-nums">
                  <span>{usd(w.fee_usd)}</span>
                  <Countdown deadline={w.deadline} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
