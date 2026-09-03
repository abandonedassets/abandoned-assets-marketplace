// Closed-loop feedback telemetry: funds report pass/reject/LOI on matched deals.
// Rejections push down the learned weight for that submarket (online updating).

export type FeedbackAction = "pass" | "reject" | "loi" | "bid";

export async function recordFeedback(input: {
  deal_id: string;
  action: FeedbackAction;
  reason?: string | null;
  fund_id?: string | null;
  api_key_id?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean; zip: string | null; weight: number | null }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let zip: string | null = null;
  try {
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("zip")
      .eq("id", input.deal_id)
      .maybeSingle();
    zip = (data as { zip?: string } | null)?.zip ?? null;
  } catch {
    /* fail-forward */
  }

  try {
    await supabaseAdmin.from("deal_feedback").insert({
      pipeline_item_id: input.deal_id,
      fund_id: input.fund_id ?? null,
      api_key_id: input.api_key_id ?? null,
      action: input.action,
      reason: input.reason ?? null,
      zip,
      metadata: (input.metadata ?? {}) as never,
    } as never);
  } catch (e) {
    console.error("[feedback] insert failed", (e as Error).message);
  }

  let weight: number | null = null;
  if (zip) {
    try {
      let sel = supabaseAdmin
        .from("submarket_weights")
        .select("id, weight, rejects, accepts")
        .eq("zip", zip);
      sel = input.fund_id ? sel.eq("fund_id", input.fund_id) : sel.is("fund_id", null);
      const { data: existing } = await sel.maybeSingle();


      const isReject = input.action === "reject";
      const rejects = (Number((existing as any)?.rejects) || 0) + (isReject ? 1 : 0);
      const accepts = (Number((existing as any)?.accepts) || 0) + (isReject ? 0 : 1);
      // Online update: Laplace-smoothed acceptance rate, floored so a submarket
      // is never fully blacklisted (zero-friction rule).
      weight = Math.max(0.35, Math.min(1.2, (accepts + 1) / (accepts + rejects + 1)));

      if ((existing as any)?.id) {
        await supabaseAdmin
          .from("submarket_weights")
          .update({ weight, rejects, accepts, updated_at: new Date().toISOString() } as never)
          .eq("id", (existing as any).id);
      } else {
        await supabaseAdmin
          .from("submarket_weights")
          .insert({ zip, fund_id: input.fund_id ?? null, weight, rejects, accepts } as never);
      }
    } catch (e) {
      console.error("[feedback] weight update failed", (e as Error).message);
    }
  }

  return { ok: true, zip, weight };
}
