import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";
import { z } from "zod";

/** Admin trigger for the reverse-demand (dark pool) ingestion engine. */
export const runDarkPool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(50).default(10) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context as never);
    const { runDarkPoolIngest } = await import("@/lib/dark-pool.server");
    return runDarkPoolIngest(data.limit);
  });
