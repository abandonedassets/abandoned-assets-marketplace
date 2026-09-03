import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { executeTotalSystemSync } from "@/lib/migration.functions";

export const Route = createFileRoute("/_authenticated/admin/migrate")({
  head: () => ({
    meta: [
      { title: "Cross-Project Migration — Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminMigratePage,
});

type Report = {
  table: string;
  discovered: number;
  ingested: number;
  skipped: number;
  failed: number;
  status: string;
  error?: string;
};

type SyncResult = {
  reports: Report[];
  totals: { discovered: number; ingested: number; skipped: number; failed: number };
  completedAt: string;
};

function AdminMigratePage() {
  const sync = useServerFn(executeTotalSystemSync);
  const [legacyUrl, setLegacyUrl] = useState("");
  const [legacyAnonKey, setLegacyAnonKey] = useState("");
  const [tablesCsv, setTablesCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const tables = tablesCsv
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const r = (await sync({
        data: {
          legacyUrl: legacyUrl.trim(),
          legacyAnonKey: legacyAnonKey.trim(),
          tables: tables.length ? tables : undefined,
        },
      })) as SyncResult;
      setResult(r);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Cross-Project Migration</h1>
          <p className="text-sm text-muted-foreground">
            Pulls rows from a legacy Lovable Cloud project via its public REST
            API and upserts them into <code>closing_pipeline_items</code>.
            Requires that the legacy tables expose anon SELECT (RLS) or that
            you supply a service-role-equivalent key with read access.
          </p>
        </header>

        <div className="space-y-3 rounded border border-border p-4">
          <div className="space-y-1">
            <Label htmlFor="url">Legacy SUPABASE_URL</Label>
            <Input
              id="url"
              value={legacyUrl}
              onChange={(e) => setLegacyUrl(e.target.value)}
              placeholder="https://xxxxx.supabase.co"
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="key">Legacy SUPABASE_ANON_KEY (or read-capable key)</Label>
            <Input
              id="key"
              type="password"
              value={legacyAnonKey}
              onChange={(e) => setLegacyAnonKey(e.target.value)}
              placeholder="eyJhbGciOi..."
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tbls">Tables (optional, comma-separated)</Label>
            <Textarea
              id="tbls"
              value={tablesCsv}
              onChange={(e) => setTablesCsv(e.target.value)}
              placeholder="properties, deals, contracts, leads  (leave empty to auto-probe defaults)"
              className="min-h-[60px] font-mono text-xs"
              disabled={busy}
            />
          </div>
          <div className="flex gap-3">
            <Button onClick={run} disabled={busy || !legacyUrl || !legacyAnonKey}>
              {busy ? "Migrating…" : "Execute Total System Sync"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {result && (
          <div className="rounded border border-border p-4 space-y-3">
            <div className="text-sm font-mono">
              Completed {new Date(result.completedAt).toLocaleString()} ·{" "}
              <span className="text-green-500">✓ {result.totals.ingested} ingested</span> ·{" "}
              <span className="text-yellow-500">⊘ {result.totals.skipped} skipped</span> ·{" "}
              <span className="text-red-500">✗ {result.totals.failed} failed</span> · discovered {result.totals.discovered}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3">Table</th>
                    <th className="py-2 pr-3">Discovered</th>
                    <th className="py-2 pr-3">Ingested</th>
                    <th className="py-2 pr-3">Skipped</th>
                    <th className="py-2 pr-3">Failed</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {result.reports.map((r) => (
                    <tr key={r.table} className="border-b border-border/50">
                      <td className="py-2 pr-3">{r.table}</td>
                      <td className="py-2 pr-3">{r.discovered}</td>
                      <td className="py-2 pr-3 text-green-500">{r.ingested}</td>
                      <td className="py-2 pr-3 text-yellow-500">{r.skipped}</td>
                      <td className="py-2 pr-3 text-red-500">{r.failed}</td>
                      <td className="py-2 pr-3">{r.status}</td>
                      <td className="py-2 text-muted-foreground">{r.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Open the terminal at <code>/</code> — Contracts Secured, Fees in
              Escrow, and Pipeline Value reflect the new rows in real time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
