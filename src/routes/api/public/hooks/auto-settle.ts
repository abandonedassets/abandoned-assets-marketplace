// Background state-runner for DUE assets. Runs on pg_cron; honors the
// auto_settle_enabled flag so the terminal toggle controls autopilot.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/auto-settle")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run the DUE auto-settle sweep" }),
      POST: async ({ request }) => {
        try {
          const { isAutoSettleEnabled, runAutoSettleSweep } = await import(
            "@/lib/auto-settle.server"
          );
          const { claimIdempotencyKey } = await import("@/lib/m2m-protocol.server");

          const idem = request.headers.get("x-idempotency-key");
          const claim = await claimIdempotencyKey(idem, "auto-settle");
          if (!claim.fresh) {
            return Response.json({ ok: true, skipped: "duplicate_idempotency_key", key: idem });
          }

          let force = false;
          try {
            const body = (await request.json()) as { force?: boolean } | null;
            force = Boolean(body?.force);
          } catch {
            /* empty body is fine */
          }
          if (!force && !(await isAutoSettleEnabled())) {
            return Response.json({ ok: true, skipped: "auto_settle_disabled" });
          }
          const report = await runAutoSettleSweep(200, { bypassWindow: force });

          // Push minted FBO routing/account strings to partner endpoints.
          let wire_sync: unknown = null;
          try {
            const { syncWireInstructions } = await import("@/lib/auto-settle.server");
            wire_sync = await syncWireInstructions(100);
          } catch (e) {
            console.error("[auto-settle] wire instruction sync failed", e);
          }

          return Response.json({ ...report, wire_sync, at: new Date().toISOString() });

        } catch (e) {
          console.error("[auto-settle] sweep failed", e);
          const { notifyAdmin } = await import("@/lib/notify.server");
          await notifyAdmin(`🚨 CRITICAL: auto-settle sweep failed — ${e instanceof Error ? e.message : String(e)}`, true);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
