// GET /api/public/v1/proof — Proof-of-Escrow state channel snapshot.
// Returns an HMAC-signed, time-boxed attestation of platform clearing
// balances so a counterparty can verify collateralization in code instead of
// trusting a dashboard figure.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/proof")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { M2M_CORS } = await import("@/lib/m2m-hmac.server");
        return new Response(null, { status: 204, headers: M2M_CORS });
      },
      GET: async ({ request }) => {
        const { verifySignedRequest, M2M_CORS } = await import("@/lib/m2m-hmac.server");
        const v = await verifySignedRequest(request);
        if (!v.ok)
          return Response.json(
            { ok: false, error: v.error, detail: v.detail ?? null },
            { status: v.status, headers: M2M_CORS },
          );

        const url = new URL(request.url);
        const dealId = url.searchParams.get("deal_id") ?? undefined;
        const notional = Number(url.searchParams.get("notional") ?? "");

        const { buildEscrowProof } = await import("@/lib/escrow-proof.server");
        const proof = await buildEscrowProof({
          ...(dealId ? { dealId } : {}),
          ...(Number.isFinite(notional) && notional > 0 ? { dealNotional: notional } : {}),
        });

        return Response.json(
          {
            ok: true,
            proof,
            verification: {
              canonical:
                "VERSION|issued_at|expires_at|nonce|cleared|pending_wire|escrow_locked|available|open_positions|deal_id|deal_notional",
              algorithm: "HMAC-SHA256 over the canonical string, hex encoded",
              key_id: proof.key_id,
              ttl_seconds: proof.expires_at - proof.issued_at,
            },
          },
          { headers: { ...M2M_CORS, "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
