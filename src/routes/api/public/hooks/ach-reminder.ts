// Cron entry: nudge buyers with unverified ACH mandates.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/ach-reminder")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run ACH reminder sweep" }),
      POST: async () => {
        try {
          const { sweepAchReminders } = await import("@/lib/ach-reminder.server");
          const report = await sweepAchReminders(50);
          return Response.json({ ok: true, report, at: new Date().toISOString() });
        } catch (e) {
          console.error("[ach-reminder] failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
