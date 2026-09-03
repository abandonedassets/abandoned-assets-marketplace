// Plaid Transfer status webhook — keeps plaid_transfers in sync with the rail.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/plaid-webhook")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, rail: "plaid_ach" }),
      POST: async ({ request }) => {
        try {
          const body: any = await request.json().catch(() => ({}));
          if (body?.webhook_type !== "TRANSFER") {
            return Response.json({ ok: true, ignored: body?.webhook_type ?? "unknown" });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // --- Replay protection: reject payloads older than 300s ---
          const tsRaw =
            request.headers.get("plaid-verification-timestamp") ??
            body?.timestamp ??
            body?.environment_timestamp ??
            null;
          if (tsRaw) {
            const ts = Number.isFinite(Number(tsRaw))
              ? Number(tsRaw) * (String(tsRaw).length <= 10 ? 1000 : 1)
              : Date.parse(String(tsRaw));
            if (Number.isFinite(ts) && Math.abs(Date.now() - ts) > 300_000) {
              return new Response("stale webhook", { status: 401 });
            }
          }

          // --- Reentrancy guard: unique event id claim makes double-processing impossible ---
          const eventId = String(
            body?.webhook_id ?? body?.transfer_id ?? `${body?.webhook_code}:${tsRaw ?? ""}`,
          );
          if (eventId) {
            const { error: dupErr } = await supabaseAdmin
              .from("webhook_replay_guard")
              .insert({ event_id: eventId, source: "plaid" } as never);
            if (dupErr) return Response.json({ ok: true, deduped: true });
          }

          const { plaidCall, getLinkedItem } = await import("@/lib/plaid.server");
          const item = await getLinkedItem();
          if (!item) return Response.json({ ok: true, skipped: "not_linked" });

          const evts = await plaidCall("/transfer/event/sync", {
            after_id: Number(body?.after_id ?? 0),
            count: 25,
          });

          let updated = 0;
          for (const e of (evts.json?.transfer_events ?? []) as any[]) {
            try {
              await supabaseAdmin
                .from("plaid_transfers" as any)
                .update({
                  status: String(e.event_type ?? "pending"),
                  failure_reason: e.failure_reason?.description ?? null,
                  updated_at: new Date().toISOString(),
                } as never)
                .eq("transfer_id", String(e.transfer_id));
              updated += 1;
            } catch {
              /* fail-forward */
            }
          }
          return Response.json({ ok: true, updated });
        } catch (e) {
          console.error("[plaid-webhook] failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
