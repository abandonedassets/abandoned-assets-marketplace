import { createFileRoute } from "@tanstack/react-router";

// Pass H — Self-Healing Data-Path Reconfigurator.
// Heuristic threshold: >5 gis_fetch_failed in 24h for active URL =>
//   1) mark deprecated
//   2) swap ACTIVE_GIS_URL to next failover
//   3) if none, scrape portal HTML for a likely ArcGIS REST endpoint
// Fail-forward: always returns 200.

const ARCGIS_URL_RE =
  /https?:\/\/[^\s"'<>]+\/arcgis\/rest\/services\/[^\s"'<>]+\/MapServer\/\d+\/query/gi;

export const Route = createFileRoute("/api/public/hooks/autonomous-dlq-monitor")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, note: "POST to run DLQ self-healer" }),
      POST: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const summary: Record<string, unknown> = {
          ok: true,
          ran_at: new Date().toISOString(),
        };

        try {
          // 1) Read active + failover config
          const { data: cfgRows } = await supabaseAdmin
            .from("system_config")
            .select("key,value")
            .in("key", [
              "ACTIVE_GIS_URL",
              "GIS_FAILOVER_ENDPOINTS",
              "GIS_PORTAL_DISCOVERY_URL",
              "GIS_DEPRECATED_URLS",
            ]);

          const cfg: Record<string, any> = {};
          for (const r of cfgRows ?? []) cfg[r.key] = r.value;

          const activeUrl: string | null =
            typeof cfg.ACTIVE_GIS_URL === "string" ? cfg.ACTIVE_GIS_URL : null;
          const failovers: string[] = Array.isArray(cfg.GIS_FAILOVER_ENDPOINTS)
            ? cfg.GIS_FAILOVER_ENDPOINTS.filter((x: unknown) => typeof x === "string")
            : [];
          const deprecated: string[] = Array.isArray(cfg.GIS_DEPRECATED_URLS)
            ? cfg.GIS_DEPRECATED_URLS.filter((x: unknown) => typeof x === "string")
            : [];
          const portalUrl: string | null =
            typeof cfg.GIS_PORTAL_DISCOVERY_URL === "string"
              ? cfg.GIS_PORTAL_DISCOVERY_URL
              : null;

          summary.active_url = activeUrl;
          summary.failovers_remaining = failovers.length;

          if (!activeUrl) {
            return Response.json(summary, { status: 200 });
          }

          // 2) Count failures in last 24h for active URL
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data: dlqRows } = await supabaseAdmin
            .from("dead_letter_queue")
            .select("raw_payload,error_reason,created_at")
            .ilike("error_reason", "%gis_fetch_failed%")
            .gte("created_at", since)
            .limit(500);

          let failCount = 0;
          for (const r of dlqRows ?? []) {
            const url = (r as any)?.raw_payload?.url;
            if (typeof url === "string" && url === activeUrl) failCount++;
          }

          summary.fail_count_24h = failCount;
          summary.threshold = 5;

          if (failCount <= 5) {
            return Response.json(summary, { status: 200 });
          }

          // 3) Threshold breached — reseed
          const nextDeprecated = Array.from(new Set([...deprecated, activeUrl]));
          let nextActive: string | null = null;
          const remainingFailovers = failovers.filter(
            (u) => !nextDeprecated.includes(u),
          );

          if (remainingFailovers.length > 0) {
            nextActive = remainingFailovers[0];
            summary.action = "failover_swap";
          } else if (portalUrl) {
            // 4) Auto-discover: scrape portal HTML for an ArcGIS query endpoint
            try {
              const res = await fetch(portalUrl, {
                signal: AbortSignal.timeout(20_000),
                headers: { "user-agent": "Mozilla/5.0 (compatible; AssetWeaverBot/1.0)" },
              });
              if (res.ok) {
                const html = await res.text();
                const matches = Array.from(html.matchAll(ARCGIS_URL_RE)).map((m) => m[0]);
                const fresh = matches.find(
                  (u) => !nextDeprecated.includes(u) && u !== activeUrl,
                );
                if (fresh) {
                  nextActive = fresh;
                  summary.action = "auto_discovered";
                  summary.discovered_url = fresh;
                }
              }
            } catch (e) {
              summary.discovery_error = (e as Error).message;
            }
          }

          if (!nextActive) {
            // Alert via DLQ row — no replacement available
            await supabaseAdmin.from("dead_letter_queue").insert({
              raw_payload: {
                source: "autonomous-dlq-monitor",
                deprecated_url: activeUrl,
                fail_count_24h: failCount,
              } as any,
              source_ip: "cron",
              error_reason: "no_failover_available_manual_intervention_required",
            });
            summary.action = "alert_only";
            return Response.json(summary, { status: 200 });
          }

          // 5) Persist new config
          const updatedAt = new Date().toISOString();
          await supabaseAdmin.from("system_config").upsert([
            { key: "ACTIVE_GIS_URL", value: nextActive as any, updated_at: updatedAt },
            {
              key: "GIS_DEPRECATED_URLS",
              value: nextDeprecated as any,
              updated_at: updatedAt,
            },
          ]);

          summary.previous_url = activeUrl;
          summary.next_url = nextActive;
          return Response.json(summary, { status: 200 });
        } catch (e) {
          await supabaseAdmin.from("dead_letter_queue").insert({
            raw_payload: { source: "autonomous-dlq-monitor" } as any,
            source_ip: "cron",
            error_reason: `dlq_monitor_crash: ${(e as Error).message}`,
          });
          return Response.json(
            { ok: false, error: (e as Error).message },
            { status: 200 },
          );
        }
      },
    },
  },
});
