import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TERMINAL_BUILD_ID } from "@/lib/deals.functions";

export type TerminalHealth = {
  ok: boolean;
  build_id: string;
  request_id: string;
  checked_at: string;
  data_api_ms: number | null;
  error_code: string | null;
};

/** Operator-only, read-only readiness probe for the terminal dependency chain. */
export const getTerminalHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<TerminalHealth> => {
    const request_id = crypto.randomUUID();
    const started = Date.now();
    try {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      const res = await Promise.race([
        supabaseAdmin
          .from("closing_pipeline_items")
          .select("id", { count: "estimated", head: true })
          .abortSignal(AbortSignal.timeout(4000)),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("TERMINAL_HEALTH_TIMEOUT")), 4500),
        ),
      ]);
      const ms = Date.now() - started;
      if ((res as any)?.error) {
        return {
          ok: false,
          build_id: TERMINAL_BUILD_ID,
          request_id,
          checked_at: new Date().toISOString(),
          data_api_ms: ms,
          error_code: "TERMINAL_SCHEMA_ERROR",
        };
      }
      return {
        ok: true,
        build_id: TERMINAL_BUILD_ID,
        request_id,
        checked_at: new Date().toISOString(),
        data_api_ms: ms,
        error_code: null,
      };
    } catch {
      return {
        ok: false,
        build_id: TERMINAL_BUILD_ID,
        request_id,
        checked_at: new Date().toISOString(),
        data_api_ms: Date.now() - started,
        error_code: "TERMINAL_DATA_TIMEOUT",
      };
    }
  });
