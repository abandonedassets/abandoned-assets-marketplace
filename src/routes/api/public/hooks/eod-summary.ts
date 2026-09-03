// End-of-Day Settlement Summary — aggregates the last 24h of cleared fees
// and pushes a digest to the admin telemetry channel. Logs to system_alerts
// as `eod_summary` so the report is queryable from the audit page.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/eod-summary")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const hours = Math.max(
            1,
            Math.min(168, Number(url.searchParams.get("hours") ?? 24)),
          );
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { data, error } = await supabaseAdmin.rpc(
            "eod_settlement_summary" as any,
            { _hours: hours },
          );
          if (error) {
            console.error("[eod-summary] rpc failed", error);
            return Response.json({ ok: false, error: error.message }, { status: 200 });
          }
          const digest = (data ?? {}) as Record<string, any>;
          try {
            const { notifyAdmin, fmtUsd } = await import("@/lib/notify.server");
            const topZip = (digest.by_zip?.[0]?.zip as string) ?? "—";
            await notifyAdmin(
              `📊 EOD ${hours}h · ${digest.cleared_count ?? 0} clears · ` +
                `${fmtUsd(Number(digest.total_cleared_usd ?? 0))} routed · top ZIP ${topZip}`,
            );
          } catch (e) {
            console.error("[eod-summary] notify failed", e);
          }
          await supabaseAdmin.from("system_alerts" as any).insert({
            kind: "eod_summary",
            severity: "info",
            message: `EOD ${hours}h digest`,
            metadata: digest as any,
          });
          return Response.json({ ok: true, digest });
        } catch (e) {
          console.error("[eod-summary] unhandled", e);
          return Response.json(
            { ok: false, error: (e as Error).message },
            { status: 200 },
          );
        }
      },
      GET: async () => Response.json({ ok: true, hint: "POST for EOD digest" }),
    },
  },
});
