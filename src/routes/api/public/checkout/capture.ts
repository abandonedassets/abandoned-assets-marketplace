// Capture leg: moves the held assignment fee into the LLC bank account once
// escrow/title confirms. HMAC-gated (M2M_HMAC_SECRET) and idempotent.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/checkout/capture")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["M2M_HMAC_SECRET"] ?? "";
        const provided = request.headers.get("x-capture-key") ?? "";
        if (!secret || provided !== secret) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        let body: any = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
        }
        const dealId = typeof body?.deal_id === "string" ? body.deal_id.trim() : "";
        if (!dealId) return Response.json({ ok: false, error: "deal_id_required" }, { status: 400 });

        try {
          const { captureAssignmentFee } = await import("@/lib/assignment-fee.server");
          const result = await captureAssignmentFee(dealId);
          return Response.json(result, {
            status: result.ok ? 200 : 402,
            headers: { "Cache-Control": "no-store" },
          });
        } catch (e) {
          console.error("[checkout/capture] failed", e);
          return Response.json(
            { ok: false, error: String((e as Error)?.message ?? e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
