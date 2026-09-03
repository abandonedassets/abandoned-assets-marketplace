// BlueVine capital routing — ReelEdge Entertainment LLC.
// EXACT beneficiary name match is mandatory: fintech fraud screens bounce
// high-ticket real estate wires on any name mismatch. Do not reformat.

export const BENEFICIARY_NAME = "ReelEdge Entertainment LLC";
export const BENEFICIARY_BANK = "Coastal Community Bank (BlueVine)";

export function wireConfig() {
  return {
    beneficiary: BENEFICIARY_NAME,
    bank: process.env.BLUEVINE_BANK_NAME || BENEFICIARY_BANK,
    routing: process.env.BLUEVINE_ROUTING_NUMBER || null,
    account: process.env.BLUEVINE_ACCOUNT_NUMBER || null,
    address:
      process.env.BLUEVINE_BANK_ADDRESS ||
      "5415 Evergreen Way, Everett, WA 98203",
    beneficiaryAddress: process.env.BENEFICIARY_ADDRESS || null,
  };
}

const money = (n: number) =>
  `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 1-page Fedwire instruction sheet for traditional title desks. */
export async function buildWireInstructionPdf(input: {
  dealId: string;
  address: string | null;
  zip: string | null;
  feeUsd: number;
}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const cfg = wireConfig();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.05, 0.07, 0.1);
  const accent = rgb(0.02, 0.45, 0.6);

  let y = 742;
  const t = (s: string, x: number, size = 10, f = font, c = ink) =>
    page.drawText(s, { x, y, size, font: f, color: c });

  t("FEDWIRE PAYMENT INSTRUCTIONS", 48, 18, bold, accent);
  y -= 16;
  t("Assignment Fee Settlement · Wire Only", 48, 9, font, rgb(0.4, 0.44, 0.5));
  y -= 20;
  page.drawLine({
    start: { x: 48, y },
    end: { x: 564, y },
    thickness: 1,
    color: accent,
  });
  y -= 28;

  const rows: Array<[string, string]> = [
    ["Beneficiary Name (EXACT)", cfg.beneficiary],
    ["Beneficiary Address", cfg.beneficiaryAddress ?? "On file with title desk"],
    ["Receiving Bank", cfg.bank],
    ["Bank Address", cfg.address],
    ["ABA / Routing Number", cfg.routing ?? "PENDING — request from Assignor"],
    ["Account Number", cfg.account ?? "PENDING — request from Assignor"],
    ["Wire Amount", money(input.feeUsd)],
    ["Reference / Memo", `Assignment Fee — Deal ${input.dealId.slice(0, 8)}`],
    ["Property", input.address ?? "—"],
    ["Property ZIP", input.zip ?? "—"],
  ];

  for (const [k, v] of rows) {
    t(k.toUpperCase(), 48, 8, bold, rgb(0.42, 0.46, 0.52));
    y -= 13;
    t(v, 48, 12, bold);
    y -= 22;
  }

  y -= 6;
  page.drawLine({
    start: { x: 48, y },
    end: { x: 564, y },
    thickness: 0.5,
    color: rgb(0.7, 0.72, 0.76),
  });
  y -= 20;
  t("CRITICAL — NAME MATCH NOTICE", 48, 10, bold, rgb(0.65, 0.1, 0.1));
  y -= 14;
  for (const line of [
    `The beneficiary name must be transmitted EXACTLY as: ${cfg.beneficiary}`,
    "No spaces inside \"ReelEdge\". Any variation (e.g. \"Real Edge\") will be",
    "rejected by the receiving bank and returned to the originator, delaying",
    "settlement by up to 5 business days.",
  ]) {
    t(line, 48, 9);
    y -= 12;
  }
  y -= 10;
  t(
    `Generated ${new Date().toISOString()} · Deal ${input.dealId}`,
    48,
    7,
    font,
    rgb(0.5, 0.53, 0.58),
  );

  return await pdf.save();
}

export type InvoiceResult =
  | { ok: true; invoice_id: string; url: string; reused: boolean }
  | { ok: false; status: number; error: string; detail?: string };

/**
 * Bluevine ACH debit request for algorithmic buyers.
 * Stripe is fully removed — proceeds settle natively into the Bluevine
 * business account via ACH/wire rails.
 */
export async function createAchInvoice(
  dealId: string,
  buyerEmail: string | null,
): Promise<InvoiceResult> {
  const { assertOutboundAllowed, KillSwitchError } = await import("./killswitch.server");
  try {
    await assertOutboundAllowed();
  } catch (e) {
    if (e instanceof KillSwitchError)
      return { ok: false, status: 503, error: "system_kill_switch" };
    throw e;
  }

  if (!dealId) return { ok: false, status: 400, error: "deal_id_required" };

  const { issueAchDebit, bluevineCoordinatesReady } = await import(
    "./bluevine-rails.server"
  );
  const { plaidConfigured } = await import("./plaid.server");
  if (!plaidConfigured() && !bluevineCoordinatesReady())
    return { ok: false, status: 500, error: "bluevine_coordinates_missing" };

  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const { data: deal, error } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id, zip, address, status, optimized_acquisition_premium, stripe_session_id, stripe_session_url",
    )
    .eq("id", dealId)
    .maybeSingle();

  if (error)
    return { ok: false, status: 500, error: "lookup_failed", detail: error.message };
  if (!deal) return { ok: false, status: 404, error: "deal_not_found" };
  if (deal.status === "Funds-Cleared" || deal.status === "Closed")
    return { ok: false, status: 409, error: "already_cleared" };

  const fee = Number(deal.optimized_acquisition_premium ?? 0);
  if (!isFinite(fee) || fee <= 0)
    return { ok: false, status: 422, error: "no_fee_on_deal" };

  if (deal.stripe_session_id && deal.stripe_session_url) {
    return {
      ok: true,
      invoice_id: deal.stripe_session_id,
      url: deal.stripe_session_url,
      reused: true,
    };
  }

  const rail = await issueAchDebit({
    dealId,
    amountUsd: fee,
    memo: `Assignment Fee — Deal ${dealId.slice(0, 8)} · ${deal.address ?? "\u2014"} (${deal.zip ?? "\u2014"}). Payable to ${BENEFICIARY_NAME}.`,
    counterpartyEmail: buyerEmail,
    counterpartyRef: dealId,
    idempotencyKey: `bv_invoice_${dealId}`,
  });

  if (!rail.ok)
    return {
      ok: false,
      status: 502,
      error: rail.error,
      ...(rail.detail ? { detail: rail.detail } : {}),
    };

  try {
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        stripe_session_id: rail.id,
        stripe_session_url: rail.url,
        stripe_session_expires_at: null,
      })
      .eq("id", dealId);
  } catch {}

  return { ok: true, invoice_id: rail.id, url: rail.url, reused: false };
}
