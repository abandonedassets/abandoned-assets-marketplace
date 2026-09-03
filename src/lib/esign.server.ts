// Programmatic e-signature gateway: tokenized web portal (no PDF attachments).
// Buyer signs inline → ACH invoice mints and dispatches automatically.

import { sendM2MEmail, assetHeaders, jsonBlock } from "./email.server";
import { riskClauseHtml } from "./risk-clauses.server";


export const ANTI_CIRCUMVENTION_PENALTY = 25000;

function token(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().slice(0, 8);
}

function money(n: number | null | undefined) {
  return `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
}

export async function createAndSendContract(input: {
  dealId: string;
  buyerEmail: string;
  origin: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: deal } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id, address, city, state, zip, apn, asset_type, base_contract_price, optimized_acquisition_premium, estimated_stumpage_mbf",
    )
    .eq("id", input.dealId)
    .maybeSingle();
  if (!deal) return { ok: false as const, error: "deal_not_found" };

  const t = token();
  const fee = Number(deal.optimized_acquisition_premium) || 0;
  const { data: row, error } = await supabaseAdmin
    .from("esign_requests")
    .insert({
      pipeline_item_id: deal.id,
      buyer_email: input.buyerEmail,
      token: t,
      assignment_fee: fee,
      status: "Sent",
    })
    .select("id, token")
    .single();
  if (error) return { ok: false as const, error: error.message };
  try {
    const { setContractState } = await import("./contract-state.server");
    await setContractState(deal.id, "PENDING_BUYER_SIGN");
  } catch {
    /* fail-forward */
  }

  const rawLink = `${input.origin}/esign/${t}`;
  const { generateTrackedEsignLink } = await import("./links");
  const link = generateTrackedEsignLink(
    input.buyerEmail ?? "",
    String(deal.id),
    rawLink,
    input.origin,
  );
  const { vdrUrl, vdrToken } = await import("./vdr.server");
  const vdr = await vdrUrl(input.origin, deal.id);
  const ddUrl = `${input.origin}/api/public/dd/${await vdrToken(deal.id)}`;
  try {
    const { recordBuyerEvent } = await import("./scorecard.server");
    await recordBuyerEvent(input.buyerEmail, "claimed");
  } catch {
    /* fail-forward */
  }
  const assetId = `REELEDGE-${(deal.asset_type ?? "ASSET").toUpperCase()}-${deal.apn ?? deal.zip ?? "NA"}`;
  const payload = {
    asset_id: assetId,
    address: [deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", "),
    apn: deal.apn,
    asset_type: deal.asset_type,
    contract_price: Number(deal.base_contract_price) || 0,
    assignment_fee: fee,
    execution_url: link,
    vdr_access_url: vdr,
    due_diligence_packet_url: ddUrl,
    settlement: "ACH / us_bank_account only",
  };

  const { buildBlindHudSheet, blindHudHtml } = await import("./blind-hud.server");
  const hud = buildBlindHudSheet({ dealId: deal.id, address: payload.address, apn: deal.apn });

  // Cross-collateralized poison pill rider (confession of judgment).
  let poisonPill = "";
  try {
    const { poisonPillHtml, attachRider } = await import("./poison-pill.server");
    poisonPill = poisonPillHtml();
    await attachRider({ dealId: String(deal.id), buyerEmail: input.buyerEmail });
  } catch {
    /* fail-forward */
  }


  const html = `
  <div style="font:14px -apple-system,Segoe UI,sans-serif;color:#111">
    <h2 style="margin:0 0 8px">Assignment Agreement — Ready for Execution</h2>
    <table cellpadding="6" style="border-collapse:collapse;font:13px monospace">
      <tr><td><b>Asset ID</b></td><td>${assetId}</td></tr>
      <tr><td><b>Address</b></td><td>${payload.address}</td></tr>
      <tr><td><b>Contract Price</b></td><td>${money(deal.base_contract_price)}</td></tr>
      <tr><td><b>Assignment Fee</b></td><td>${money(fee)}</td></tr>
      <tr><td><b>EMD Lock</b></td><td>24 hours, hard — contract voids automatically if ACH EMD has not cleared</td></tr>
    </table>
    <p><a href="${link}" style="display:inline-block;background:#0b6;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none"><b>Execute Agreement (30 seconds)</b></a></p>
    <p><a href="${ddUrl}" style="color:#0b6"><b>Automated Due Diligence Dossier</b></a> — GIS boundary, zoning, topography, FEMA flood, utility proximity, and the Ledger Anomaly title stamp. Everything needed to decide in 5 minutes.</p>
    <p style="font-size:12px;color:#555">Includes Anti-Circumvention (${money(ANTI_CIRCUMVENTION_PENALTY)} liquidated damages), Hardened 24-Hour EMD Lock (auto-void and re-list on lapse), and Inspection Waiver. Settlement is ACH-only; wire instructions issue on execution. Counterparty entity is OFAC/SDN screened at execution.</p>
    ${poisonPill}
    ${riskClauseHtml(null)}

    ${blindHudHtml(hud)}
    ${jsonBlock({ ...payload, escrow_instructions: hud })}
  </div>`;



  await sendM2MEmail({
    to: input.buyerEmail,
    subject: `[EXECUTE] ${assetId} — Assignment Agreement (${money(fee)} fee)`,
    html,
    headers: assetHeaders({
      assetId,
      dealType: (deal.asset_type ?? "ASSET").toUpperCase(),
      assignmentFee: fee,
      stumpage: deal.estimated_stumpage_mbf,
      action: "SIGNATURE_REQUIRED",
      vdrUrl: vdr,
    }),
  });

  return { ok: true as const, esign_id: row.id, token: t, url: link };
}

export async function getContract(t: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("esign_requests")
    .select(
      "id, token, status, buyer_email, assignment_fee, signed_at, invoice_url, pipeline_item_id, closing_pipeline_items(address, city, state, zip, apn, asset_type, base_contract_price)",
    )
    .eq("token", t)
    .maybeSingle();
  return data ?? null;
}

/** OFAC screen → sign → cloud title → mint ACH invoice → non-repudiation receipt. */
export async function signContract(input: {
  token: string;
  signerName: string;
  ip: string | null;
  buyerEntity?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  w9LegalName?: string | null;
  w9TaxClassification?: string | null;
  w9Tin?: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: req } = await supabaseAdmin
    .from("esign_requests")
    .select(
      "id, status, buyer_email, pipeline_item_id, invoice_url, assignment_fee, emd_hold_status, emd_hold_amount",
    )
    .eq("token", input.token)
    .maybeSingle();
  if (!req) return { ok: false as const, error: "not_found" };
  if (req.status === "Signed" && req.invoice_url)
    return { ok: true as const, invoice_url: req.invoice_url, reused: true };
  if ((req.status as string) === "Blocked-OFAC")
    return { ok: false as const, error: "compliance_hold" };

  // Proof-of-Funds gate — algorithmic liquidity check before execution.
  try {
    const { pofSatisfied } = await import("./pof.server");
    if (!(await pofSatisfied(input.token)))
      return { ok: false as const, error: "pof_required" };
  } catch {
    /* fail-forward: never stall on a gate read error */
  }

  // EMD gate — no signature without live earnest money in escrow.
  if ((req as any).emd_hold_status !== "authorized") {
    return {
      ok: false as const,
      error: "emd_required",
      emd_amount: Number((req as any).emd_hold_amount ?? 1000),
    };
  }


  // IRS gate — no execution, no invoice, no payout without a certified W-9.
  const w9Tin = (input.w9Tin ?? "").replace(/\D/g, "");
  const w9LegalName = (input.w9LegalName ?? "").trim().slice(0, 200);
  const w9Class = (input.w9TaxClassification ?? "").trim().slice(0, 60);
  if (w9Tin.length !== 9 || w9LegalName.length < 2 || !w9Class)
    return { ok: false as const, error: "w9_required" };
  const w9TinHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`w9:${w9Tin}`)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const signerName = input.signerName.trim().slice(0, 120);
  const buyerEntity = (input.buyerEntity ?? "").trim().slice(0, 200) || null;
  const executedAt = new Date().toISOString();


  // 1) Federal risk gate — OFAC / SDN sanctions screen before execution.
  const { screenParties } = await import("./ofac.server");
  const ofac = await screenParties([buyerEntity, signerName, req.buyer_email?.split("@")[1]]);
  const { writeAuditLog } = await import("./webhook-verify.server");

  if (ofac.status === "Blocked") {
    await supabaseAdmin
      .from("esign_requests")
      .update({
        status: "Blocked-OFAC",
        ofac_status: "Blocked",
        ofac_result: ofac as never,
        ofac_screened_at: ofac.screened_at,
        blocked_at: executedAt,
        buyer_entity: buyerEntity,
      } as never)
      .eq("id", req.id);
    await writeAuditLog({
      event_type: "OFAC_BLOCK",
      reason: "sdn_match_on_execution",
      pipeline_item_id: req.pipeline_item_id,
      ip_address: input.ip,
      raw_payload: { esign_id: req.id, buyer_email: req.buyer_email, ofac } as never,
    });
    try {
      const { supabaseAdmin: sa } = await import("@/integrations/supabase/client.server");
      await sa.from("system_alerts").insert({
        kind: "OFAC_BLOCK",
        severity: "critical",
        message: `Sanctions match blocked execution for ${req.buyer_email}`,
        deal_id: req.pipeline_item_id,
        metadata: ofac as never,
      } as never);
    } catch (e) {
      console.error("[ofac] alert insert failed", e);
    }
    return { ok: false as const, error: "compliance_hold" };
  }

  // 2) Execute with full non-repudiation evidence capture.
  await supabaseAdmin
    .from("esign_requests")
    .update({
      status: "Signed",
      signer_name: signerName,
      signer_ip: input.ip,
      signed_at: executedAt,
      buyer_entity: buyerEntity,
      ofac_status: ofac.status,
      ofac_result: ofac as never,
      ofac_screened_at: ofac.screened_at,
      signer_user_agent: (input.userAgent ?? "").slice(0, 500) || null,
      device_fingerprint: (input.deviceFingerprint ?? "").slice(0, 200) || null,
      w9_legal_name: w9LegalName,
      w9_tax_classification: w9Class,
      w9_tin_last4: w9Tin.slice(-4),
      w9_tin_hash: w9TinHash,
      w9_certified_at: executedAt,

    } as never)
    .eq("id", req.id);

  await writeAuditLog({
    event_type: "ESIGN_SIGNED",
    reason: `signed_by:${signerName.slice(0, 80)}`,
    pipeline_item_id: req.pipeline_item_id,
    ip_address: input.ip,
    raw_payload: {
      esign_id: req.id,
      buyer_email: req.buyer_email,
      buyer_entity: buyerEntity,
      fee: req.assignment_fee,
      user_agent: input.userAgent ?? null,
      device_fingerprint: input.deviceFingerprint ?? null,
      ofac_status: ofac.status,
      executed_at: executedAt,
    } as never,
  });

  try {
    const { setContractState } = await import("./contract-state.server");
    await setContractState(req.pipeline_item_id, "FULLY_EXECUTED");
  } catch {
    /* fail-forward */
  }

  // Sovereign state trigger: local SHA-256 of the executed signature is
  // injected straight into the ledger, stripping the blocked/pending state so
  // the dispatch daemon pushes the asset on its very next tick.
  try {
    const { injectSignatureHash } = await import("./sovereign-m2m.server");
    await injectSignatureHash({
      dealId: req.pipeline_item_id,
      signerEmail: req.buyer_email ?? null,
      signedAt: executedAt,
      documentRef: req.id,
    });
  } catch (e) {
    console.error("[esign] sovereign signature inject failed", e);
  }


  // 3) Asset risk — cloud the title with a recorded Memorandum of Contract.
  try {
    const { cloudTitle } = await import("./title-cloud.server");
    await cloudTitle(req.pipeline_item_id);
  } catch (e) {
    console.error("[esign] title cloud failed", e);
  }

  const { createAchInvoice } = await import("./bluevine.server");
  const inv = await createAchInvoice(req.pipeline_item_id, req.buyer_email);
  if (!inv.ok) return { ok: false as const, error: inv.error, signed: true };

  await supabaseAdmin
    .from("esign_requests")
    .update({ invoice_url: inv.url, invoice_sent_at: new Date().toISOString(), status: "Invoiced" })
    .eq("id", req.id);

  const evidence = {
    document: "NON_REPUDIATION_EXECUTION_RECEIPT",
    esign_id: req.id,
    asset_id: req.pipeline_item_id,
    buyer_entity: buyerEntity,
    signatory: signerName,
    buyer_email: req.buyer_email,
    executed_at_utc: executedAt,
    ip_address: input.ip,
    user_agent: input.userAgent ?? null,
    device_fingerprint: input.deviceFingerprint ?? null,
    ofac_screening: { status: ofac.status, screened_at: ofac.screened_at, hits: ofac.hits.length },
    assignment_fee: Number(req.assignment_fee) || 0,
    settlement: "ACH / us_bank_account only",
    ach_authorization:
      "Signatory affirmatively authorized the ACH debit at the timestamp above under E-SIGN/UETA.",
  };
  const evidenceHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(evidence))),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await supabaseAdmin
    .from("esign_requests")
    .update({
      nonrepudiation_sent_at: new Date().toISOString(),
      nonrepudiation_hash: evidenceHash,
    } as never)
    .eq("id", req.id);

  await sendM2MEmail({
    to: req.buyer_email,
    subject: `[ACH INVOICE] Executed — settlement instructions + execution receipt`,
    html: `<div style="font:14px -apple-system,sans-serif">
      <h2>Agreement executed. ACH invoice issued.</h2>
      <p>Assignment fee: <b>${money(req.assignment_fee)}</b></p>
      <p><a href="${inv.url}" style="background:#0b6;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">Pay via ACH (us_bank_account)</a></p>
      <h3 style="margin:20px 0 4px">Non-Repudiation Execution Receipt</h3>
      <p style="font-size:12px;color:#555">Retain this receipt. SHA-256: <code>${evidenceHash}</code></p>
      ${riskClauseHtml(null)}
      ${jsonBlock({ ...evidence, evidence_sha256: evidenceHash })}
    </div>`,
    headers: {
      "X-Action-Required": "ACH_PAYMENT_DUE",
      "X-Assignment-Fee": String(Math.round(Number(req.assignment_fee) || 0)),
      "X-Evidence-SHA256": evidenceHash,
      "X-OFAC-Status": ofac.status,
    },
  });

  return { ok: true as const, invoice_url: inv.url, reused: false, evidence_sha256: evidenceHash };

}

/**
 * Automated e-signature dispatch. Bundles the generated closing package plus
 * the title commitment and sends one envelope to buyer and seller. Uses an
 * external provider (DocuSign / Dropbox Sign) when ESIGN_API_KEY is present;
 * otherwise falls back to the in-house tokenized portal so the loop never
 * stalls. Fail-forward: never throws.
 */
export async function dispatchClosingEnvelope(input: {
  dealId: string;
  origin?: string;
}): Promise<{ ok: boolean; channel: "provider" | "portal" | "none"; detail?: string }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id,address,zip,seller_email,matched_buyer_id,title_commitment_url,optimized_acquisition_premium")
      .eq("id", input.dealId)
      .maybeSingle();
    if (!data) return { ok: false, channel: "none", detail: "deal_not_found" };
    const d = data as any;

    const { getClosingBundleUrl } = await import("./closing-docs.server");
    const bundleUrl = await getClosingBundleUrl(d.id);

    let buyerEmail: string | null = null;
    if (!buyerEmail && d.matched_buyer_id) {
      const { data: b } = await supabaseAdmin
        .from("buyer_buy_boxes")
        .select("contact_email")
        .eq("id", d.matched_buyer_id)
        .maybeSingle();
      buyerEmail = (b as any)?.contact_email ?? null;
    }
    const recipients = [buyerEmail, d.seller_email].filter(Boolean) as string[];
    if (!recipients.length) return { ok: false, channel: "none", detail: "no_recipients" };

    const providerUrl = process.env["ESIGN_API_URL"];
    const providerKey = process.env["ESIGN_API_KEY"];
    if (providerUrl && providerKey) {
      const res = await fetch(providerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerKey}` },
        body: JSON.stringify({
          title: `Closing Package — ${d.address ?? d.id}`,
          deal_id: d.id,
          signers: recipients.map((email, i) => ({ email, order: i + 1 })),
          documents: [bundleUrl, d.title_commitment_url].filter(Boolean),
        }),
      });
      if (res.ok) return { ok: true, channel: "provider" };
      console.error("[esign] provider dispatch failed", res.status);
    }

    // In-house fallback — tokenized portal envelope to every signer.
    const origin = input.origin ?? process.env["PUBLIC_APP_URL"] ?? "https://asset-weaver-30.lovable.app";
    let sent = 0;
    for (const email of recipients) {
      const r = await createAndSendContract({ dealId: d.id, buyerEmail: email, origin });
      if (r.ok) sent += 1;
    }
    if (bundleUrl) {
      await sendM2MEmail({
        to: recipients,
        subject: `[CLOSING PACKAGE] ${d.address ?? d.id} — HUD, contracts, escrow instructions`,
        html: `<div style="font:14px -apple-system,sans-serif">
          <h2>Ready-to-sign closing package</h2>
          <p><a href="${bundleUrl}">Download the complete closing bundle (PDF)</a></p>
          ${d.title_commitment_url ? `<p><a href="${d.title_commitment_url}">Title Commitment</a></p>` : ""}
        </div>`,
        headers: { "X-Action-Required": "SIGNATURE_REQUIRED", "X-Deal-Id": String(d.id) },
      });
    }
    return sent ? { ok: true, channel: "portal" } : { ok: false, channel: "none", detail: "dispatch_failed" };
  } catch (e) {
    console.error("[esign] closing envelope failed", e);
    return { ok: false, channel: "none", detail: e instanceof Error ? e.message : String(e) };
  }
}
