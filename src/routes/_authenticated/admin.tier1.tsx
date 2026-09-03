import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTier1DarkPool } from "@/lib/tier1.functions";
import { listBuyBoxMatches } from "@/lib/buyer.functions";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WebhookPortal } from "@/components/admin/WebhookPortal";

export const Route = createFileRoute("/_authenticated/admin/tier1")({
  head: () => ({ meta: [{ title: "Tier-1 Dark Pool — Whale-Class Assets" }] }),
  component: Tier1View,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-destructive">Dark Pool offline: {(error as Error).message}</p>
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

const usd = (n: unknown) =>
  Number(n ?? 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

function Tier1View() {
  const fetcher = useServerFn(getTier1DarkPool);
  const { data, isLoading } = useQuery({
    queryKey: ["tier1-dark-pool"],
    queryFn: () => fetcher(),
    refetchInterval: 15_000,
  });

  const matchesFn = useServerFn(listBuyBoxMatches);
  const { data: matches } = useQuery({
    queryKey: ["buy-box-matches"],
    queryFn: () => matchesFn({ data: {} as never }),
    refetchInterval: 30_000,
  });

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { count: 0, fees: 0, notional: 0 };

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tier-1 Dark Pool</h1>
          <p className="text-sm text-muted-foreground">
            Whale-class assets ({">="} $100k fee) segregated from standard flow · refreshes every 15s
          </p>
        </div>
        {isLoading ? <Badge variant="outline">Syncing…</Badge> : <Badge>Live</Badge>}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Tier-1 Assets</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{totals.count}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Total Notional</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{usd(totals.notional)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Total Fees (Master)</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{usd(totals.fees)}</div></CardContent>
        </Card>
      </div>

      <WebhookPortal />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Buyer Network — Live Liquidity Matching</CardTitle>
          <Link to="/admin/keys" className="text-sm underline">
            Issue institutional API key →
          </Link>
        </CardHeader>
        <CardContent>
          {(matches ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No buy boxes yet. Onboard buyers at /buyer/onboarding.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Buyer / Box</th>
                  <th className="py-2 pr-4">Priority</th>
                  <th className="py-2 pr-4 text-right">Max Price</th>
                  <th className="py-2 pr-4 text-right">Min Margin</th>
                  <th className="py-2 pr-4 text-right">Matches</th>
                  <th className="py-2 pr-4 text-right">Matched Spread</th>
                </tr>
              </thead>
              <tbody>
                {(matches ?? []).map((b: any) => (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{b.label ?? b.id.slice(0, 8)}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={b.active ? "default" : "outline"}>
                        {b.buyer_priority ?? "standard"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-right">{usd(b.max_contract_price)}</td>
                    <td className="py-2 pr-4 text-right">{Number(b.min_placement_margin)}%</td>
                    <td className="py-2 pr-4 text-right font-semibold">{b.match_count}</td>
                    <td className="py-2 pr-4 text-right text-emerald-500">
                      {usd(b.matched_premium)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Segregated Whale Ledger</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Tier-1 assets yet. Whale-class deals (fee ≥ $100k) will appear here automatically.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Asset</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4 text-right">Price</th>
                    <th className="py-2 pr-4 text-right">Fee</th>
                    <th className="py-2 pr-4">Title</th>
                    <th className="py-2 pr-4 text-right">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{r.property_address ?? r.zip ?? "—"}</td>
                      <td className="py-2 pr-4"><Badge variant="outline">{r.status}</Badge></td>
                      <td className="py-2 pr-4 text-right">{usd(r.base_contract_price)}</td>
                      <td className="py-2 pr-4 text-right font-semibold">{usd(r.fee)}</td>
                      <td className="py-2 pr-4">{r.title_status ?? "—"}</td>
                      <td className="py-2 pr-4 text-right">{r.confidence_score ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
