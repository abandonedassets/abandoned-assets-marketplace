import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { loadLedger, type LedgerEvent } from "@/lib/ledger-cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/admin/system-ledger")({
  head: () => ({
    meta: [
      { title: "System Ledger — Capitalized Software Equity" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: SystemLedger,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">LEDGER ERR :: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 font-mono text-sm">404</div>,
});

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function download(name: string, body: string, mime: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: LedgerEvent[]) {
  const head = "timestamp,commit_hash,milestone,subject,files_modified,hours_logged,hourly_rate_usd,capitalized_value_usd";
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [
    head,
    ...rows.map((e) =>
      [e.t, e.h, esc(e.m), esc(e.s), e.f, e.hrs, 150, e.v].join(","),
    ),
  ].join("\n");
}

function SystemLedger() {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(100);
  const { data, isLoading, error } = useQuery({
    queryKey: ["capitalization-ledger"],
    queryFn: loadLedger,
    refetchInterval: 60_000,
  });

  const ledger = data?.data;
  const rows = useMemo(() => {
    const all = [...(ledger?.events ?? [])].reverse();
    if (!q.trim()) return all;
    const needle = q.toLowerCase();
    return all.filter(
      (e) =>
        e.m.toLowerCase().includes(needle) ||
        e.s.toLowerCase().includes(needle) ||
        e.h.toLowerCase().startsWith(needle),
    );
  }, [ledger, q]);

  if (isLoading) return <div className="p-6 font-mono text-sm">LOADING LEDGER…</div>;
  if (error || !ledger)
    return (
      <div className="p-6 font-mono text-sm text-destructive">
        {(error as Error)?.message ?? "Ledger unavailable"}
      </div>
    );

  return (
    <div className="dark min-h-screen bg-background p-6 space-y-6 text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl tracking-tight">CAPITALIZATION LEDGER</h1>
          <p className="text-xs text-muted-foreground font-mono">
            ASC 350-40 / ASU 2025-06 · internal-use software · ${ledger.hourly_rate_usd}/hr
            benchmark · auth date {ledger.management_authorization_date?.slice(0, 10)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.offline ? <Badge variant="destructive">OFFLINE CACHE</Badge> : <Badge>LIVE</Badge>}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground">
              TOTAL CAPITALIZED SOFTWARE EQUITY
            </CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-3xl">
            {usd(ledger.total_capitalized_value_usd)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground">
              ENGINEERING HOURS LOGGED
            </CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-3xl">
            {ledger.total_hours_logged.toLocaleString("en-US")}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground">
              GIT COMMITS AUDITED
            </CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-3xl">
            {ledger.total_commits.toLocaleString("en-US")}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => download("audit_ledger.csv", toCsv(rows), "text/csv")}
        >
          Export Audit Ledger (CSV)
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            download("audit_ledger.json", JSON.stringify(ledger, null, 2), "application/json")
          }
        >
          Export Audit Ledger (JSON)
        </Button>
        <Button variant="secondary" asChild>
          <a href="/api/admin/ledger/export-csv">Export Full Commit Ledger (Server CSV)</a>
        </Button>
        <Button variant="secondary" asChild>
          <a href="/ledger/audit_log.json" download="capitalization_backup.json">
            Download Full Backup Archive
          </a>
        </Button>
        <Button variant="secondary" asChild>
          <a href="/docs/founder_resolution.md" download="founder_authorization_resolution.md">
            Download Founder Authorization Resolution
          </a>
        </Button>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by milestone, message or SHA…"
          className="w-64 font-mono text-xs"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono">MILESTONE VALUATION</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full font-mono text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1">MILESTONE</th>
                <th className="py-1 text-right">COMMITS</th>
                <th className="py-1 text-right">HOURS</th>
                <th className="py-1 text-right">VALUE</th>
              </tr>
            </thead>
            <tbody>
              {ledger.milestone_summary.map((m) => (
                <tr key={m.milestone} className="border-t border-border">
                  <td className="py-1">{m.milestone}</td>
                  <td className="py-1 text-right">{m.commits}</td>
                  <td className="py-1 text-right">{m.hours_logged}</td>
                  <td className="py-1 text-right">{usd(m.capitalized_value_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono">
            ITEMIZED COMMIT AUDIT ({rows.length.toLocaleString("en-US")})
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full font-mono text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1">TIMESTAMP</th>
                <th className="py-1">SHA</th>
                <th className="py-1">FEATURE / MILESTONE</th>
                <th className="py-1 text-right">FILES</th>
                <th className="py-1 text-right">HRS</th>
                <th className="py-1 text-right">VALUATION</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((e) => (
                <tr key={e.h} className="border-t border-border align-top">
                  <td className="py-1 whitespace-nowrap">{e.t.replace("T", " ").slice(0, 16)}</td>
                  <td className="py-1">{e.h.slice(0, 8)}</td>
                  <td className="py-1">
                    <div>{e.m}</div>
                    <div className="text-muted-foreground">{e.s}</div>
                  </td>
                  <td className="py-1 text-right">{e.f}</td>
                  <td className="py-1 text-right">{e.hrs}</td>
                  <td className="py-1 text-right">{usd(e.v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && (
            <Button variant="ghost" className="mt-3" onClick={() => setLimit((l) => l + 250)}>
              Load more ({rows.length - limit} remaining)
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
