import { createFileRoute } from "@tanstack/react-router";

/**
 * Auto-Bundler cron endpoint (calm cadence).
 * Groups unbundled active deals by ZIP3 region, min 2 deals/bundle.
 * Fail-forward: never throws to caller.
 */
const ACTIVE_STATUSES = [
  "New",
  "Under-Review",
  "Seller-Signed",
  "Buyer-Signed",
  "In-Escrow",
] as const;

export const Route = createFileRoute("/api/public/hooks/auto-bundle")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const { data: deals } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select("id, zip")
            .is("bundle_id", null)
            .eq("is_held", false)
            .in("status", [...ACTIVE_STATUSES]);

          if (!deals?.length) {
            return Response.json({ ok: true, created: 0, assigned: 0 });
          }

          const groups = new Map<string, string[]>();
          for (const d of deals) {
            const zip3 = (d.zip ?? "").slice(0, 3) || "000";
            if (!groups.has(zip3)) groups.set(zip3, []);
            groups.get(zip3)!.push(d.id);
          }

          let created = 0;
          let assigned = 0;
          for (const [zip3, ids] of groups) {
            if (ids.length < 2) continue;
            const { data: bundle } = await supabaseAdmin
              .from("bundles")
              .insert({
                name: `Region ${zip3}xx SFR Bundle`,
                region_tag: zip3,
                status: "active",
              })
              .select("id")
              .single();
            if (!bundle) continue;
            created++;
            const { error: uErr } = await supabaseAdmin
              .from("closing_pipeline_items")
              .update({ bundle_id: bundle.id })
              .in("id", ids);
            if (!uErr) assigned += ids.length;
          }
          return Response.json({ ok: true, created, assigned });
        } catch (e) {
          console.error("auto-bundle error", e);
          return Response.json({ ok: false }, { status: 200 });
        }
      },
    },
  },
});
