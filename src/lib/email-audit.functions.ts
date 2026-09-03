// Live email dispatch telemetry (admin-only).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EmailAuditRow = {
  id: string;
  recipient_email: string | null;
  apn: string | null;
  contract_id: string | null;
  status: string;
  created_at: string;
};

export type EmailAudit = {
  rows: EmailAuditRow[];
  totals: {
    sent: number;
    opened: number;
    clicked: number;
    bounced: number;
    openRate: number;
    clickRate: number;
    bounceRate: number;
  };
  guardrails: { lastHour: number; hourlyCap: number; cooldownHours: number };
};

export const getEmailAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EmailAudit> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: logs } = await supabaseAdmin
      .from("offer_delivery_logs")
      .select("id, recipient_email, contract_id, status, created_at")
      // Synthetic/seeded telemetry never counts as a verified external delivery.
      .not("meta->synthetic", "eq", true)
      .order("created_at", { ascending: false })
      .limit(500);

    const list = (logs ?? []) as Array<{
      id: string;
      recipient_email: string | null;
      contract_id: string | null;
      status: string;
      created_at: string;
    }>;

    // Resolve APNs for referenced contracts.
    const ids = Array.from(new Set(list.map((r) => r.contract_id).filter(Boolean))) as string[];
    const apnMap = new Map<string, string | null>();
    if (ids.length) {
      const { data: assets } = await supabaseAdmin
        .from("closing_pipeline_items")
        .select("id, apn, external_id, zip")
        .in("id", ids.slice(0, 500));
      for (const a of (assets ?? []) as any[]) {
        apnMap.set(a.id, a.apn ?? a.external_id ?? a.zip ?? null);
      }
    }

    const rows: EmailAuditRow[] = list.map((r) => ({
      id: r.id,
      recipient_email: r.recipient_email,
      contract_id: r.contract_id,
      apn: r.contract_id ? (apnMap.get(r.contract_id) ?? null) : null,
      status: r.status,
      created_at: r.created_at,
    }));

    const count = (s: string[]) => rows.filter((r) => s.includes(r.status)).length;
    const sent = count(["DISPATCHED", "DELIVERED"]);
    const opened = count(["OPENED"]);
    const clicked = count(["CLICKED"]);
    const bounced = count(["BOUNCED", "FAILED"]);
    const pct = (n: number) => (sent > 0 ? Math.round((n / sent) * 1000) / 10 : 0);

    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count: lastHour } = await supabaseAdmin
      .from("dispatch_dedupe" as never)
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);

    return {
      rows,
      totals: {
        sent,
        opened,
        clicked,
        bounced,
        openRate: pct(opened),
        clickRate: pct(clicked),
        bounceRate: pct(bounced),
      },
      guardrails: { lastHour: lastHour ?? 0, hourlyCap: 25, cooldownHours: 24 },
    };
  });
