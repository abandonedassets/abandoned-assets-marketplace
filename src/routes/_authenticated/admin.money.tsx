import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  getEscrowBoundCapital,
  getTransmissionTelemetry,
  getStallWatch,
} from "@/lib/admin-money.functions";
import { EscrowCapitalTicker } from "@/components/admin/money/EscrowCapitalTicker";
import { TransmissionTelemetryLog } from "@/components/admin/money/TransmissionTelemetryLog";
import { StallWatchlist } from "@/components/admin/money/StallWatchlist";

export const Route = createFileRoute("/_authenticated/admin/money")({
  head: () => ({
    meta: [
      { title: "Money Ops — Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminMoneyPage,
});

function AdminMoneyPage() {
  const fetchCapital = useServerFn(getEscrowBoundCapital);
  const fetchTelemetry = useServerFn(getTransmissionTelemetry);
  const fetchStall = useServerFn(getStallWatch);

  const capital = useQuery({
    queryKey: ["admin-money", "capital"],
    queryFn: () => fetchCapital(),
    refetchInterval: 15_000,
  });
  const telemetry = useQuery({
    queryKey: ["admin-money", "telemetry"],
    queryFn: () => fetchTelemetry(),
    refetchInterval: 15_000,
  });
  const stall = useQuery({
    queryKey: ["admin-money", "stall"],
    queryFn: () => fetchStall(),
    refetchInterval: 15_000,
  });

  const anyError = capital.error || telemetry.error || stall.error;

  return (
    <main className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="font-mono text-sm uppercase tracking-widest text-muted-foreground">
            /admin/money · frictionless flow
          </h1>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            Value Successfully Routed
          </p>
        </header>

        {anyError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {(anyError as Error).message}
          </div>
        )}

        {capital.data ? (
          <EscrowCapitalTicker data={capital.data} />
        ) : (
          <SkeletonCard h="h-40" />
        )}

        {stall.data && <StallWatchlist rows={stall.data} />}

        {telemetry.data ? (
          <TransmissionTelemetryLog
            rows={telemetry.data}
            updatedAt={telemetry.dataUpdatedAt}
          />
        ) : (
          <SkeletonCard h="h-80" />
        )}
      </div>
    </main>
  );
}

function SkeletonCard({ h }: { h: string }) {
  return (
    <div
      className={`${h} animate-pulse rounded-lg border border-border bg-muted/40`}
    />
  );
}
