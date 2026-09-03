// Pre-Flight Validation Gateway.
// No asset reaches REVERSE_STRIKE_READY without a normalized address,
// verified ownership and an equity spread that covers the assignment fee.
// Bad data drops to INVALID_LEAD instead of stalling the tape.

export type PreflightResult = {
  ok: boolean;
  state: "REVERSE_STRIKE_READY" | "INVALID_LEAD" | "ERROR";
  problems?: string[];
  error?: string;
};

export async function validateLead(dealId: string): Promise<PreflightResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("preflight_validate_lead" as never, {
      _id: dealId,
    } as never);
    if (error) return { ok: false, state: "ERROR", error: error.message };
    const r = (data ?? {}) as any;
    return {
      ok: Boolean(r.ok),
      state: (r.state ?? "INVALID_LEAD") as PreflightResult["state"],
      problems: Array.isArray(r.problems) ? r.problems : undefined,
    };
  } catch (e) {
    return { ok: false, state: "ERROR", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Bounded sweep across candidate inventory. Never throws. */
export async function runPreflightSweep(limit = 100) {
  const out = { ok: true, checked: 0, ready: 0, invalid: 0 };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id")
      .is("cleared_at", null)
      .order("updated_at", { ascending: true })
      .limit(limit);

    for (const row of ((data ?? []) as Array<{ id: string }>)) {
      const res = await validateLead(row.id);
      out.checked += 1;
      if (res.ok) out.ready += 1;
      else if (res.state === "INVALID_LEAD") out.invalid += 1;
    }
    return out;
  } catch (e) {
    return { ...out, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
