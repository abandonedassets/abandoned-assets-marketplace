// Zero-click allocation sweep. Cron-callable; matches dispatchable assets to
// standing capital and auto-issues the binding assignment agreement.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/auto-allocate")({
  server: {
    handlers: {
      GET: async () => run(50),
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { limit?: number };
        return run(Math.min(Math.max(Number(body?.limit) || 50, 1), 200));
      },
    },
  },
});

async function run(limit: number) {
  try {
    const { runAutoAllocation } = await import("@/lib/auto-allocate.server");
    const report = await runAutoAllocation(limit);
    return Response.json({ ...report, at: new Date().toISOString() });
  } catch (e) {
    console.error("[auto-allocate] hook failed", e);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
  }
}
