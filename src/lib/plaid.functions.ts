import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

/** Masked Plaid/Bluevine link posture. */
export const getPlaidStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { plaidStatus } = await import("@/lib/plaid.server");
    return await plaidStatus();
  });

/** Step 1 — mint a Plaid Link token pinned to Bluevine (ins_127296). */
export const createPlaidLinkToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { createLinkToken } = await import("@/lib/plaid.server");
    return await createLinkToken(context.userId);
  });

/** Step 2 — exchange the public token; access token is stored server-side only. */
export const exchangePlaidPublicToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { publicToken: string; accountId?: string | null }) => d)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    if (!data?.publicToken) return { ok: false as const, error: "public_token_required" };
    const { exchangePublicToken } = await import("@/lib/plaid.server");
    const out = await exchangePublicToken(data.publicToken, context.userId, data.accountId ?? null);
    // Event-driven: a fresh bank link may complete the handshake — release now.
    const { attemptAutoRelease } = await import("@/lib/auto-release.server");
    const release = await attemptAutoRelease("plaid_linked");
    return { ...(out as any), release };
  });

export const unlinkPlaidAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { unlinkPlaid } = await import("@/lib/plaid.server");
    return await unlinkPlaid();
  });

/** Recent ACH transfers executed on the Plaid rail. */
export const listPlaidTransfers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("plaid_transfers" as any)
      .select("id,deal_id,transfer_id,direction,amount_usd,status,failure_reason,created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    return (data ?? []) as any[];
  });
