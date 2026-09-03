// Mock RTGS authorization rail (UAT only). Simulates a ~100ms clearing-network
// round trip and returns a fake clearing token. Never touches real money.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/internal/mock-bank/authorize")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const body = (await request.json().catch(() => ({}))) as Record<string, any>;

        // Tunable knobs so the crucible can drive the poison pill and 402 gate.
        const delay = Math.max(
          0,
          Math.min(5000, Number(url.searchParams.get("delay_ms") ?? body["delay_ms"] ?? 100)),
        );
        const forceFail =
          url.searchParams.get("fail") === "1" || body["force_fail"] === true;

        await new Promise((r) => setTimeout(r, delay));

        if (forceFail)
          return Response.json(
            { authorized: false, error: "mock_insufficient_funds" },
            { status: 402 },
          );

        const { randomBytes } = await import("crypto");
        return Response.json({
          authorized: true,
          mock: true,
          network: String(body["network"] ?? "FEDNOW"),
          reference: String(body["reference"] ?? ""),
          amount: Number(body["amount"] ?? 0),
          clearing_token: `mock_clr_${randomBytes(10).toString("hex")}`,
          authorized_in_ms: delay,
        });
      },
    },
  },
});
