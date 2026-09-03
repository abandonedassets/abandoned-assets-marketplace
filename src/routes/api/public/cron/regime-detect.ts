// POST /api/public/cron/regime-detect — macro regime switch detector.
// Zero-key: US Treasury fiscaldata average interest rates. Two-state Gaussian
// classification (level + volatility) → recalibrates buy-box yield hurdles.
import { createFileRoute } from "@tanstack/react-router";

const FEED =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?filter=security_desc:eq:Treasury%20Notes&sort=-record_date&page[size]=24";

function classify(series: number[]) {
  const n = series.length;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  const vol = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const recent = series.slice(0, Math.min(3, n));
  const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const z = vol > 0 ? (recentMean - mean) / vol : 0;

  if (z > 0.75 || recentMean > mean + 0.4)
    return { regime: "SQUEEZE" as const, cap_rate_uplift_bps: Math.round(Math.min(150, 50 + z * 50)) };
  if (z < -0.75) return { regime: "EXPANSION" as const, cap_rate_uplift_bps: -50 };
  return { regime: "NEUTRAL" as const, cap_rate_uplift_bps: 0 };
}

export const Route = createFileRoute("/api/public/cron/regime-detect")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run regime detection" }),
      POST: async () => {
        try {
          let series: number[] = [];
          try {
            const res = await fetch(FEED, { headers: { accept: "application/json" } });
            const json = (await res.json()) as { data?: { avg_interest_rate_amt: string }[] };
            series = (json.data ?? [])
              .map((d) => Number(d.avg_interest_rate_amt))
              .filter((n) => Number.isFinite(n));
          } catch (e) {
            console.error("[regime] feed failed", (e as Error).message);
          }
          if (series.length < 6)
            return Response.json({ ok: true, skipped: "insufficient_macro_data" });

          const detected = classify(series);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("system_config").upsert(
            {
              key: "market_regime",
              value: { ...detected, detected_at: new Date().toISOString() } as never,
            } as never,
            { onConflict: "key" },
          );

          // Recalibrate bound funds' yield hurdle to the new regime.
          const uplift = detected.cap_rate_uplift_bps / 10000;
          const { data: boxes } = await supabaseAdmin
            .from("institutional_buy_boxes")
            .select("id, min_cap_rate")
            .eq("is_active", true);
          for (const b of (boxes ?? []) as { id: string; min_cap_rate: number }[]) {
            try {
              const base = 0.06;
              const next = Math.max(0.02, Number((base + uplift).toFixed(4)));
              if (next !== Number(b.min_cap_rate)) {
                await supabaseAdmin
                  .from("institutional_buy_boxes")
                  .update({ min_cap_rate: next } as never)
                  .eq("id", b.id);
              }
            } catch {
              /* fail-forward */
            }
          }

          return Response.json({ ok: true, ...detected, samples: series.length });
        } catch (e) {
          console.error("[regime] unhandled", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
        }
      },
    },
  },
});
