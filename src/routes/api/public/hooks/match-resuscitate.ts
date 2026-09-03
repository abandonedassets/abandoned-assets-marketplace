import { createFileRoute } from "@tanstack/react-router";

// Surgical match-resuscitator. Receives a single pipeline row_id from the
// pg_cron sweep and re-fires the matching trigger on ONLY that row.
// If still unmatched + high-margin + sufficiently aged, the RPC escalates
// the row to 'House-Bid' (manual confirmation, no auto-escrow).
export const Route = createFileRoute("/api/public/hooks/match-resuscitate")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, note: "POST { row_id } to resuscitate one row" }),
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as { row_id?: string };
          const rowId = body?.row_id;
          if (!rowId || !/^[0-9a-f-]{36}$/i.test(rowId)) {
            return Response.json({ ok: false, error: "invalid_row_id" }, { status: 400 });
          }

          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { data, error } = await supabaseAdmin.rpc(
            "resuscitate_pipeline_item" as any,
            { p_id: rowId } as any,
          );

          if (error) {
            await supabaseAdmin.from("dead_letter_queue").insert({
              raw_payload: { op: "match_resuscitate", row_id: rowId } as any,
              source_ip: "cron",
              error_reason: `resuscitate_rpc_failed: ${error.message}`,
            });
            return Response.json({ ok: false, error: error.message }, { status: 200 });
          }

          return Response.json({ ok: true, result: data });
        } catch (e) {
          return Response.json(
            { ok: false, error: (e as Error).message },
            { status: 200 },
          );
        }
      },
    },
  },
});
