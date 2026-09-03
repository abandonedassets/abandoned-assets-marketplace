// Remote Online Notarization completion webhook (Proof.com / Notarize style).
// HMAC-verified. On notarization.completed we stamp the deal, dispatch the
// flash bridge to the seller, and release the wire payload.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const REPLAY_WINDOW_MS = 5 * 60 * 1000;


const Body = z.object({
  event: z.string().max(120),
  deal_id: z.string().uuid(),
  notarization_id: z.string().max(200).optional(),
});

export const Route = createFileRoute("/api/public/hooks/notary-completed")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, hint: "POST notarization.completed with x-notary-signature" }),
      POST: async ({ request }) => {
        try {
          const raw = await request.text();
          const secret = process.env["NOTARY_WEBHOOK_SECRET"];
          if (secret) {
            // Replay window: signature must cover a timestamp <= 5 minutes old.
            const tsHeader = request.headers.get("x-notary-timestamp") ?? "";
            const tsNum = Number(tsHeader);
            const tsMs = tsHeader.length > 10 && tsNum > 1e12 ? tsNum : tsNum * 1000;
            if (!tsHeader || !Number.isFinite(tsNum) || Math.abs(Date.now() - tsMs) > REPLAY_WINDOW_MS) {
              return new Response("Stale or missing timestamp", { status: 401 });
            }

            const sig = request.headers.get("x-notary-signature") ?? "";
            const expected = createHmac("sha256", secret).update(`${tsHeader}.${raw}`).digest("hex");
            const a = Buffer.from(sig);
            const b = Buffer.from(expected);
            if (a.length !== b.length || !timingSafeEqual(a, b)) {
              return new Response("Invalid signature", { status: 401 });
            }
          }

          const parsed = Body.safeParse(JSON.parse(raw || "{}"));
          if (!parsed.success) return Response.json({ ok: false, error: "invalid_payload" }, { status: 400 });
          const { event, deal_id, notarization_id } = parsed.data;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Idempotency: one payout per notary event id. Duplicate = hard reject.
          const eventId =
            request.headers.get("x-notary-event-id") ??
            notarization_id ??
            createHmac("sha256", "notary").update(raw).digest("hex");
          const { error: guardErr } = await supabaseAdmin
            .from("webhook_replay_guard")
            .insert({ event_id: `notary:${eventId}`, source: "notary-completed" } as never);
          if (guardErr) {
            if (String(guardErr.code) === "23505") {
              return Response.json({ ok: true, skipped: "duplicate_event", event_id: eventId });
            }
            return Response.json({ ok: false, error: "replay_guard_failed" }, { status: 200 });
          }

          const completed = event.toLowerCase().includes("completed");

          await supabaseAdmin
            .from("closing_pipeline_items")
            .update({
              notary_status: completed ? "COMPLETED" : event.toUpperCase(),
              notary_ref: notarization_id ?? null,
              ...(completed ? { notary_completed_at: new Date().toISOString() } : {}),
            } as never)
            .eq("id", deal_id);

          if (!completed) return Response.json({ ok: true, deal_id, notary_status: event });

          // Ensure algorithmic title authorization is current, then bridge.
          const { underwriteTitle, flashBridge } = await import("@/lib/forced-settlement.server");
          const title = await underwriteTitle(deal_id);
          const bridge = await flashBridge(deal_id);

          return Response.json({ ok: true, deal_id, title, bridge });
        } catch (e) {
          console.error("[notary-completed] failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
