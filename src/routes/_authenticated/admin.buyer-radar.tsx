import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBuyerRadar, setKillSwitch, PERSONA_LABELS } from "@/lib/buyer-radar.functions";

export const Route = createFileRoute("/_authenticated/admin/buyer-radar")({
  head: () => ({
    meta: [
      { title: "Buyer Radar — Urgency-Ranked Capital Mandates" },
      {
        name: "description",
        content:
          "Rank tax-motivated and mandate-driven buyers by Buyer Urgency Score and watch vault routing in real time.",
      },
      { property: "og:title", content: "Buyer Radar — Urgency-Ranked Capital Mandates" },
      {
        property: "og:description",
        content: "1031, 1033, QOZ, TIMO and dry-powder buyers ranked by urgency.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BuyerRadar,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-destructive">Radar offline: {(error as Error).message}</p>
        <button
          className="mt-2 underline"
          onClick={() => {
            reset();
            router.invalidate();
          }}
        >
          Retry
        </button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function BuyerRadar() {
  const fetchRadar = useServerFn(getBuyerRadar);
  const flip = useServerFn(setKillSwitch);
  const q = useQuery({
    queryKey: ["buyer-radar"],
    queryFn: () => fetchRadar(),
    refetchInterval: 15_000,
  });

  const d = q.data;

  return (
    <div className="min-h-screen bg-background p-4 font-mono text-foreground md:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight">BUYER SPOTTING RADAR</h1>
          <p className="text-xs text-muted-foreground">
            BUS = (capital to deploy ÷ days remaining) × tax mitigation multiplier
          </p>
        </div>
        <button
          onClick={async () => {
            await flip({ data: { on: !d?.kill_switch } });
            q.refetch();
          }}
          className={`rounded border px-3 py-2 text-xs font-bold ${
            d?.kill_switch
              ? "border-destructive bg-destructive/15 text-destructive"
              : "border-border text-muted-foreground"
          }`}
        >
          {d?.kill_switch ? "◼ KILL SWITCH ENGAGED — RESUME" : "◻ KILL SWITCH: OFF"}
        </button>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(d?.vaults ?? []).map((v) => (
          <div key={v.vault} className="rounded border border-border p-3">
            <div className="text-[10px] uppercase text-muted-foreground">{v.vault}</div>
            <div className="text-lg font-bold">{usd(v.fee_usd)}</div>
            <div className="text-[11px] text-muted-foreground">
              {v.deal_count} assets
              {v.stumpage_mbf > 0 ? ` · ${Math.round(v.stumpage_mbf)} MBF` : ""}
            </div>
          </div>
        ))}
        <div className="rounded border border-border p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Manual (watchdog 60m)</div>
          <div className="text-lg font-bold">{d?.manual_pending ?? 0}</div>
          <div className="text-[11px] text-muted-foreground">auto-reverts to Autopilot</div>
        </div>
      </section>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Buyer</th>
              <th className="p-2 text-left">Persona</th>
              <th className="p-2 text-right">Capital</th>
              <th className="p-2 text-right">Days Left</th>
              <th className="p-2 text-right">BUS</th>
              <th className="p-2 text-left">Targets</th>
            </tr>
          </thead>
          <tbody>
            {(d?.buyers ?? []).map((b) => (
              <tr
                key={b.id}
                className={`border-t border-border ${b.final_stretch ? "bg-primary/5" : ""}`}
              >
                <td className="p-2">{b.label ?? b.id.slice(0, 8)}</td>
                <td className="p-2">{PERSONA_LABELS[b.persona]}</td>
                <td className="p-2 text-right">{usd(b.capital_to_deploy_usd)}</td>
                <td className="p-2 text-right">
                  {b.days_left === null ? "—" : b.days_left}
                  {b.final_stretch ? " ⚡" : ""}
                </td>
                <td className="p-2 text-right font-bold">
                  {b.urgency_score.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </td>
                <td className="p-2 text-muted-foreground">
                  {b.target_asset_types.join("/") || "any"} · {b.target_zip_codes.length} zips
                </td>
              </tr>
            ))}
            {!q.isLoading && (d?.buyers.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-muted-foreground">
                  No active buy boxes on radar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
