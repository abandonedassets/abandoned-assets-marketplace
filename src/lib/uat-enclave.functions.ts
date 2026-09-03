import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type UatRow = {
  id: string;
  client_txn_id: string | null;
  amount_usd: number;
  signature_ok: boolean;
  handshake_status: number | null;
  rail_status: string | null;
  rail_reference: string | null;
  latency_ms: number | null;
  error_text: string | null;
  created_at: string;
};

export const getUatRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ runs: UatRow[]; key_id: string | null }> => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data } = await supabaseAdmin
      .from("uat_micro_settlements")
      .select(
        "id, client_txn_id, amount_usd, signature_ok, handshake_status, rail_status, rail_reference, latency_ms, error_text, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(15);

    const { data: key } = await supabaseAdmin
      .from("institutional_api_keys")
      .select("key_prefix")
      .eq("sandbox", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      runs: (data ?? []) as UatRow[],
      key_id: (key as { key_prefix?: string } | null)?.key_prefix ?? null,
    };
  });

export const runUatEnclave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { origin: string; amountUsd?: number }) => input)
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { runUatHandshake } = await import("@/lib/uat-enclave.server");
    return runUatHandshake({ origin: data.origin, amountUsd: data.amountUsd ?? 0.01 });
  });

export const runBurstTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { origin: string; count?: number; concurrency?: number }) => input)
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { runBurst } = await import("@/lib/uat-burst.server");
    return runBurst({
      origin: data.origin,
      count: data.count ?? 100,
      concurrency: data.concurrency ?? 20,
    });
  });

export const provisionEnclaveKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { ensureEnclaveCredentials } = await import("@/lib/uat-enclave.server");
    const c = await ensureEnclaveCredentials();
    return { key_id: c.key_id, secret_preview: `${c.secret.slice(0, 8)}…${c.secret.slice(-4)}` };
  });
