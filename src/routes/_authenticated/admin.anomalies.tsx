import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listLedgerAnomalies,
  runLedgerAnomalyScan,
  resolveLedgerAnomaly,
} from "@/lib/anomalies.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/anomalies")({
  head: () => ({
    meta: [
      { title: "Ledger Anomaly Detector — Asset Navigator" },
      {
        name: "description",
        content:
          "Automated cross-reference of pipeline ledger state that flags jurisdictional and administrative contradictions.",
      },
      { property: "og:title", content: "Ledger Anomaly Detector" },
      {
        property: "og:description",
        content: "Systemic contradictions detected across the asset ledger.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnomaliesView,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-destructive">Detector offline: {(error as Error).message}</p>
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

function AnomaliesView() {
  const qc = useQueryClient();
  const listFn = useServerFn(listLedgerAnomalies);
  const scanFn = useServerFn(runLedgerAnomalyScan);
  const resolveFn = useServerFn(resolveLedgerAnomaly);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["ledger-anomalies"],
    queryFn: () => listFn(),
    refetchInterval: 30_000,
  });

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { open: 0, critical: 0, resolved: 0 };
  const refresh = () => qc.invalidateQueries({ queryKey: ["ledger-anomalies"] });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Ledger Anomaly Detector</h1>
          <p className="text-sm text-muted-foreground">
            Cross-references clearance, escrow, title and lock timestamps for contradictions.
          </p>
        </div>
        <Button
          onClick={async () => {
            await scanFn();
            refresh();
          }}
          disabled={isFetching}
        >
          Run scan
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Open</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{totals.open}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Critical</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-destructive">
            {totals.critical}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Resolved</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{totals.resolved}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detected contradictions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No anomalies on record. Run a scan to sweep the ledger.
            </p>
          )}
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-start justify-between gap-4 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={r.severity === "critical" ? "destructive" : "secondary"}>
                    {r.severity}
                  </Badge>
                  <span className="font-mono text-xs">{r.anomaly_code}</span>
                  {r.status !== "open" && <Badge variant="outline">resolved</Badge>}
                </div>
                <p className="mt-1 text-sm">{r.message}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
                  {r.pipeline_item_id ?? "—"} · last seen{" "}
                  {new Date(r.last_detected_at).toLocaleString()}
                </p>
              </div>
              {r.status === "open" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await resolveFn({ data: { id: r.id } });
                    refresh();
                  }}
                >
                  Resolve
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
