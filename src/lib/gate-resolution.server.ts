// Autonomous Resolution Loops — the machine closes its own gates.
//
// When an asset is BLOCKED (missing signed contract, unconfirmed counterparty,
// no title/escrow file) the system does NOT hand the operator a homework
// assignment. It dispatches the resolution itself and tracks the loop state:
//
//   AUTO_DISPATCHING -> AWAITING_EXTERNAL_RESPONSE -> RESOLVED | FAILED
//
// Real-world truth is preserved: a gate flips to RESOLVED only when a real
// external value lands in the corresponding column. Nothing is synthesized.

import { settlementBinding, type BindingBlocker } from "./settlement-binding";

export type GateKey = "CONTRACT" | "COUNTERPARTY" | "TITLE_ESCROW";
export type GateState =
  | "AUTO_DISPATCHING"
  | "AWAITING_EXTERNAL_RESPONSE"
  | "RESOLVED"
  | "FAILED";

const BLOCKER_TO_GATE: Record<BindingBlocker, GateKey> = {
  NO_SIGNED_CONTRACT: "CONTRACT",
  NO_VERIFIED_COUNTERPARTY: "COUNTERPARTY",
  NO_TITLE_ESCROW_FILE: "TITLE_ESCROW",
};

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;

function backoff(attempts: number) {
  return new Date(
    Date.now() + Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempts))),
  ).toISOString();
}

type Upsert = {
  dealId: string;
  gate: GateKey;
  state: GateState;
  attempts: number;
  detail: string;
  externalRef?: string | null;
};

async function writeState(u: Upsert) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("gate_resolution_state" as never).upsert(
    {
      pipeline_item_id: u.dealId,
      gate: u.gate,
      state: u.state,
      attempts: u.attempts,
      last_attempt_at: new Date().toISOString(),
      next_attempt_at: u.state === "RESOLVED" ? null : backoff(u.attempts),
      last_detail: u.detail.slice(0, 400),
      external_ref: u.externalRef ?? null,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "pipeline_item_id,gate" } as never,
  );
}

/** Dispatch the assignment/purchase agreement to the seller for digital execution. */
async function resolveContract(d: Record<string, any>): Promise<{ state: GateState; detail: string; ref?: string }> {
  const seller = String(d["seller_email"] ?? "").trim();
  if (!seller) return { state: "AUTO_DISPATCHING", detail: "no_seller_contact_on_record" };

  const { sellerAuthUrl } = await import("./seller-link.server");
  const { sendM2MEmail, assetHeaders, jsonBlock } = await import("./email.server");
  const url = await sellerAuthUrl(String(d["id"]));
  const price = Number(d["base_contract_price"]) || 0;

  const res = await sendM2MEmail({
    to: seller,
    subject: `Purchase agreement ready for execution — ${d["address"] ?? d["apn"] ?? "your property"}`,
    html: `<p>Your purchase agreement package is ready for digital execution.</p>
<p><a href="${url}">Review &amp; sign electronically</a></p>
${jsonBlock({
  asset_id: d["id"],
  address: d["address"] ?? null,
  apn: d["apn"] ?? null,
  offer_price_usd: price,
  execution_url: url,
})}`,
    headers: assetHeaders({ dealId: String(d["id"]), assetType: d["asset_type"] ?? null } as never),
  });

  return res.ok
    ? { state: "AWAITING_EXTERNAL_RESPONSE", detail: `agreement dispatched to ${seller}`, ref: url }
    : { state: "AUTO_DISPATCHING", detail: `dispatch failed: ${res.error ?? res.status}` };
}

/** Broadcast the payload to configured institutional counterparty endpoints. */
async function resolveCounterparty(d: Record<string, any>): Promise<{ state: GateState; detail: string }> {
  const { syndicateToFunds } = await import("./fund-intake.server");
  const out = await syndicateToFunds(
    {
      property_id: d["id"],
      address: d["address"] ?? null,
      apn: d["apn"] ?? null,
      zip: d["zip"] ?? null,
      state: d["state"] ?? null,
      asset_type: d["asset_type"] ?? null,
      base_contract_price: Number(d["base_contract_price"]) || 0,
      assignment_fee: Number(d["optimized_acquisition_premium"]) || 0,
      arv: Number(d["calculated_arv"]) || 0,
      title_status: d["title_status"] ?? null,
      ack_endpoint: `/api/v1/deals/${d["id"]}/programmatic-lock`,
    },
    String(d["id"]),
  );
  const n = (out as { dispatched?: number }).dispatched ?? 0;
  return n > 0
    ? { state: "AWAITING_EXTERNAL_RESPONSE", detail: `payload pushed to ${n} counterparty endpoint(s)` }
    : { state: "AUTO_DISPATCHING", detail: (out as any).reason ?? "no_counterparty_endpoints" };
}

