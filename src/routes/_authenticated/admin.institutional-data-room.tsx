import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useRef } from "react";
import {
  appendAudit,
  attestAsset,
  advanceValue,
  downloadCsv,
  readAuditTrail,
  type AuditEntry,
} from "@/lib/collateral-attest";
import { loadLedger } from "@/lib/ledger-cache";
import { printDueDiligence } from "@/lib/due-diligence-pdf";
import {
  getDataRoomSnapshot,
  setLedgerWebhookUrl,
  syncLedgerToSheet,
} from "@/lib/data-room.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { LenderSyndication } from "@/components/admin/LenderSyndication";
import { SystemDiagnostics } from "@/components/admin/SystemDiagnostics";
import type { DataRoomDeal } from "@/lib/data-room.functions";

type FilterView = "commercial-land" | "residential-tapes" | "all";

const DISTRIBUTION = [
  { label: "Commercial Pads & NNN Retail Leases", pct: 40 },
  { label: "Entitled Land & Industrial Parcels", pct: 35 },
  { label: "Escrow Deal Tapes / Paper Inventory", pct: 25 },
] as const;

export const Route = createFileRoute("/_authenticated/admin/institutional-data-room")({
  head: () => ({
    meta: [
      { title: "Institutional Data Room — Clearinghouse Enterprise" },
      {
        name: "description",
        content:
          "Executive virtual data room: capitalized software equity, escrow deal tape inventory, and Section 363 title provenance for institutional underwriters.",
      },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: "Institutional Data Room — Clearinghouse Enterprise" },
      {
        property: "og:description",
        content: "GAAP ASC 350-40 capital base, deal tape inventory and algorithmic feed access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DataRoom,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">DATA ROOM ERR :: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 font-mono text-sm">404</div>,
});

type LedgerEvent = { t: string; h: string; m: string; s: string; f: number; hrs: number; v: number };

const handleExportCSV = async () => {
  const headers = [
    "Commit Hash",
    "Timestamp",
    "Feature Scope",
    "Subject",
    "Files Modified",
    "Hours",
    "Hourly Rate",
    "Capitalized Value",
  ];
  const escapeCell = (val: string) => `"${String(val).replace(/"/g, '""')}"`;

  let rows: string[][] = [];
  try {
    const res = await fetch("/ledger/ledger_summary.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`ledger_unavailable_${res.status}`);
    const ledger = (await res.json()) as { hourly_rate_usd?: number; events?: LedgerEvent[] };
    const rate = Number(ledger.hourly_rate_usd ?? 150);
    rows = (ledger.events ?? []).map((e) => [
      e.h,
      e.t,
      e.m,
      e.s,
      String(e.f),
      String(e.hrs),
      rate.toFixed(2),
      Number(e.v).toFixed(2),
    ]);
  } catch {
    alert("Commit ledger is unavailable right now — no export generated.");
    return;
  }
  if (!rows.length) {
    alert("Commit ledger returned no entries — nothing to export.");
    return;
  }

  const csvString = [
    headers.join(","),
    ...rows.map((row) => row.map(escapeCell).join(",")),
  ].join("\n");
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "system_audit_commit_ledger.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};


const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function Line({ label, value, indent }: { label: string; value: string; indent?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 font-mono text-xs ${indent ? "pl-4" : "font-semibold"}`}>
      <span className="truncate">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function normalizeAssetClass(raw: string | null) {
  return (raw ?? "").toLowerCase().replace(/[-_\s]/g, " ");
}

function isCommercialOrLand(d: DataRoomDeal) {
  const ac = normalizeAssetClass(d.asset_class);
  return (
    ac.includes("commercial") ||
    ac.includes("retail") ||
    ac.includes("nnn") ||
    ac.includes("pad") ||
    ac.includes("land") ||
    ac.includes("industrial") ||
    ac.includes("entitled")
  );
}

function isResidentialTape(d: DataRoomDeal) {
  const ac = normalizeAssetClass(d.asset_class);
  return (
    ac.includes("residential") ||
    ac.includes("sfr") ||
    ac.includes("single family") ||
    ac.includes("single_family") ||
    ac.includes("paper") ||
    ac.includes("tape") ||
    ac.includes("escrow")
  );
}

function CollateralDistribution() {
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="font-mono text-xs text-muted-foreground">DEFAULT COLLATERAL DISTRIBUTION</div>
      {DISTRIBUTION.map((d) => (
        <div key={d.label} className="space-y-1">
          <div className="flex justify-between font-mono text-xs">
            <span className="truncate">{d.label}</span>
            <span className="tabular-nums">{d.pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-primary"
              style={{ width: `${d.pct}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function FilterToggle({ value, onChange }: { value: FilterView; onChange: (v: FilterView) => void }) {
  const options: { key: FilterView; label: string }[] = [
    { key: "commercial-land", label: "Commercial & Land Focus" },
    { key: "residential-tapes", label: "Residential Deal Tapes" },
    { key: "all", label: "All Collateral Base" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <Button
          key={opt.key}
          size="sm"
          variant={value === opt.key ? "default" : "outline"}
          onClick={() => onChange(opt.key)}
          className="font-mono text-xs"
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

function DataRoom() {
  const qc = useQueryClient();
  const snapshotFn = useServerFn(getDataRoomSnapshot);
  const saveWebhook = useServerFn(setLedgerWebhookUrl);
  const syncSheet = useServerFn(syncLedgerToSheet);
  const [webhook, setWebhook] = useState<string | null>(null);
  const [filterView, setFilterView] = useState<FilterView>("all");
  const [attested, setAttested] = useState<Record<string, string>>({});
  const [sealing, setSealing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [trail, setTrail] = useState<AuditEntry[]>([]);
  const seededRef = useRef(false);

  useEffect(() => setTrail(readAuditTrail()), []);

  const ledgerQ = useQuery({ queryKey: ["capitalization-ledger"], queryFn: loadLedger });
  const roomQ = useQuery({
    queryKey: ["institutional-data-room"],
    queryFn: () => snapshotFn({ data: undefined as never }),
    refetchInterval: 60_000,
  });

  const save = useMutation({
    mutationFn: (url: string) => saveWebhook({ data: { url } }),
    onSuccess: () => {
      toast.success("Webhook endpoint saved");
      void qc.invalidateQueries({ queryKey: ["institutional-data-room"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ledger = ledgerQ.data?.data;
  const room = roomQ.data;
  const softwareEquity = ledger?.total_capitalized_value_usd ?? 0;
  const inventory = room?.escrow_inventory_usd ?? 0;
  const totalCapital = softwareEquity + inventory;
  const webhookValue = webhook ?? room?.webhook_url ?? "";

  const allDeals = room?.deals ?? [];
  const filteredDeals =
    filterView === "commercial-land"
      ? allDeals.filter(isCommercialOrLand)
      : filterView === "residential-tapes"
        ? allDeals.filter(isResidentialTape)
        : allDeals;
  const filteredInventory = filteredDeals.reduce((s, d) => s + d.valuation, 0);
  const advanceBase = filteredDeals.reduce((s, d) => s + advanceValue(d.asset_class, d.valuation), 0);
  const hashOf = (d: DataRoomDeal) => d.title_clean_hash ?? attested[d.id] ?? null;
  const unverified = filteredDeals.filter((d) => !hashOf(d));

  const bulkAttest = async () => {
    if (unverified.length === 0) {
      toast.info("Entire tape already cryptographically sealed");
      return;
    }
    setSealing(true);
    try {
      const next: Record<string, string> = { ...attested };
      for (const d of unverified) {
        next[d.id] = await attestAsset({
          id: d.id,
          parcel_id: d.parcel_id,
          asset_class: d.asset_class,
          valuation: d.valuation,
        });
      }
      setAttested(next);
      const entry = await appendAudit(
        "BULK_ATTEST",
        `SHA-256 sealed ${unverified.length} positions · ${usd(filteredInventory)} notional`,
      );
      setTrail(readAuditTrail());
      toast.success(`Sealed ${unverified.length} positions · ledger ${entry.hash.slice(0, 12)}…`);
      void runSync("delta", unverified.map((d) => d.id));
    } finally {
      setSealing(false);
    }
  };

  // Google Sheets ledger sync — full seed on load, delta stream on change.
  const runSync = async (mode: "full" | "delta", ids: string[] = []) => {
    setSyncing(true);
    try {
      const r = await syncSheet({ data: { mode, ids, vaultCashUsd: inventory } });
      const firstErr = r.errors?.[0];
      if (r.failed > 0) {
        toast.error(
          `Sheet ${mode} sync · ${r.delivered}/${r.total} delivered · ${r.failed} rejected` +
            (firstErr
              ? ` — batch ${firstErr.batch} HTTP ${firstErr.status || "ERR"} (${firstErr.latency_ms}ms): ${firstErr.detail}`
              : ""),
          { duration: 12_000 },
        );
        console.error("[sheet-sync] rejected batches", r.errors, "url:", r.url_used);
      } else if (r.delivered > 0) {
        toast.success(
          `Sheet ${mode} sync · ${r.delivered}/${r.total} rows @ ${r.syncTimestamp.slice(11, 19)}Z`,
        );
      } else {
        toast.info("Sheet sync · no rows to send");
      }
    } catch (e) {
      toast.error(`Sheet sync error: ${(e as Error).message}`, { duration: 12_000 });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (seededRef.current) return;
    if (!room?.webhook_url || (room?.deals ?? []).length === 0) return;
    seededRef.current = true;
    void runSync("full");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.webhook_url, room?.deals?.length]);

  const bulkExport = async () => {
    const rows: string[][] = [
      ["Parcel ID", "Asset Class", "Valuation", "Audit Status", "Title Hash"],
      ...filteredDeals.map((d) => [
        d.parcel_id ?? d.address ?? d.id,
        d.asset_class ?? "UNCLASSIFIED",
        d.valuation.toFixed(2),
        d.verification_status ?? d.status,
        hashOf(d) ?? "UNSEALED",
      ]),
    ];
    downloadCsv(`encrypted_collateral_ledger_${new Date().toISOString().slice(0, 10)}.csv`, rows);
    await appendAudit("BULK_EXPORT", `Exported ${filteredDeals.length} positions (${filterView})`);
    setTrail(readAuditTrail());
  };


  return (
    <div className="dark min-h-screen bg-background p-6 space-y-6 text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl tracking-tight">INSTITUTIONAL DATA ROOM</h1>
          <p className="font-mono text-xs text-muted-foreground">
            Confidential · Acquisitions Director / Capital Allocation Desk · GAAP ASC 350-40
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ledgerQ.data?.offline ? <Badge variant="destructive">OFFLINE CACHE</Badge> : <Badge>LIVE</Badge>}
          <Badge variant="outline" className="font-mono">HMAC-SHA256 FEED</Badge>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-xs text-muted-foreground">
              TOTAL SYSTEM CAPITAL BASE
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="font-mono text-3xl tabular-nums">{usd(totalCapital)}</div>
            <div className="space-y-1 border-t border-border pt-2">
              <Line indent label="Escrow Deal Tape Inventory" value={usd(inventory)} />
              <Line
                indent
                label="Capitalized Software Equity (ASC 350-40)"
                value={usd(softwareEquity)}
              />
              <Line label="TOTAL ASSETS" value={usd(totalCapital)} />
            </div>
            <CollateralDistribution />
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="secondary">Printable GAAP Balance Sheet</Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle className="font-mono text-sm">
                    STATEMENT OF FINANCIAL POSITION — GAAP ASC 350-40
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 font-mono text-xs">
                  <div className="text-muted-foreground">
                    As of {new Date().toLocaleDateString("en-US")} · Clearinghouse Enterprise Platform
                  </div>
                  <div className="space-y-1 border-t border-border pt-2">
                    <Line label="ASSETS" value="" />
                    <Line indent label="Restricted Cash & Escrow Deal Tape Inventory" value={usd(inventory)} />
                    <Line
                      indent
                      label={`Capitalized Software Intangibles (${(ledger?.total_hours_logged ?? 0).toLocaleString("en-US")} hrs @ $${ledger?.hourly_rate_usd ?? 150}/hr)`}
                      value={usd(softwareEquity)}
                    />
                    <Line label="TOTAL ASSETS" value={usd(totalCapital)} />
                  </div>
                  <div className="space-y-1 border-t border-border pt-2">
                    <Line label="LIABILITIES & OWNER'S EQUITY" value="" />
                    <Line indent label="Escrow Allocation Obligations" value={usd(inventory)} />
                    <Line indent label="Owner's Equity / Capitalized Sweat Equity" value={usd(softwareEquity)} />
                    <Line label="TOTAL LIABILITIES & OWNER'S EQUITY" value={usd(totalCapital)} />
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => window.print()}>
                    Print / Save as PDF
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-xs text-muted-foreground">TECHNICAL AUDIT</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2 font-mono">
              <div>
                <div className="text-xs text-muted-foreground">COMMITS</div>
                <div className="text-2xl tabular-nums">
                  {(ledger?.total_commits ?? 0).toLocaleString("en-US")}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">HOURS</div>
                <div className="text-2xl tabular-nums">
                  {(ledger?.total_hours_logged ?? 0).toLocaleString("en-US")}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">RATE</div>
                <div className="text-2xl tabular-nums">${ledger?.hourly_rate_usd ?? 150}/hr</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" variant="secondary" asChild>
                <a href="/ledger/audit_log.json" download="cryptographic_commit_ledger.json">
                  Download Cryptographic Commit Ledger (JSON)
                </a>
              </Button>
              <Button size="sm" variant="secondary" onClick={handleExportCSV}>
                Export Commit Ledger (CSV)
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  printDueDiligence({
                    softwareEquity,
                    inventory: filteredInventory,
                    totalCapital: softwareEquity + filteredInventory,
                    commits: ledger?.total_commits ?? 0,
                    hours: ledger?.total_hours_logged ?? 0,
                    rate: ledger?.hourly_rate_usd ?? 150,
                    deals: filteredDeals,
                  })
                }
              >
                Generate Institutional Due Diligence Package (PDF)
              </Button>
            </div>
            <div className="space-y-2 border-t border-border pt-3">
              <div className="font-mono text-xs text-muted-foreground">
                GOOGLE SHEETS / WEBHOOK URL (posted on every build)
              </div>
              <div className="flex gap-2">
                <Input
                  value={webhookValue}
                  onChange={(e) => setWebhook(e.target.value)}
                  placeholder="https://hooks.example.com/ledger"
                  className="font-mono text-xs"
                />
                <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(webhookValue)}>
                  Save
                </Button>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full font-mono text-xs"
                disabled={syncing || !webhookValue}
                onClick={() => runSync("full")}
              >
                {syncing ? "Streaming…" : `Full Sheet Sync — Seed All ${allDeals.length} Positions`}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <LenderSyndication deals={filteredDeals} />
      <SystemDiagnostics />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FilterToggle value={filterView} onChange={setFilterView} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={sealing} onClick={bulkAttest}>
              {sealing ? "Sealing…" : `Bulk Attest & Hash All Inventory (${unverified.length})`}
            </Button>
            <Button size="sm" variant="secondary" onClick={bulkExport}>
              Bulk Export Encrypted Ledger
            </Button>
          </div>
        </div>
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="font-mono text-sm">
              ACTIVE DEAL TAPE ({filteredDeals.length.toLocaleString("en-US")} of{" "}
              {(room?.deal_count ?? 0).toLocaleString("en-US")})
            </CardTitle>
            <Badge variant="outline" className="font-mono text-[10px]">
              HAIRCUT-ADJ ADVANCE BASE {usd(advanceBase)}
            </Badge>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {roomQ.isLoading ? (
              <div className="font-mono text-xs text-muted-foreground">LOADING TAPE…</div>
            ) : filteredDeals.length === 0 ? (
              <div className="font-mono text-xs text-muted-foreground">NO POSITIONS MATCH THE SELECTED FILTER.</div>
            ) : (
              <table className="w-full font-mono text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1">PARCEL</th>
                    <th className="py-1">ASSET CLASS</th>
                    <th className="py-1 text-right">VALUATION</th>
                    <th className="py-1 text-right">ADV. VALUE</th>
                    <th className="py-1">STATE</th>
                    <th className="py-1">TITLE HASH</th>
                    <th className="py-1">UTILITIES</th>
                    <th className="py-1">TENANT SOURCE</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDeals.slice(0, 500).map((d) => (
                    <tr key={d.id} className="border-t border-border">
                      <td className="py-1">{d.parcel_id ?? d.address ?? d.id.slice(0, 8)}</td>
                      <td className="py-1">{d.asset_class ?? "—"}</td>
                      <td className="py-1 text-right tabular-nums">{usd(d.valuation)}</td>
                      <td className="py-1 text-right tabular-nums text-muted-foreground">
                        {usd(advanceValue(d.asset_class, d.valuation))}
                      </td>
                      <td className="py-1">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {d.verification_status ?? d.status}
                        </Badge>
                        {d.is_dip ? (
                          <Badge className="ml-1 font-mono text-[10px]">363</Badge>
                        ) : null}
                      </td>
                      <td className="py-1 text-muted-foreground">
                        {hashOf(d) ? hashOf(d)!.slice(0, 14) + "…" : "—"}
                      </td>
                      <td className="py-1">{d.has_street_utilities ? "TAP-IN" : "—"}</td>
                      <td className="py-1">{d.source_system ?? "MAIN_CLEARINGHOUSE"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-sm">IMMUTABLE AUDIT TRAIL (COMMIT LEDGER)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 font-mono text-xs">
            {trail.length === 0 ? (
              <div className="text-muted-foreground">NO STATE TRANSITIONS RECORDED.</div>
            ) : (
              trail
                .slice(-25)
                .reverse()
                .map((e) => (
                  <div key={e.hash} className="flex flex-wrap justify-between gap-2 border-t border-border py-1">
                    <span>
                      #{e.seq} {e.action} — {e.detail}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(e.at).toLocaleString("en-US")} · {e.hash.slice(0, 16)}…
                    </span>
                  </div>
                ))
            )}
          </CardContent>
        </Card>
      </div>


      <p className="font-mono text-[11px] text-muted-foreground">
        Algorithmic ingestion: GET /api/v1/institutional/feed — payloads signed with X-M2M-Signature
        (HMAC-SHA256).
      </p>
    </div>
  );
}
