// Live bridge diagnostics — red/amber/green health map for the admin header.
// No PII, no secret values: presence booleans only.
import { createFileRoute } from "@tanstack/react-router";

type Bridge = {
  key: string;
  label: string;
  status: "GREEN" | "AMBER" | "RED";
  detail: string;
};

function envBridge(key: string, label: string, critical = true): Bridge {
  const present = Boolean((process.env[key] ?? "").trim());
  return {
    key,
    label,
    status: present ? "GREEN" : critical ? "RED" : "AMBER",
    detail: present ? "credential_present" : "credential_missing",
  };
}

async function run() {
  const bridges: Bridge[] = [
    envBridge("RESEND_API_KEY", "Outbound Email"),
    envBridge("STRIPE_SECRET_KEY", "Capital Capture"),
    envBridge("STRIPE_WEBHOOK_SECRET", "Stripe Webhook Verify"),
    envBridge("TITLE_API_KEY", "Title / Escrow Injection"),
    envBridge("TITLE_API_URL", "Title Endpoint", false),
    envBridge("ESIGN_WEBHOOK_SECRET", "E-Sign Webhook Verify"),
    envBridge("RESEND_WEBHOOK_SECRET", "Delivery Kill-Switch", false),
    envBridge("PUBLIC_SITE_URL", "Public Link Base", false),
  ];

  const db: Record<string, number | null> = {
    live_buy_boxes: null,
    active_webhooks: null,
    dispatch_24h: null,
    rejected_24h: null,
    null_reason_codes: null,
  };

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const count = async (q: any) => {
      const { count: c } = await q;
      return typeof c === "number" ? c : null;
    };
    // Hard-fail on synthetic demand: only real, non-self, deliverable
    // counterparties count as live supply.
    const { isSyntheticContact } = await import("@/lib/endpoint-verify.server");
    const { data: boxRows } = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select("contact_email")
      .eq("active", true)
      .not("contact_email", "is", null)
      .limit(500);
    db.live_buy_boxes = ((boxRows ?? []) as any[]).filter(
      (b) => !isSyntheticContact(b.contact_email),
    ).length;

    db.active_webhooks = await count(
      supabaseAdmin
        .from("institutional_webhooks")
        .select("id", { count: "exact", head: true })
        .in("status", ["ACTIVE", "HEALTHY"]),
    );

    db.dispatch_24h = await count(
      supabaseAdmin
        .from("offer_delivery_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
    );
    db.rejected_24h = await count(
      supabaseAdmin
        .from("offer_delivery_logs")
        .select("id", { count: "exact", head: true })
        .eq("status", "REJECTED")
        .gte("created_at", since),
    );
    db.null_reason_codes = await count(
      supabaseAdmin
        .from("offer_delivery_logs")
        .select("id", { count: "exact", head: true })
        .eq("status", "REJECTED")
        .is("reason_code", null),
    );
  } catch (e) {
    bridges.push({
      key: "DATABASE",
      label: "Database",
      status: "RED",
      detail: e instanceof Error ? e.message : "db_unreachable",
    });
  }

  try {
    const { warmupCapToday } = await import("@/lib/dispatch-gmail.server");
    const w = await warmupCapToday();
    db.warmup_day = w.day;
    db.warmup_cap = w.cap;
    db.warmup_sent_24h = w.sent;
    bridges.push({
      key: "WARMUP",
      label: "Domain Warm-Up",
      status: w.sent >= w.cap ? "AMBER" : "GREEN",
      detail: `day ${w.day}: ${w.sent}/${w.cap} sends in 24h`,
    });
  } catch {
    /* fail-forward */
  }

  if ((db.live_buy_boxes ?? 0) < 5) {
    bridges.push({
      key: "BUYER_SUPPLY",
      label: "Buyer Supply",
      status: (db.live_buy_boxes ?? 0) === 0 ? "RED" : "AMBER",
      detail: `${db.live_buy_boxes ?? 0} live buy boxes`,
    });
  }
  if ((db.active_webhooks ?? 0) === 0) {
    bridges.push({
      key: "M2M_FANOUT",
      label: "M2M Fan-Out",
      status: "RED",
      detail: "no active institutional endpoints",
    });
  }

  const worst = bridges.some((b) => b.status === "RED")
    ? "RED"
    : bridges.some((b) => b.status === "AMBER")
      ? "AMBER"
      : "GREEN";

  return Response.json(
    { ok: true, status: worst, bridges, db, at: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/public/preflight")({
  server: {
    handlers: {
      GET: async () => run(),
      POST: async () => run(),
    },
  },
});
