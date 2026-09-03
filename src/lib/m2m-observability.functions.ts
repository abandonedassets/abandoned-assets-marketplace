import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NodeHealthRow = {
  box_id: string;
  label: string | null;
  webhook_url: string | null;
  host: string;
  reachable: boolean;
  last_status: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  total_attempts: number;
  total_accepts: number;
};

export type InboundProbe = {
  id: string;
  received_at: string;
  endpoint: string;
  method: string;
  ip: string | null;
  user_agent: string | null;
  api_key_prefix: string | null;
  authorized: boolean;
  box_label: string | null;
  http_status: number | null;
  latency_ms: number | null;
  body_preview: string | null;
  headers: Record<string, string> | null;
};

function hostOf(url: string | null): string {
  if (!url) return "—";
  try {
    return new URL(url).host;
  } catch {
    return "invalid_url";
  }
}

/** Active algo connections + node latency/reachability. */
export const getM2MNodeHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ nodes: NodeHealthRow[]; configured: number; reachable: number }> => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: boxes }, { data: health }] = await Promise.all([
      supabaseAdmin
        .from("buyer_buy_boxes")
        .select("id,label,webhook_url,execution_mode,active")
        .eq("active", true)
        .eq("execution_mode", "M2M"),
      supabaseAdmin.from("m2m_node_health").select("*"),
    ]);

    const byId = new Map<string, any>();
    for (const h of (health ?? []) as any[]) byId.set(h.box_id, h);

    const nodes: NodeHealthRow[] = ((boxes ?? []) as any[]).map((b) => {
      const h = byId.get(b.id) ?? {};
      return {
        box_id: b.id,
        label: b.label ?? null,
        webhook_url: b.webhook_url ?? null,
        host: hostOf(b.webhook_url ?? null),
        reachable: Boolean(h.reachable),
        last_status: h.last_status ?? null,
        last_latency_ms: h.last_latency_ms ?? null,
        last_error: h.last_error ?? null,
        last_attempt_at: h.last_attempt_at ?? null,
        last_success_at: h.last_success_at ?? null,
        consecutive_failures: Number(h.consecutive_failures ?? 0),
        total_attempts: Number(h.total_attempts ?? 0),
        total_accepts: Number(h.total_accepts ?? 0),
      };
    });

    nodes.sort((a, b) => Number(b.reachable) - Number(a.reachable) || (a.label ?? "").localeCompare(b.label ?? ""));

    return {
      nodes,
      configured: nodes.length,
      reachable: nodes.filter((n) => n.reachable).length,
    };
  });

/** Raw inbound probe log for the developer drawer. */
export const getInboundProbes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InboundProbe[]> => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data } = await supabaseAdmin
      .from("m2m_inbound_log")
      .select("*")
      .order("received_at", { ascending: false })
      .limit(50);

    return ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      received_at: r.received_at,
      endpoint: r.endpoint,
      method: r.method,
      ip: r.ip ?? null,
      user_agent: r.user_agent ?? null,
      api_key_prefix: r.api_key_prefix ?? null,
      authorized: Boolean(r.authorized),
      box_label: r.box_label ?? null,
      http_status: r.http_status ?? null,
      latency_ms: r.latency_ms ?? null,
      body_preview: r.body_preview ?? null,
      headers: (r.headers ?? null) as Record<string, string> | null,
    }));
  });
