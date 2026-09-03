// Phase 4 — State Settlement sink.
//
// The counterparty (or their escrow/title desk) posts back against a dispatched
// institutional packet. Real external values land here and ONLY here: the gate
// flips to RESOLVED because a real record arrived, never because the system
// assumed one. Nothing is synthesized, nothing waits on the operator.
//
// POST /api/public/hooks/packet-ack
// {
//   deal_id, packet_id, ack_signature,           // required, HMAC-verified
//   verified_counterparty_id?,                    // COUNTERPARTY gate
//   signed_contract_hash?,                        // CONTRACT gate
//   title_escrow_file_number?                     // TITLE_ESCROW gate
// }
//
// ack_signature = HMAC_SHA256(PACKET_SIGNING_KEY, `ack:${deal_id}:${packet_id}`)
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const Body = z.object({
  deal_id: z.string().uuid(),
  packet_id: z.string().min(4).max(64),
  ack_signature: z.string().min(32).max(128),
  verified_counterparty_id: z.string().min(2).max(128).optional(),
  signed_contract_hash: z.string().min(16).max(256).optional(),
  title_escrow_file_number: z.string().min(3).max(128).optional(),
});

function signingKey(): string {
  return (
    process.env["PACKET_SIGNING_KEY"] ||
    process.env["M2M_HMAC_SECRET"] ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    "reeledge-packet-dev-key"
  );
}

function verify(dealId: string, packetId: string, sig: string): boolean {
  const expected = createHmac("sha256", signingKey())
    .update(`ack:${dealId}:${packetId}`)
    .digest("hex");
  const a = Buffer.from(sig.toLowerCase());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/hooks/packet-ack")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
        }

        if (!verify(parsed.deal_id, parsed.packet_id, parsed.ack_signature)) {
          return Response.json({ ok: false, error: "bad_signature" }, { status: 401 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Real values only — an absent field leaves its gate blocked.
          const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
          const resolved: string[] = [];
          if (parsed.verified_counterparty_id) {
            patch["verified_counterparty_id"] = parsed.verified_counterparty_id;
            resolved.push("COUNTERPARTY");
          }
          if (parsed.signed_contract_hash) {
            patch["signed_contract_hash"] = parsed.signed_contract_hash;
            resolved.push("CONTRACT");
          }
          if (parsed.title_escrow_file_number) {
            patch["title_escrow_file_number"] = parsed.title_escrow_file_number;
            resolved.push("TITLE_ESCROW");
          }

          if (!resolved.length) {
            return Response.json({ ok: false, error: "no_verified_fields" }, { status: 400 });
          }

          const { error: upErr } = await supabaseAdmin
            .from("closing_pipeline_items")
            .update(patch as never)
            .eq("id", parsed.deal_id);
          if (upErr) throw upErr;

          const nowIso = new Date().toISOString();
          for (const gate of resolved) {
            await supabaseAdmin
              .from("gate_resolution_state" as never)
              .upsert(
                {
                  pipeline_item_id: parsed.deal_id,
                  gate,
                  state: "RESOLVED",
                  last_attempt_at: nowIso,
                  next_attempt_at: null,
                  last_detail: `external ack ${parsed.packet_id}`,
                  external_ref: parsed.packet_id,
                  updated_at: nowIso,
                } as never,
                { onConflict: "pipeline_item_id,gate" } as never,
              )
              .then(undefined, () => {});
          }

          await supabaseAdmin
            .from("system_audit_logs")
            .insert({
              pipeline_item_id: parsed.deal_id,
              event_type: "PACKET_ACK",
              reason: `Counterparty acknowledged packet ${parsed.packet_id}; gates resolved: ${resolved.join(", ")}`,
            } as never)
            .then(undefined, () => {});

          return Response.json({ ok: true, packet_id: parsed.packet_id, gates_resolved: resolved });
        } catch (e) {
          console.error("[packet-ack] failed", e);
          return Response.json({ ok: false, error: "error" }, { status: 500 });
        }
      },
    },
  },
});
