// Scheduled ledger anomaly detector. Cross-references pipeline ledger state for
// jurisdictional/administrative contradictions. Fail-forward: always 200.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/ledger-anomaly-scan")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run the anomaly scan" }),
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("scan_ledger_anomalies" as never);
          if (error) {
            console.error("[anomaly-scan]", error.message);
            return Response.json({ ok: false, error: error.message }, { status: 200 });
          }
          const detected = (data ?? []) as Array<{ anomaly_code: string; detected: number }>;
          const total = detected.reduce((s, d) => s + Number(d.detected ?? 0), 0);
          return Response.json({ ok: true, total, detected });
        } catch (e) {
          console.error("[anomaly-scan] unhandled", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
        }
      },
    },
  },
});
