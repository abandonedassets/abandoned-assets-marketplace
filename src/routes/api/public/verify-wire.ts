// Public anti-phishing verification desk. A buyer's treasury team pastes the
// sealed link from the settlement message; the server re-derives the seal from
// live database state and confirms (or rejects) the routing integers.
import { createFileRoute } from "@tanstack/react-router";

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Unauthenticated external callers (treasury desks, webhook verifiers) must be
// able to hit this endpoint cross-origin without a redirect hop.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, accept, authorization",
  "Access-Control-Max-Age": "86400",
};

function page(body: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wire Verification — ReelEdge Acquisitions</title></head>
<body style="margin:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:620px;margin:40px auto;background:#fff;border:1px solid #d8dee9;border-radius:8px;overflow:hidden;">
<div style="background:#0b1220;padding:22px 24px;color:#fff;">
<div style="font-size:17px;font-weight:700;">ReelEdge Acquisitions</div>
<div style="font-size:11px;letter-spacing:.22em;color:#8ea3c0;margin-top:6px;">WIRE INTEGRITY VERIFICATION</div>
</div>
<div style="padding:24px;">${body}</div>
</div></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        ...CORS,
      },
    },
  );
}


async function handler({ request }: { request: Request }) {
  const url = new URL(request.url);
  let assetId = url.searchParams.get("asset_id") ?? "";
  let seal = url.searchParams.get("seal") ?? "";
  let wantsJson = (request.headers.get("accept") ?? "").includes("application/json");

  // External M2M verifiers POST JSON instead of using query params.
  if (request.method === "POST") {
    wantsJson = true;
    try {
      const body = (await request.json()) as { asset_id?: string; seal?: string } | null;
      assetId = body?.asset_id ?? assetId;
      seal = body?.seal ?? seal;
    } catch {
      /* query params remain authoritative */
    }
  }

  if (!assetId || !seal) {
    const out = { verified: false, reason: "missing_parameters" };
    return wantsJson
      ? Response.json(out, { status: 400, headers: CORS })
      : page(`<p style="color:#b91c1c;font-weight:700;">INVALID LINK</p><p>Missing verification parameters.</p>`, 400);
  }

  try {
    const { verifyWireSeal } = await import("@/lib/wire-seal.server");
    const result = await verifyWireSeal(assetId, seal);
    if (wantsJson)
      return Response.json(result, { headers: { "Cache-Control": "no-store", ...CORS } });


    if (!result.verified) {
      return page(
        `<p style="color:#b91c1c;font-weight:700;font-size:16px;">⚠ NOT VERIFIED — DO NOT WIRE</p>
<p>The routing details in the message you received do not match the live issuer record (${esc(result.reason)}). Treat that message as fraudulent and contact us before releasing any funds.</p>`,
        200,
      );
    }

    return page(
      `<p style="color:#047857;font-weight:700;font-size:16px;">✓ VERIFIED — ROUTING MATCHES LIVE ISSUER RECORD</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;">
<tr><td style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;">Beneficiary</td><td style="padding:8px 10px;border:1px solid #e2e8f0;">${esc(result.beneficiary ?? "—")}</td></tr>
<tr><td style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;">Bank</td><td style="padding:8px 10px;border:1px solid #e2e8f0;">${esc(result.bank_name ?? "—")}</td></tr>
<tr><td style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;">Routing Number</td><td style="padding:8px 10px;border:1px solid #e2e8f0;font-family:monospace;">${esc(result.routing_number)}</td></tr>
<tr><td style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;">Account (last 4)</td><td style="padding:8px 10px;border:1px solid #e2e8f0;font-family:monospace;">••••${esc(result.account_last4)}</td></tr>
</table>
<p style="font-size:12px;color:#64748b;margin-top:16px;">If any integer in your message differs from the values above, the message was intercepted. Do not release the wire.</p>`,
    );
  } catch (e) {
    console.error("[verify-wire] failed", e);
    return wantsJson
      ? Response.json(
          { verified: false, reason: "verification_unavailable" },
          { status: 500, headers: CORS },
        )
      : page(`<p style="color:#b91c1c;font-weight:700;">VERIFICATION UNAVAILABLE</p>`, 500);
  }
}

export const Route = createFileRoute("/api/public/verify-wire")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
    },
  },
});