/** Fire the title/escrow order to the closing desk. */
async function resolveTitle(d: Record<string, any>): Promise<{ state: GateState; detail: string; ref?: string }> {
  const { orderTitle } = await import("./title-order.server");
  const r = await orderTitle(String(d["id"]), "MANUAL");
  if (r.ordered)
    return {
      state: "AWAITING_EXTERNAL_RESPONSE",
      detail: `title ordered via ${r.channel}`,
      ref: r.ref ?? undefined,
    };
  if (r.reason === "already_ordered")
    return { state: "AWAITING_EXTERNAL_RESPONSE", detail: "title order already open" };
  return { state: "AUTO_DISPATCHING", detail: r.reason ?? "title order not dispatched" };
}

export type ResolutionReport = {
  ok: boolean;
  scanned: number;
  dispatched: number;
  awaiting: number;
  resolved: number;
  skipped: number;
  errors: number;
};

export async function runGateResolution(limit = 40): Promise<ResolutionReport> {
  const report: ResolutionReport = {
    ok: true,
    scanned: 0,
    dispatched: 0,
    awaiting: 0,
    resolved: 0,
    skipped: 0,
    errors: 0,
  };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: deals } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id, address, apn, zip, state, asset_type, seller_email, title_status, calculated_arv, base_contract_price, optimized_acquisition_premium, signed_contract_hash, verified_counterparty_id, title_escrow_file_number",
    )
    .is("cleared_at", null)
    .gt("optimized_acquisition_premium", 0)
    .order("optimized_acquisition_premium", { ascending: false })
    .limit(limit);

  const rows = (deals ?? []) as Array<Record<string, any>>;
  if (!rows.length) return report;

  const { data: states } = await supabaseAdmin
    .from("gate_resolution_state" as never)
    .select("pipeline_item_id, gate, state, attempts, next_attempt_at")
    .in(
      "pipeline_item_id",
      rows.map((r) => r["id"]),
    );

  const byKey = new Map<string, Record<string, any>>();
  for (const s of ((states ?? []) as Array<Record<string, any>>))
    byKey.set(`${s["pipeline_item_id"]}:${s["gate"]}`, s);

  const now = Date.now();

  for (const d of rows) {
    report.scanned += 1;
    const bind = settlementBinding(d as never);
    const blockedGates = new Set(bind.blockers.map((b) => BLOCKER_TO_GATE[b]));

    for (const gate of ["CONTRACT", "COUNTERPARTY", "TITLE_ESCROW"] as GateKey[]) {
      const prev = byKey.get(`${d["id"]}:${gate}`);

      // Real external value landed → the loop closes itself.
      if (!blockedGates.has(gate)) {
        if (prev && prev["state"] !== "RESOLVED") {
          await writeState({
            dealId: String(d["id"]),
            gate,
            state: "RESOLVED",
            attempts: Number(prev["attempts"]) || 0,
            detail: "external record verified",
          });
          report.resolved += 1;
        }
        continue;
      }

      const attempts = Number(prev?.["attempts"] ?? 0);
      if (prev && prev["state"] === "FAILED") {
        report.skipped += 1;
        continue;
      }
      if (prev?.["next_attempt_at"] && new Date(prev["next_attempt_at"]).getTime() > now) {
        report.skipped += 1;
        if (prev["state"] === "AWAITING_EXTERNAL_RESPONSE") report.awaiting += 1;
        continue;
      }
      if (attempts >= MAX_ATTEMPTS) {
        await writeState({
          dealId: String(d["id"]),
          gate,
          state: "FAILED",
          attempts,
          detail: "max autonomous attempts reached — external party unresponsive",
        });
        report.skipped += 1;
        continue;
      }

      try {
        const out =
          gate === "CONTRACT"
            ? await resolveContract(d)
            : gate === "COUNTERPARTY"
              ? await resolveCounterparty(d)
              : await resolveTitle(d);

        await writeState({
          dealId: String(d["id"]),
          gate,
          state: out.state,
          attempts: attempts + 1,
          detail: out.detail,
          externalRef: (out as { ref?: string }).ref ?? null,
        });
        report.dispatched += 1;
        if (out.state === "AWAITING_EXTERNAL_RESPONSE") report.awaiting += 1;
      } catch (e) {
        report.errors += 1;
        await writeState({
          dealId: String(d["id"]),
          gate,
          state: "AUTO_DISPATCHING",
          attempts: attempts + 1,
          detail: `error: ${(e as Error).message}`,
        }).catch(() => {});
      }
    }
  }

  return report;
}
