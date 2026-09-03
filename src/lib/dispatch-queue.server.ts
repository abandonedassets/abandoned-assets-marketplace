// Staggered outbound dispatch queue.
// Two guarantees:
//   1. Idempotency — dedupe_key (asset + channel + target) is UNIQUE; a
//      colliding enqueue from a concurrent sweep is silently dropped.
//   2. Jitter — each queued send gets a randomized 30-120s offset so a batch
//      of buyers is never blasted in the same server second.
// Fail-forward: nothing here throws into the pipeline.

const JITTER_MIN_S = 30;
const JITTER_MAX_S = 120;
const MAX_PER_CYCLE = 8;
const MAX_ATTEMPTS = 3;

function jitterSeconds(index: number): number {
  const span = JITTER_MAX_S - JITTER_MIN_S;
  return index * JITTER_MIN_S + JITTER_MIN_S + Math.floor(Math.random() * span);
}

export type QueuedDispatch = {
  dealId: string;
  target: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
  /** Position in the batch — drives the staggered not_before. */
  index?: number;
};

/** Enqueue one outbound email. Duplicates are dropped silently. Returns true when newly queued. */
export async function enqueueDispatch(d: QueuedDispatch): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const target = d.target.trim().toLowerCase();
    const dedupe = `${d.dealId}:email:${target}`;
    const notBefore = new Date(Date.now() + jitterSeconds(d.index ?? 0) * 1000).toISOString();

    const { error } = await supabaseAdmin.from("outbound_dispatch_queue" as never).insert({
      dedupe_key: dedupe,
      pipeline_item_id: d.dealId,
      channel: "email",
      target,
      subject: d.subject,
      html: d.html,
      headers: (d.headers ?? {}) as never,
      not_before: notBefore,
    } as never);

    if (error) {
      // 23505 = duplicate dedupe_key → already dispatched/queued. Silent drop.
      if ((error as { code?: string }).code === "23505") return false;
      console.error("[dispatch-queue] enqueue failed", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[dispatch-queue] enqueue error", (e as Error).message);
    return false;
  }
}

/** Drain due rows, one at a time, bounded per cycle. Never throws. */
export async function runDispatchQueue(
  limit = MAX_PER_CYCLE,
): Promise<{ sent: number; failed: number; due: number }> {
  const out = { sent: 0, failed: 0, due: 0 };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("outbound_dispatch_queue" as never)
      .select("*")
      .eq("status", "queued")
      .lte("not_before", new Date().toISOString())
      .order("not_before", { ascending: true })
      .limit(limit);

    const rows = (data ?? []) as any[];
    out.due = rows.length;
    if (!rows.length) return out;

    const { sendM2MEmail } = await import("@/lib/email.server");

    for (const r of rows) {
      // Single-flight claim: only the runner that flips queued→sending sends.
      const { data: claimed } = await supabaseAdmin
        .from("outbound_dispatch_queue" as never)
        .update({ status: "sending", attempts: (r.attempts ?? 0) + 1 } as never)
        .eq("id", r.id)
        .eq("status", "queued")
        .select("id");
      if (!((claimed ?? []) as any[]).length) continue;

      try {
        const res = await sendM2MEmail({
          to: r.target,
          subject: r.subject ?? "Off-market asset",
          html: r.html ?? "",
          headers: (r.headers ?? {}) as never,
        });
        if (res.ok) {
          out.sent++;
          await supabaseAdmin
            .from("outbound_dispatch_queue" as never)
            .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null } as never)
            .eq("id", r.id);
        } else {
          out.failed++;
          const dead = (r.attempts ?? 0) + 1 >= MAX_ATTEMPTS;
          await supabaseAdmin
            .from("outbound_dispatch_queue" as never)
            .update({
              status: dead ? "dead" : "queued",
              last_error: res.error ?? `status_${res.status}`,
              not_before: new Date(Date.now() + 120_000).toISOString(),
            } as never)
            .eq("id", r.id);
        }
      } catch (e) {
        out.failed++;
        await supabaseAdmin
          .from("outbound_dispatch_queue" as never)
          .update({ status: "queued", last_error: String(e) } as never)
          .eq("id", r.id);
      }

      // Inter-send pacing so a drained batch never lands in one second.
      await new Promise((r2) => setTimeout(r2, 400 + Math.floor(Math.random() * 900)));
    }
  } catch (e) {
    console.error("[dispatch-queue] sweep failed", (e as Error).message);
  }
  return out;
}
