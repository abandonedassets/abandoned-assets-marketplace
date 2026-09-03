// Real-time conversion telemetry.
// Captures buyer-side friction events (link opened, vdr opened, e-sign landed,
// e-sign signed, checkout started, checkout abandoned, funds cleared).
// Fail-forward: telemetry never blocks a revenue path.

export type ConversionEvent =
  | "LINK_OPENED"
  | "VDR_OPENED"
  | "INVOICE_OPENED"
  | "ESIGN_LANDED"
  | "ESIGN_SIGNED"
  | "CHECKOUT_STARTED"
  | "CHECKOUT_ABANDONED"
  | "FUNDS_CLEARED"
  | "WEBHOOK_DISPATCHED"
  | "EMAIL_DISPATCHED";

export async function trackConversion(input: {
  event: ConversionEvent;
  pipelineItemId?: string | null;
  buyerEmail?: string | null;
  channel?: string | null;
  request?: Request | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const req = input.request ?? null;
    const isUuid = (v: unknown) =>
      typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const row = {
      event: input.event,
      pipeline_item_id: isUuid(input.pipelineItemId) ? input.pipelineItemId : null,
      buyer_email: input.buyerEmail ?? null,
      channel: input.channel ?? null,
      user_agent: req?.headers.get("user-agent") ?? null,
      referer: req?.headers.get("referer") ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        ...(isUuid(input.pipelineItemId) ? {} : { raw_asset_ref: input.pipelineItemId ?? null }),
      },
    };
    const { error } = await supabaseAdmin
      .from("conversion_events" as never)
      .insert(row as never);
    // 23505 = duplicate idempotency key: webhook retry, silently incinerate.
    if (error && (error as { code?: string }).code === "23505") return;
    if (error) {
      // Fail-forward: drop the FK reference rather than lose the event.
      await supabaseAdmin.from("conversion_events" as never).insert({
        ...row,
        pipeline_item_id: null,
        metadata: { ...row.metadata, fk_dropped: true, db_error: error.message },
      } as never);
    }
  } catch (e) {
    console.error("[telemetry] track failed", e);
  }
}


/** Fire-and-forget wrapper — safe on hot request paths. */
export function trackConversionAsync(
  input: Parameters<typeof trackConversion>[0],
): void {
  void trackConversion(input);
}
