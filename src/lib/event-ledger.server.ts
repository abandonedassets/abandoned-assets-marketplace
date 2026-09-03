// Append-only event ledger. Every real state change (contract cleared,
// buy-box update, wire dispatched) is appended, never mutated.
// Fail-forward: ledger writes never throw into a settlement path.

export type LedgerEvent = {
  entity: string; // logical stream, e.g. "closing_pipeline_items"
  entityId?: string | null;
  operation: string; // e.g. "FUNDS_CLEARED", "WIRE_DISPATCHED"
  actor?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export async function appendLedger(e: LedgerEvent): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("system_audit_log").insert({
      table_name: e.entity,
      row_id: e.entityId ?? null,
      operation: e.operation,
      changed_by: e.actor ?? "system",
      old_data: (e.before ?? null) as never,
      new_data: (e.after ?? null) as never,
    } as never);
  } catch (err) {
    console.error("[ledger] append failed", err);
  }
}
