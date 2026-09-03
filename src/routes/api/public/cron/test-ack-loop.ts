// Internal end-to-end integration probe for the settlement ACK pipeline.
//
// GET/POST /api/public/cron/test-ack-loop[?deal_id=...&dry=1]
// 1. Picks one asset sitting in Webhook_Dispatched (or the supplied deal_id).
// 2. Mints a valid HMAC-signed ACK payload with dummy real-world values.
// 3. POSTs it to /api/public/hooks/packet-ack (true loopback, real HTTP).
// 4. Re-reads the row and reports whether the BLOCKED badge would clear.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, randomUUID } from "crypto";

export const Route = createFileRoute("/api/public/cron/test-ack-loop")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});

function signingKey(): string {
  return (
    process.env["PACKET_SIGNING_KEY"] ||
    process.env["M2M_HMAC_SECRET"] ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    "reeledge-packet-dev-key"
  );
}

async function run(request: Request) {
  const started = Date.now();
  try {
    const url = new URL(request.url);
    const forced = url.searchParams.get("deal_id");
    const dry = url.searchParams.get("dry") === "1";

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cols =
      "id,address,city,state,zip,status,signed_contract_hash,verified_counterparty_id,title_escrow_file_number,optimized_acquisition_premium";

    let deal: Record<string, any> | null = null;
    if (forced) {
      const { data } = await supabaseAdmin
        .from("closing_pipeline_items")
        .select(cols)
        .eq("id", forced)
        .maybeSingle();
      deal = (data ?? null) as any;
    } else {
      const { data } = await supabaseAdmin
        .from("closing_pipeline_items")
        .select(cols)
        .eq("status", "Webhook_Dispatched")
        .is("cleared_at", null)
        .is("verified_counterparty_id", null)
        .order("optimized_acquisition_premium", { ascending: false })
        .limit(1);
      deal = ((data ?? [])[0] ?? null) as any;
    }

    if (!deal) {
      return Response.json(
        { ok: false, error: "no_dispatched_asset_available", latency_ms: Date.now() - started },
        { status: 200 },
      );
    }

    const packetId = `TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
    const payload = {
      deal_id: deal["id"],
      packet_id: packetId,
      ack_signature: createHmac("sha256", signingKey())
        .update(`ack:${deal["id"]}:${packetId}`)
        .digest("hex"),
      verified_counterparty_id: `TEST-CPTY-${randomUUID().slice(0, 8).toUpperCase()}`,
      signed_contract_hash: createHmac("sha256", signingKey())
        .update(`contract:${deal["id"]}:${packetId}`)
        .digest("hex"),
      title_escrow_file_number: `TEST-ESC-${Date.now().toString(36).toUpperCase()}`,
    };

    if (dry) {
      return Response.json({ ok: true, dry_run: true, deal_id: deal["id"], payload });
    }

    const target = new URL("/api/public/hooks/packet-ack", url.origin).toString();
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const ackBody = await res.json().catch(() => ({}) as any);

    const { data: after } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(cols)
      .eq("id", deal["id"])
      .maybeSingle();

    const { settlementBinding } = await import("@/lib/settlement-binding");
    const binding = settlementBinding((after ?? {}) as never);

    if (!binding.bound) {
      return Response.json(
        {
          ok: false,
          stage: res.ok ? "binding_gate" : "packet_ack_rejected",
          rejected_by: res.ok
            ? "src/lib/settlement-binding.ts:37-40 (settlementBinding blockers)"
            : "src/routes/api/public/hooks/packet-ack.ts:59-84 (signature/field validation)",
          ack_http_status: res.status,
          ack_response: ackBody,
          blockers: binding.blockers,
          row: after,
          latency_ms: Date.now() - started,
        },
        { status: 200 },
      );
    }

    return Response.json({
      ok: true,
      deal_id: deal["id"],
      packet_id: packetId,
      ack_http_status: res.status,
      ack_response: ackBody,
      state: binding.state,
      row: after,
      latency_ms: Date.now() - started,
    });
  } catch (e) {
    console.error("[test-ack-loop] failed", e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
