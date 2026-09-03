// GET /api/public/v1/connect — public integration spec for algorithmic counterparties.
// No credentials required: this is the document a fund's dev desk reads.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/connect")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
        }),
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return Response.json(
          {
            protocol: "AA-M2M/1",
            model: "PULL — counterparties connect to us; we do not POST to fund webhooks.",
            endpoints: {
              tape_stream: { method: "GET", url: `${origin}/api/public/v1/tape/stream`, type: "text/event-stream" },
              execute: { method: "POST", url: `${origin}/api/public/v1/execute` },
              fix_gateway: { method: "POST", url: `${origin}/api/public/v1/fix`, dialect: "FIX 4.4" },
            },
            authentication: {
              scheme: "HMAC-SHA256 request signing (no static bearer tokens)",
              headers: ["X-M2M-Key-Id", "X-M2M-Timestamp", "X-M2M-Signature", "X-Client-Txn-Id"],
              canonical_string: "METHOD\\nPATH\\nTIMESTAMP\\nSHA256_HEX(body)",
              signature: "hex(HMAC_SHA256(canonical_string, shared_secret))",
              clock_skew_seconds: 300,
            },
            idempotency: {
              header: "X-Client-Txn-Id",
              required_on: ["POST /api/public/v1/execute", "POST /api/public/v1/fix (ClOrdID 11)"],
              behavior:
                "The first response for a txn id is persisted and replayed byte-identically. A retry can never double-execute or double-wire.",
              replay_marker: "X-Idempotent-Replay: true",
            },
            execute_payload: {
              deal_id: "uuid from the tape",
              max_assignment_fee: "optional limit-order guard; execution rejects above this",
              signature: "optional counterparty attestation string",
            },
            fix_mapping: {
              inbound: "35=D NewOrderSingle · 55=deal_id · 11=ClOrdID (idempotency) · 44=fee limit",
              outbound: "35=8 ExecutionReport · 150=F fill / 150=8 reject · 31=assignment fee",
              tape: "35=d SecurityDefinition per asset",
            },
            settlement: "Fedwire / ACH against the platform FBO. Wire instructions are returned on accepted execution.",
            uat: {
              note: "A sandbox enclave credential can be issued on request; it exercises the identical production code path and settles fractional ($0.01) amounts over the live banking rail.",
            },
          },
          {
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=300",
            },
          },
        );
      },
    },
  },
});
