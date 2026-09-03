// internal-platform-test-001 capital crucible.
// Drives the 402 gate, the 500ms poison pill and the atomic fee lock against
// the internal Mock RTGS service. Zero fiat leaves the building.

import { canonicalString, signCanonical } from "./m2m-hmac.server";
import { ensureEnclaveCredentials, INTERNAL_TENANT_ID, withDeadline } from "./uat-enclave.server";

const PATH = "/api/public/v1/sandbox/execute";

export type CrucibleCase = {
  name: string;
  expect_status: number;
  status: number | null;
  pass: boolean;
  latency_ms: number;
  body: Record<string, any> | null;
};

export async function runCapitalCrucible(input: {
  origin: string;
  dealId?: string | null;
}): Promise<{ tenant: string; deal_id: string | null; ok: boolean; cases: CrucibleCase[] }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { randomUUID } = await import("crypto");
  const cred = await ensureEnclaveCredentials(INTERNAL_TENANT_ID);

  let dealId = input.dealId ?? null;
  let fee = 0;
  const q = supabaseAdmin
    .from("closing_pipeline_items")
    .select("id, optimized_acquisition_premium")
    .is("cleared_at", null)
    .gt("optimized_acquisition_premium", 0);
  const { data } = dealId
    ? await q.eq("id", dealId).maybeSingle()
    : await q.limit(1).maybeSingle();
  const row = data as Record<string, any> | null;
  dealId = (row?.["id"] as string | undefined) ?? dealId;
  fee = Number(row?.["optimized_acquisition_premium"] ?? 0);
  if (!dealId) return { tenant: INTERNAL_TENANT_ID, deal_id: null, ok: false, cases: [] };

  const fire = async (
    name: string,
    expect: number,
    payload: Record<string, unknown>,
    delayMs: number | null,
  ): Promise<CrucibleCase> => {
    const t0 = Date.now();
    const txnId = `cap-${randomUUID()}`;
    const body = JSON.stringify({ deal_id: dealId, signature: txnId, uat: true, ...payload });
    const ts = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-M2M-Key-Id": cred.key_id,
      "X-M2M-Timestamp": ts,
      "X-M2M-Signature": signCanonical(canonicalString("POST", PATH, ts, body), cred.secret),
      "X-Client-Txn-Id": txnId,
    };
    if (delayMs != null) headers["X-Mock-Rail-Delay-Ms"] = String(delayMs);
    try {
      const res = await withDeadline(
        fetch(`${input.origin}${PATH}`, { method: "POST", headers, body }),
        15000,
        name,
      );
      const json = (await res.json().catch(() => null)) as Record<string, any> | null;
      return {
        name,
        expect_status: expect,
        status: res.status,
        pass: res.status === expect,
        latency_ms: Date.now() - t0,
        body: json,
      };
    } catch (e) {
      return {
        name,
        expect_status: expect,
        status: null,
        pass: false,
        latency_ms: Date.now() - t0,
        body: { error: (e as Error).message },
      };
    }
  };

  const token = (amount: number) => ({
    network: "FEDNOW",
    reference: `MOCK-${randomUUID().slice(0, 18)}`,
    amount,
  });

  const cases: CrucibleCase[] = [];
  // 1. No capital in the payload — vault door never unlocks.
  cases.push(await fire("402_missing_capital_token", 402, {}, null));
  // 2. Token present but underfunded against the assignment fee.
  cases.push(
    await fire("402_underfunded_token", 402, { capital_token: token(Math.max(0.01, fee / 2)) }, null),
  );
  // 3. Rail lags past the 500ms TTL — poison pill fires, asset released.
  cases.push(
    await fire("408_poison_pill", 408, { capital_token: token(fee) }, 900),
  );
  // 4. Funded token clears the mock rail in ~100ms — atomic seal writes.
  cases.push(await fire("200_atomic_seal", 200, { capital_token: token(fee) }, 100));

  const ok = cases.every((c) => c.pass);

  try {
    await supabaseAdmin.from("system_audit_logs").insert({
      pipeline_item_id: dealId,
      event_type: "UAT_CAPITAL_CRUCIBLE",
      reason: `Mock RTGS crucible ${ok ? "PASS" : "FAIL"} (${cases.filter((c) => c.pass).length}/${cases.length})`,
      payload: { tenant: INTERNAL_TENANT_ID, deal_id: dealId, fee, cases } as never,
    } as never);
  } catch {
    /* fail-forward */
  }

  return { tenant: INTERNAL_TENANT_ID, deal_id: dealId, ok, cases };
}
