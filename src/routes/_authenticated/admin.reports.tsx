import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exportDealReportPdf } from "@/lib/report-export.functions";

export const Route = createFileRoute("/_authenticated/admin/reports")({
  head: () => ({
    meta: [
      { title: "Deal Report Export | Settlement Terminal" },
      {
        name: "description",
        content:
          "Export deal summaries to a flattened PDF with an embedded SHA-256 verified data payload.",
      },
      { property: "og:title", content: "Deal Report Export" },
      {
        property: "og:description",
        content: "Checksum-verified PDF deal summary exports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const exportPdf = useServerFn(exportDealReportPdf);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ checksum: string; rows: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await exportPdf({ data: { limit: 500 } });
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      setLast({ checksum: res.checksum, rows: res.row_count });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Deal Report Export</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Verified PDF Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Renders the deal tape to a flattened PDF and embeds the serialized JSON
            payload plus its SHA-256 checksum in the document properties.
          </p>
          <Button onClick={run} disabled={busy}>
            {busy ? "Generating…" : "Download Deal Summary PDF"}
          </Button>
          {last && (
            <p className="text-xs font-mono text-muted-foreground break-all">
              {last.rows} rows · sha256:{last.checksum}
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
