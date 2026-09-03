// Autonomous Dead-Man's Switch.
// Silence is the failure mode that never throws: no exceptions, no errors —
// just a pipeline that quietly stopped earning. This watches heartbeat signals
// and fires a critical payload to ADMIN_NOTIFY_WEBHOOK_URL when they flatline.
import { createFileRoute } from "@tanstack/react-router";

const SIGNALS = [
  { key: "ingest", table: "ingest_runs", column: "created_at", maxAgeMin: 180 },
  { key: "pipeline_activity", table: "closing_pipeline_items", column: "updated_at", maxAgeMin: 120 },
  { key: "esign", table: "esign_requests", column: "created_at", maxAgeMin: 2880 },
  { key: "outbound", table: "system_audit_logs", column: "created_at", maxAgeMin: 240 },
] as const;

export const Route = createFileRoute("/api/public/hooks/deadman")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run the dead-man's switch" }),
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const now = Date.now();
          const results: Record<string, { last: string | null; age_min: number | null; stale: boolean }> = {};

          for (const s of SIGNALS) {
            const { data } = await supabaseAdmin
              .from(s.table as never)
              .select(s.column)
              .order(s.column, { ascending: false })
              .limit(1)
              .maybeSingle();
            const last = (data as any)?.[s.column] ?? null;
            const ageMin = last ? Math.round((now - new Date(last).getTime()) / 60000) : null;
            results[s.key] = {
              last,
              age_min: ageMin,
              stale: ageMin === null || ageMin > s.maxAgeMin,
            };
          }

          // Bluevine money-in heartbeat: any settlement in the last 72h.
          const { data: cleared } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select("cleared_at")
            .not("cleared_at", "is", null)
            .order("cleared_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const lastCleared = (cleared as any)?.cleared_at ?? null;
          const clearedAgeMin = lastCleared
            ? Math.round((now - new Date(lastCleared).getTime()) / 60000)
            : null;
          results["bluevine_settlement"] = {
            last: lastCleared,
            age_min: clearedAgeMin,
            stale: clearedAgeMin === null || clearedAgeMin > 4320,
          };

          const flatlined = Object.entries(results)
            .filter(([, v]) => v.stale)
            .map(([k]) => k);

          // Mute gate: DEADMAN alerts stay silent until the first live Bluevine
          // settlement clears (pre-revenue silence is expected, not a fault).
          let muted = false;
          try {
            const { data: cfg } = await supabaseAdmin
              .from("system_config")
              .select("value")
              .eq("key", "DEADMAN_MUTED_UNTIL_FIRST_CLEARANCE")
              .maybeSingle();
            const on = (cfg as any)?.value;
            muted = (on === true || on === "true") && !lastCleared;
          } catch {}

          if (flatlined.length > 0 && !muted) {

            const { notifyAdmin } = await import("@/lib/notify.server");
            const lines = flatlined
              .map((k) => `• ${k}: last signal ${results[k].age_min ?? "never"} min ago`)
              .join("\n");
            await notifyAdmin(
              `🚨 DEAD-MAN'S SWITCH — ${flatlined.length} signal(s) flatlined without errors.\n${lines}\nChecked ${new Date().toISOString()}`,
            );
            await supabaseAdmin
              .from("system_alerts")
              .insert({
                kind: "DEADMAN_FLATLINE",
                severity: flatlined.length >= 3 ? "critical" : "warning",
                message: `Silent halt detected: ${flatlined.join(", ")}`,
                metadata: results as never,
              } as never)
              .then(undefined, (e: unknown) => console.error("[deadman] alert insert failed", e));
          }

          return Response.json({
            ok: true,
            flatlined,
            muted,
            signals: results,
            at: new Date().toISOString(),
          });
        } catch (e) {
          console.error("[deadman] failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
