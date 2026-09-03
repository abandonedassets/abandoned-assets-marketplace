import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCommercialRadar, getShieldedAssets } from "@/lib/commercial-radar.functions";

export const Route = createFileRoute("/_authenticated/admin/commercial-radar")({
  head: () => ({
    meta: [
      { title: "Commercial Zoning & Assemblage Radar" },
      {
        name: "description",
        content:
          "PE legislative shield, EPA pre-clearance, and assemblage clustering for institutional commercial, industrial, BTR and timber assets.",
      },
      { property: "og:title", content: "Commercial Zoning & Assemblage Radar" },
      {
        property: "og:description",
        content: "Route commercial, industrial, BTR and timber dirt to institutional capital; shield SFR from PE buyers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: CommercialRadarPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 font-mono text-sm">
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

const ZONE_STYLE: Record<string, string> = {
  COMMERCIAL: "border-sky-500/40 text-sky-300 bg-sky-500/10",
  INDUSTRIAL: "border-orange-500/40 text-orange-300 bg-orange-500/10",
  MULTIFAMILY_BTR: "border-purple-500/40 text-purple-300 bg-purple-500/10",
  AGRICULTURAL: "border-lime-500/40 text-lime-300 bg-lime-500/10",
  TIMBER: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  SFR: "border-muted-foreground/30 text-muted-foreground bg-muted/20",
  UNZONED: "border-border text-muted-foreground",
};

function Tag({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${className}`}>
      {children}
    </span>
  );
}

function CommercialRadarPage() {
  const fetchRadar = useServerFn(getCommercialRadar);
  const fetchAssets = useServerFn(getShieldedAssets);

  const radar = useQuery({
    queryKey: ["commercial-radar"],
    queryFn: () => fetchRadar(),
    refetchInterval: 30_000,
  });
  const assets = useQuery({
    queryKey: ["shielded-assets"],
    queryFn: () => fetchAssets(),
    refetchInterval: 30_000,
  });

  const d = radar.data;
  const institutional = d?.channel_counts?.["institutional_fund"] ?? 0;
  const retail = d?.channel_counts?.["local_cash_sdira"] ?? 0;

  return (
    <div className="min-h-screen bg-background p-4 font-mono text-foreground md:p-6">
      <header className="mb-5 border-b border-border pb-3">
        <h1 className="text-lg font-bold tracking-tight">COMMERCIAL ZONING &amp; ASSEMBLAGE RADAR</h1>
        <p className="text-xs text-muted-foreground">
          PE legislative shield · EPA/UST pre-clearance · assemblage multiplier · timber dual-yield
        </p>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border border-primary/40 bg-primary/5 p-3">
          <div className="text-[10px] uppercase text-muted-foreground">PE Clearance Approved</div>
          <div className="text-2xl font-bold">{institutional}</div>
          <div className="text-[11px] text-muted-foreground">routed to funds / REITs</div>
        </div>
        <div className="rounded border border-border p-3">
          <div className="text-[10px] uppercase text-muted-foreground">SFR Shielded</div>
          <div className="text-2xl font-bold">{retail}</div>
          <div className="text-[11px] text-muted-foreground">local cash / SDIRA only</div>
        </div>
        <div className="rounded border border-destructive/40 bg-destructive/5 p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Brownfield Quarantine</div>
          <div className="text-2xl font-bold">{d?.env_quarantined ?? 0}</div>
          <div className="text-[11px] text-muted-foreground">EPA/UST history flagged</div>
        </div>
        <div className="rounded border border-emerald-500/40 bg-emerald-500/5 p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Timber Dual-Yield</div>
          <div className="text-2xl font-bold">{d?.dual_yield ?? 0}</div>
          <div className="text-[11px] text-muted-foreground">stumpage + future dirt</div>
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-2 text-xs uppercase text-muted-foreground">Zoning Allocation</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(d?.zoning_counts ?? {}).map(([z, n]) => (
            <Tag key={z} className={ZONE_STYLE[z] ?? ZONE_STYLE["UNZONED"]!}>
              {z}: {n}
            </Tag>
          ))}
          {!radar.isLoading && Object.keys(d?.zoning_counts ?? {}).length === 0 && (
            <span className="text-xs text-muted-foreground">No active assets.</span>
          )}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-2 text-xs uppercase text-muted-foreground">
          Assemblage Opportunities (contiguous / same-owner non-SFR lots)
        </div>
        {!d?.clusters?.length ? (
          <div className="rounded border border-border p-4 text-xs text-muted-foreground">
            No multi-lot commercial clusters detected yet.
          </div>
        ) : (
          <div className="space-y-2">
            {d.clusters.map((c, i) => (
              <div
                key={`${c.zip}-${c.owner_entity}-${i}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-purple-500/30 bg-purple-500/5 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold">
                    {c.lot_count} contiguous lots · ZIP {c.zip ?? "—"}
                  </div>
                  <div className="text-muted-foreground">
                    {c.owner_entity ?? "Mixed owners"} · {c.zoning_category}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-purple-300">{usd(Number(c.combined_fee))}</div>
                  <div className="text-muted-foreground">
                    {usd(Number(c.combined_basis))} basis · {Number(c.combined_sqft).toLocaleString()} sqft
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Asset</th>
              <th className="p-2 text-left">Zoning</th>
              <th className="p-2 text-left">Channel</th>
              <th className="p-2 text-left">Environmental</th>
              <th className="p-2 text-right">Adjacent</th>
              <th className="p-2 text-right">Fee</th>
              <th className="p-2 text-left">Vault</th>
            </tr>
          </thead>
          <tbody>
            {(assets.data ?? []).map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="p-2">
                  {a.address ?? a.id.slice(0, 8)}
                  <span className="text-muted-foreground"> · {a.zip ?? "—"}</span>
                </td>
                <td className="p-2">
                  <Tag className={ZONE_STYLE[a.zoning_category ?? "UNZONED"] ?? ZONE_STYLE["UNZONED"]!}>
                    {a.zoning_category ?? "UNZONED"}
                  </Tag>
                  {a.enrichment_tags.includes("DUAL-YIELD") && (
                    <Tag className="ml-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                      dual-yield
                    </Tag>
                  )}
                </td>
                <td className="p-2">
                  {a.buyer_channel === "institutional_fund" ? (
                    <span className="text-primary">PE_CLEARANCE_APPROVED</span>
                  ) : (
                    <span className="text-muted-foreground">local / SDIRA only</span>
                  )}
                </td>
                <td className="p-2">
                  {a.env_status === "ENV-CLEARED" ? (
                    <Tag className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">env-cleared</Tag>
                  ) : (
                    <Tag className="border-destructive/40 bg-destructive/10 text-destructive">
                      quarantine
                    </Tag>
                  )}
                </td>
                <td className="p-2 text-right">{a.adjacent_parcel_count}</td>
                <td className="p-2 text-right">{usd(Number(a.optimized_acquisition_premium ?? 0))}</td>
                <td className="p-2 text-muted-foreground">{a.target_vault ?? "—"}</td>
              </tr>
            ))}
            {!assets.isLoading && (assets.data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-muted-foreground">
                  No active assets.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
