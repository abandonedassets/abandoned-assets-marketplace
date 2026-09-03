import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAssemblageSnapshot } from "@/lib/assemblage.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WidgetBoundary } from "@/components/WidgetBoundary";

const TAG_COLORS: Record<string, string> = {
  "ASSEMBLAGE-OPPORTUNITY": "bg-purple-500/15 text-purple-300 border-purple-500/30",
  "1031-TARGET": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "LOW-EMD-ELIGIBLE": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "COMMERCIAL-INFILL": "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

const fmtSqft = (n: number) => `${n.toLocaleString()} sqft`;
const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function AssemblageRadar() {
  const fetchFn = useServerFn(getAssemblageSnapshot);
  const { data, isLoading } = useQuery({
    queryKey: ["assemblage-radar"],
    queryFn: () => fetchFn(),
    refetchInterval: 60_000,
  });

  return (
    <WidgetBoundary label="assemblage-radar">
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Assemblage Radar</div>
            <div className="text-xs text-muted-foreground">
              Adjacent / same-owner lots tagged for institutional buyers
            </div>
          </div>
          <div className="flex flex-wrap gap-1 justify-end">
            {Object.entries(data?.tag_counts ?? {}).map(([tag, n]) => (
              <Badge key={tag} variant="outline" className={`text-[10px] ${TAG_COLORS[tag] ?? ""}`}>
                {tag}: {n}
              </Badge>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="h-24 animate-pulse rounded bg-muted/40" />
        ) : !data?.groups?.length ? (
          <div className="text-xs text-muted-foreground py-4">
            No assemblage groups detected yet. Will populate as multi-lot owners are ingested.
          </div>
        ) : (
          <div className="space-y-2">
            {data.groups.map((g) => (
              <div
                key={g.group_id}
                className="flex items-center justify-between rounded border border-border/50 bg-card/50 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{g.owner_entity ?? "Unknown owner"}</div>
                  <div className="text-muted-foreground">
                    ZIP {g.zip ?? "—"} · {g.deal_count} lots
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-purple-300">{fmtSqft(g.combined_sqft)}</div>
                  <div className="text-muted-foreground">
                    {fmtUsd(g.combined_basis)} basis · {fmtUsd(g.combined_fee)} fee
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </WidgetBoundary>
  );
}
