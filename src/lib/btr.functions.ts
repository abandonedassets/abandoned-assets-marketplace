import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

export const getLedgerTape = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { readLedgerTape } = await import("@/lib/btr-engine.server");
    return readLedgerTape(2000);
  });

export const runLedgerBackfill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { backfillLedgerRouting } = await import("@/lib/btr-engine.server");
    return backfillLedgerRouting(5000);
  });

export const runBtrAssembly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { assembleBtrBlocks } = await import("@/lib/btr-engine.server");
    return assembleBtrBlocks({ commit: true });
  });

export const runCreSweep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { runCreEnrichSweep } = await import("@/lib/cre-enrich.server");
    return runCreEnrichSweep(500);
  });
