// Mock RTGS drawdown rail (UAT only). Simulates the fiat pull and returns a
// synthetic provider reference. Idempotent on the caller's Idempotency-Key.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/internal/mock-bank/drawdown")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const body = (await request.json().catch(() => ({}))) as Record<string, any>;
        const delay = Math.max(
          0,
          Math.min(5000, Number(url.searchParams.get("delay_ms") ?? body["delay_ms"] ?? 100)),
        );
        await new Promise((r) => setTimeout(r, delay));
        if (url.searchParams.get("fail") === "1")
          return Response.json({ ok: false, error: "mock_rail_down" }, { status: 503 });

        const key = request.headers.get("idempotency-key") ?? "";
        const { createHash } = await import("crypto");
        return Response.json({
          ok: true,
          mock: true,
          id: `mock_rtgs_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`,
          amount_usd: Number(body["amount_usd"] ?? 0),
          settled_in_ms: delay,
          rail: String(body["network"] ?? "FEDNOW"),
        });
      },
    },
  },
});
