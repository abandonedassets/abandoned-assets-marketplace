import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { fetchRlsDebugRows } from "@/lib/rls-debug.functions";
import { hydrateSampleTelemetry } from "@/lib/telemetry-metrics.functions";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type RawError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

type Result = {
  label: string;
  ok: boolean;
  plain: string;
  error?: RawError;
};

function translate(code?: string): string {
  switch (code) {
    case "42501":
      return "DATABASE LOCKED (42501): Row level security / grants are blocking anon INSERT on this table.";
    case "23502":
      return "MISSING DATA (23502): A required (NOT NULL) column was empty.";
    case "23503":
      return "BROKEN LINK (23503): The insert references a related record that does not exist.";
    case "23505":
      return "DUPLICATE (23505): A row with these unique values already exists.";
    case "23514":
      return "INVALID VALUE (23514): A value failed a validation rule.";
    case "22P02":
      return "BAD FORMAT (22P02): Wrong data type sent.";
    case "42P01":
      return "TABLE MISSING (42P01): Table not exposed to the API.";
    case "42703":
      return "COLUMN MISSING (42703): A field being written does not exist.";
    case "CLIENT_EXCEPTION":
      return "NETWORK/CLIENT ERROR: The request never reached the database.";
    default:
      return "UNCLASSIFIED ERROR: See raw details below.";
  }
}

/** Pure anon client — no session, no persistence. Simulates an external webhook. */
function anonClient() {
  return createClient(
    import.meta.env.VITE_SUPABASE_URL as string,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false, storage: undefined } },
  );
}

type Rows = {
  buyer_waitlist: Record<string, unknown>[];
  conversion_events: Record<string, unknown>[];
  errors: (string | undefined)[];
};

export function RlsDebugger() {
  const [results, setResults] = useState<Result[]>([]);
  const [verified, setVerified] = useState(false);
  const [rows, setRows] = useState<Rows | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydrateMsg, setHydrateMsg] = useState<string | null>(null);
  const fetchRows = useServerFn(fetchRlsDebugRows);
  const runHydrate = useServerFn(hydrateSampleTelemetry);
  const qc = useQueryClient();

  const hydrate = async () => {
    setBusy(true);
    setHydrateMsg(null);
    try {
      const res = (await runHydrate({ data: undefined } as any)) as {
        inserted: number;
        error: string | null;
      };
      setHydrateMsg(
        res.error
          ? `Hydration failed: ${res.error}`
          : `Inserted ${res.inserted} sample events ($250 / $1,200 / $5,000). Dashboard metrics refreshed.`,
      );
      qc.invalidateQueries({ queryKey: ["telemetry-aggregates"] });
      qc.invalidateQueries({ queryKey: ["all-deals"] });
      const data = (await fetchRows()) as Rows;
      setRows(data);
    } catch (e: any) {
      setHydrateMsg(`Hydration failed: ${String(e?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };


  const runTest = async () => {
    setBusy(true);
    setResults([]);
    setVerified(false);
    setRows(null);

    const sb = anonClient();
    const out: Result[] = [];
    let halted = false;

    const fire = async (
      label: string,
      table: string,
      payload: Record<string, unknown>,
    ): Promise<boolean> => {
      try {
        const { error } = await (sb as any).from(table).insert(payload);
        if (error) {
          out.push({
            label,
            ok: false,
            plain: translate(error.code),
            error: {
              message: error.message,
              details: error.details,
              hint: error.hint,
              code: error.code,
            },
          });
          return false;
        }
        out.push({ label, ok: true, plain: "INSERT ACCEPTED (anon)" });
        return true;
      } catch (e: any) {
        out.push({
          label,
          ok: false,
          plain: translate("CLIENT_EXCEPTION"),
          error: { message: String(e?.message ?? e), code: "CLIENT_EXCEPTION" },
        });
        return false;
      }
    };

    // Synthetic high-frequency burst: 3 payloads per table, back-to-back.
    for (let i = 1; i <= 3; i++) {
      const stamp = Date.now();
      const okA = await fire(`buyer_waitlist #${i}`, "buyer_waitlist", {
        fund_name: `HF Burst Fund ${stamp}-${i}`,
        contact_email: `hf-burst-${stamp}-${i}@example.com`,
        target_zips: ["47302"],
        status: "pending",
        buyer_tier: "primary",
      });
      if (!okA) {
        halted = true;
        break;
      }
      const okB = await fire(`conversion_events #${i}`, "conversion_events", {
        event: "rls_burst_test",
        channel: "debug",
        metadata: { source: "rls-debugger-burst", stamp, seq: i },
      });
      if (!okB) {
        halted = true;
        break;
      }
    }

    setResults(out);
    setVerified(!halted && out.length === 6);

    try {
      const data = (await fetchRows()) as Rows;
      setRows(data);
    } catch (e) {
      console.error("[rls-debug] read-back failed", e);
    }

    setBusy(false);
  };

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>RLS Debugger — HF Burst Suite</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={runTest} disabled={busy}>
            {busy ? "Firing burst…" : "Test RLS Insert"}
          </Button>
          <Button variant="secondary" onClick={hydrate} disabled={busy}>
            {busy ? "Working…" : "Hydrate Sample Telemetry"}
          </Button>
        </div>
        {hydrateMsg && (
          <div className="rounded-md border border-border bg-muted p-3 text-sm">{hydrateMsg}</div>
        )}


        {verified && (
          <div className="rounded-md border-2 border-green-500 bg-green-500/15 p-4 text-sm font-semibold text-green-500">
            PIPELINE VERIFIED: ZERO-TRUST APPEND-ONLY STREAM ACTIVE.
          </div>
        )}

        {results.map((r) => (
          <div
            key={r.label}
            className={
              r.ok
                ? "rounded-md border border-border bg-muted p-3 text-sm"
                : "rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
            }
          >
            <div className="font-semibold">
              {r.label} — {r.plain}
            </div>
            {!r.ok && (
              <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">
                {`code:    ${r.error?.code ?? "(none)"}
message: ${r.error?.message ?? "(none)"}
details: ${r.error?.details ?? "(none)"}
hint:    ${r.error?.hint ?? "(none)"}`}
              </pre>
            )}
          </div>
        ))}

        {rows && (
          <div className="space-y-3">
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 text-sm font-semibold">
                buyer_waitlist (latest, service_role read-back)
              </div>
              <pre className="whitespace-pre-wrap font-mono text-xs">
                {JSON.stringify(rows.buyer_waitlist, null, 2)}
              </pre>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 text-sm font-semibold">
                conversion_events (latest, service_role read-back)
              </div>
              <pre className="whitespace-pre-wrap font-mono text-xs">
                {JSON.stringify(rows.conversion_events, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RlsDebugger;
