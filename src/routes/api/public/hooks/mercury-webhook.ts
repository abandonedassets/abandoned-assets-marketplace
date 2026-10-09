import { createFileRoute } from "@tanstack/react-router";

// Mercury webhook relay.
// Preserves the exact raw request body and Mercury-Signature header so the
// Supabase listener remains the sole signature-verification and staging gate.
// This route never parses events, writes records, or initiates financial actions.

const SUPABASE_LISTENER =
  "https://midneoocykeoquxkjkrg.supabase.co/functions/v1/mercury-webhook-listener";

export const Route = createFileRoute("/api/public/hooks/mercury-webhook")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          { ok: true, service: "mercury-webhook-relay", forwardsTo: "supabase-listener" },
          { headers: { "Cache-Control": "no-store" } },
        ),
      POST: async ({ request }) => {
        let rawBody: ArrayBuffer;
        try {
          // Preserve original bytes; Mercury signatures cover the raw body.
          rawBody = await request.arrayBuffer();
        } catch {
          return Response.json({ ok: false, error: "request_body_unreadable" }, { status: 400 });
        }

        const headers = new Headers();
        const contentType = request.headers.get("content-type");
        const signature = request.headers.get("Mercury-Signature");
        if (contentType) headers.set("content-type", contentType);
        if (signature) headers.set("Mercury-Signature", signature);

        try {
          const upstream = await fetch(SUPABASE_LISTENER, {
            method: "POST",
            headers,
            body: rawBody,
            cache: "no-store",
            signal: AbortSignal.timeout(4500),
          });

          // Pass through the listener's status; never acknowledge an event that
          // Supabase rejected or failed to persist.
          return new Response(upstream.body, {
            status: upstream.status,
            headers: {
              "content-type": upstream.headers.get("content-type") ?? "text/plain; charset=utf-8",
              "cache-control": "no-store",
            },
          });
        } catch {
          // A 5xx invites Mercury to retry; no payload or secret is logged.
          return Response.json({ ok: false, error: "supabase_listener_unreachable" }, { status: 502 });
        }
      },
    },
  },
});
