import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/admin/ingest")({
  head: () => ({
    meta: [
      { title: "Bulk Ingest — Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminIngestPage,
});

type Row = Record<string, unknown>;
type Result = { ok: number; fail: number; errors: string[] };

// Tiny CSV parser (handles quoted fields, commas, newlines, escaped quotes).
function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (field.length || cur.length) { cur.push(field); rows.push(cur); }
        field = ""; cur = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function parseInput(text: string): Row[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const j = JSON.parse(trimmed);
    return Array.isArray(j) ? j : [j];
  }
  return parseCsv(trimmed);
}

async function postOne(row: Row): Promise<{ ok: boolean; msg?: string }> {
  try {
    const res = await fetch("/api/public/hooks/cognitive-ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j?.ingested) return { ok: true };
    return { ok: false, msg: j?.reason ?? `http_${res.status}` };
  } catch (e: any) {
    return { ok: false, msg: e?.message ?? "network_error" };
  }
}

function AdminIngestPage() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<Result | null>(null);

  const onFile = async (f: File) => {
    setText(await f.text());
  };

  const run = async () => {
    setResult(null);
    let rows: Row[];
    try {
      rows = parseInput(text);
    } catch (e: any) {
      setResult({ ok: 0, fail: 0, errors: [`parse_error: ${e.message}`] });
      return;
    }
    if (rows.length === 0) {
      setResult({ ok: 0, fail: 0, errors: ["no_rows"] });
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: rows.length });
    const errors: string[] = [];
    let ok = 0, fail = 0;
    const BATCH = 5;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const results = await Promise.all(slice.map(postOne));
      results.forEach((r, idx) => {
        if (r.ok) ok++;
        else {
          fail++;
          if (errors.length < 10) errors.push(`row ${i + idx + 1}: ${r.msg}`);
        }
      });
      setProgress({ done: Math.min(i + BATCH, rows.length), total: rows.length });
    }
    setBusy(false);
    setResult({ ok, fail, errors });
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Bulk Ingest</h1>
          <p className="text-sm text-muted-foreground">
            Paste CSV or JSON array, or upload a file. Each row POSTs to{" "}
            <code>/api/public/hooks/cognitive-ingest</code> in batches of 5.
            Recognized columns: zip, beds, baths, sqft, year_built,
            base_contract_price (or price/acquisition_price), underwritten_arv (or arv).
          </p>
        </header>

        <div className="space-y-2">
          <Input
            type="file"
            accept=".csv,.json,.txt,application/json,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
            disabled={busy}
          />
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`zip,base_contract_price,underwritten_arv,beds,baths,sqft\n45402,80000,140000,3,2,1400`}
            className="min-h-[240px] font-mono text-xs"
            disabled={busy}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={run} disabled={busy || !text.trim()}>
            {busy ? `Ingesting ${progress.done}/${progress.total}…` : "Ingest"}
          </Button>
          <Button
            variant="outline"
            onClick={() => { setText(""); setResult(null); }}
            disabled={busy}
          >
            Clear
          </Button>
        </div>

        {result && (
          <div className="rounded border border-border p-4 space-y-2">
            <div className="text-sm">
              <span className="text-green-500 font-mono">✓ {result.ok} ingested</span>
              {" · "}
              <span className="text-red-500 font-mono">✗ {result.fail} failed</span>
            </div>
            {result.errors.length > 0 && (
              <ul className="text-xs font-mono text-muted-foreground space-y-1">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
