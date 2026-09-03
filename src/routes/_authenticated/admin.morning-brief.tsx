import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listBundles, runAutoBundler } from "@/lib/bundles.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/morning-brief")({
  component: MorningBrief,
});

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function MorningBrief() {
  const router = useRouter();
  const fetchBundles = useServerFn(listBundles);
  const autoBundle = useServerFn(runAutoBundler);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["bundles"],
    queryFn: () => fetchBundles(),
    refetchInterval: 30_000,
  });

  const bundles = data?.bundles ?? [];
  const totalDeals = bundles.reduce((s, b) => s + b.deal_count, 0);
  const totalFee = bundles.reduce((s, b) => s + b.total_fee, 0);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Morning Brief</h1>
          <p className="text-muted-foreground">
            Institutional portfolios — auto-bundled by region.
          </p>
        </div>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await autoBundle();
              router.invalidate();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Re-calculating Portfolio…" : "Run Auto-Bundler"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Active Bundles</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{bundles.length}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Bundled Deals</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{totalDeals}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Total Assignment Fees</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{fmt(totalFee)}</CardContent>
        </Card>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : bundles.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No bundles yet. Click <strong>Run Auto-Bundler</strong> to group active deals by region.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {bundles.map((b) => (
            <Card key={b.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">{b.name}</CardTitle>
                <Badge variant={b.status === "active" ? "default" : "secondary"}>
                  {b.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-muted-foreground">Deals</div>
                    <div className="font-bold">{b.deal_count}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Total ARV</div>
                    <div className="font-bold">{fmt(b.total_arv)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Fees</div>
                    <div className="font-bold">{fmt(b.total_fee)}</div>
                  </div>
                </div>
                {b.reserved_for_fund && (
                  <div className="text-xs text-muted-foreground">
                    Soft-locked for {b.reserved_for_fund}
                    {b.soft_lock_until ? ` until ${new Date(b.soft_lock_until).toLocaleString()}` : ""}
                  </div>
                )}
                <div className="border-t pt-2 text-xs space-y-1 max-h-40 overflow-y-auto">
                  {b.deals.map((d) => (
                    <div key={d.id} className="flex justify-between">
                      <span className="font-mono">{d.zip}</span>
                      <span>{fmt(d.base_contract_price + d.optimized_acquisition_premium)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
