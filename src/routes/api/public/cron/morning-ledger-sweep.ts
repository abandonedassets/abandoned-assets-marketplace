// Daily morning sweep: reconciles the prior 24h of cleared database fees and
// issues a single Stripe payout to the linked Bluevine business checking account.
// Secured by a shared CRON_SECRET bearer token so only the scheduler can trigger it.
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

export const Route = createFileRoute("/api/public/cron/morning-ledger-sweep")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});

function authorized(request: Request): boolean {
  const secret = process.env["CRON_SECRET"];
  if (!secret) return false; // fail closed if the scheduler secret isn't configured
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const { morningLedgerSweep } = await import("@/lib/morning-ledger-sweep.server");
    const report = await morningLedgerSweep(24);
    return Response.json(report, { status: report.ok ? 200 : 503 });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
