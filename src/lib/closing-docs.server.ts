// In-house closing document engine. Generates the full pre-populated closing
// bundle (Blind HUD / ALTA settlement statement, A-B + B-C double-close
// contracts, transactional funding disclosure, escrow + wire instructions)
// with pdf-lib on the edge runtime. Fail-forward: never throws into the
// pipeline; returns { ok: false, error } instead.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { BLIND_HUD_DIRECTIVE, buildBlindHudSheet } from "./blind-hud.server";

const BUCKET = "closing-packages";

export type ClosingDeal = {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  apn: string | null;
  asset_type: string | null;
  base_contract_price: number | null;
  optimized_acquisition_premium: number | null;
  lien_total: number | null;
  emd_amount: number | null;
  matched_buyer_id: string | null;
  escrow_receipt_number?: string | null;
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

type Ctx = {
  pdf: PDFDocument;
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>;
};

function sheet(ctx: Ctx, title: string) {
  const page = ctx.pdf.addPage([612, 792]);
  let y = 748;
  page.drawText(title, { x: 48, y, size: 15, font: ctx.bold, color: rgb(0.05, 0.07, 0.1) });
  y -= 10;
  page.drawLine({
    start: { x: 48, y },
    end: { x: 564, y },
    thickness: 0.75,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= 20;

  const api = {
    line(text: string, opts?: { bold?: boolean; size?: number; indent?: number }) {
      const size = opts?.size ?? 9.5;
      const wrapped = wrap(text, opts?.bold ? 78 : 92);
      for (const w of wrapped) {
        if (y < 60) return;
        page.drawText(w, {
          x: 48 + (opts?.indent ?? 0),
          y,
          size,
          font: opts?.bold ? ctx.bold : ctx.font,
        });
        y -= size + 4;
      }
    },
    row(label: string, value: string) {
      if (y < 60) return;
      page.drawText(label, { x: 48, y, size: 9.5, font: ctx.bold });
      page.drawText(value, { x: 300, y, size: 9.5, font: ctx.font });
      y -= 14;
    },
    gap(n = 10) {
      y -= n;
    },
    rule() {
      page.drawLine({
        start: { x: 48, y: y + 6 },
        end: { x: 564, y: y + 6 },
        thickness: 0.5,
        color: rgb(0.75, 0.75, 0.75),
      });
      y -= 8;
    },
  };
  return api;
}

function wrap(text: string, max: number): string[] {
  const words = String(text).split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      out.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [""];
}

const parcel = (d: ClosingDeal) =>
  [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ") || `APN ${d.apn ?? "—"}`;

/** Blind HUD / ALTA-style settlement statement (separate A-B and B-C columns). */
export function buildBlindHud(ctx: Ctx, d: ClosingDeal) {
  const price = Number(d.base_contract_price) || 0;
  const fee = Number(d.optimized_acquisition_premium) || 0;
  const liens = Number(d.lien_total) || 0;
  const hud = buildBlindHudSheet({ dealId: d.id, address: d.address, apn: d.apn });

  const p = sheet(ctx, "ALTA SETTLEMENT STATEMENT — BLIND (DOUBLE ESCROW)");
  p.row("Deal ID", d.id);
  p.row("Property", parcel(d));
  p.row("APN / County", `${d.apn ?? "—"} / ${d.county ?? "—"}`);
  p.row("Escrow File", d.escrow_receipt_number ?? "PENDING TITLE ASSIGNMENT");
  p.gap();
  p.line("LEG A → B (SELLER SIDE)", { bold: true });
  p.rule();
  p.row("Contract sales price", money(price));
  p.row("Recorded lien payoffs", money(-liens));
  p.row("Net proceeds to Seller", money(Math.max(0, price - liens)));
  p.gap();
  p.line("LEG B → C (END BUYER SIDE)", { bold: true });
  p.rule();
  p.row("Assignment / resale price", money(price + fee));
  p.row("Assignment fee to Assignor", money(fee));
  p.row("Transactional funding fee", money(Math.round(price * 0.01)));
  p.row("Earnest money on deposit", money(d.emd_amount ?? 100));
  p.gap(14);
  p.line("ESCROW OFFICER DIRECTIVE", { bold: true });
  p.rule();
  p.line(BLIND_HUD_DIRECTIVE);
  p.gap();
  for (const i of hud.instructions) p.line(`• ${i}`, { indent: 8 });
}

/** A-B seller contract, B-C buyer contract, transactional funding disclosure. */
export function buildDoubleCloseContracts(ctx: Ctx, d: ClosingDeal) {
  const price = Number(d.base_contract_price) || 0;
  const fee = Number(d.optimized_acquisition_premium) || 0;

  const a = sheet(ctx, "PURCHASE & SALE AGREEMENT — LEG A (SELLER → ASSIGNOR)");
  a.row("Deal ID", d.id);
  a.row("Property", parcel(d));
  a.row("Purchase price", money(price));
  a.row("Earnest money", money(d.emd_amount ?? 100));
  a.row("Closing", "On or before 30 days from full execution");
  a.gap();
  a.line(
    "Buyer of record is the Assignor. Buyer reserves the unrestricted right to assign, " +
      "double close, or wrap this agreement into an entity of its choosing without further " +
      "consent of Seller. Seller conveys marketable title free of liens except those paid " +
      "through escrow at closing. Property is conveyed AS-IS; inspection contingency waived " +
      "at expiration of the diligence window.",
  );
  a.gap();
  a.row("Seller signature", "____________________________");
  a.row("Assignor signature", "____________________________");

  const b = sheet(ctx, "PURCHASE & SALE AGREEMENT — LEG B (ASSIGNOR → END BUYER)");
  b.row("Deal ID", d.id);
  b.row("Property", parcel(d));
  b.row("Resale price", money(price + fee));
  b.row("Assignment spread", money(fee));
  b.row("End buyer of record", d.matched_buyer_id ?? "TO BE COMPLETED AT ASSIGNMENT");
  b.gap();
  b.line(
    "Seller of record in this leg is the Assignor, holding equitable interest under the Leg A " +
      "agreement. Anti-circumvention applies: End Buyer shall not contract directly with the " +
      "Leg A seller for 24 months. Settlement is simultaneous or same-day sequential at the " +
      "escrow agent named in the escrow instructions of this package.",
  );
  b.gap();
  b.row("Assignor signature", "____________________________");
  b.row("End buyer signature", "____________________________");

  const t = sheet(ctx, "TRANSACTIONAL FUNDING DISCLOSURE");
  t.row("Deal ID", d.id);
  t.row("Funding amount (Leg A)", money(price));
  t.row("Estimated funding fee", money(Math.round(price * 0.01)));
  t.row("Term", "Same-day (A-B and B-C settle within one business day)");
  t.gap();
  t.line(
    "Both parties acknowledge the Leg A acquisition may be funded by a transactional lender " +
      "whose capital is repaid from the Leg B settlement proceeds. The funding fee is a cost " +
      "of the Assignor and is not charged to Seller or End Buyer. Separate settlement " +
      "statements are required; no unified disclosure will be issued.",
  );
}

/** Escrow instructions + wire coordinates tagged with the deal ID. */
export function buildEscrowInstructions(ctx: Ctx, d: ClosingDeal) {
  const price = Number(d.base_contract_price) || 0;
  const fee = Number(d.optimized_acquisition_premium) || 0;
  const p = sheet(ctx, "ESCROW INSTRUCTIONS & WIRE AUTHORIZATION");
  p.row("Deal ID", d.id);
  p.row("Property", parcel(d));
  p.row("Escrow file", d.escrow_receipt_number ?? "PENDING TITLE ASSIGNMENT");
  p.row("EMD required", money(d.emd_amount ?? 100));
  p.row("Assignment fee disbursement", money(fee));
  p.row("Gross settlement (Leg B)", money(price + fee));
  p.gap();
  p.line("INSTRUCTIONS TO SETTLEMENT AGENT", { bold: true });
  p.rule();
  p.line(`• Reference every wire and document with Deal ID ${d.id}.`);
  p.line("• Hold EMD in trust; release only upon recorded Leg A deed or written Assignor consent.");
  p.line("• Disburse the assignment fee to the Assignor as a discrete wire line item.");
  p.line("• Issue separate A-B and B-C settlement statements; do not merge disclosures.");
  p.line("• Return the executed closing package and recorded instruments to the Assignor of record.");
  p.gap();
  p.line("TRANSACTIONAL FUNDING REQUEST", { bold: true });
  p.rule();
  p.line(`Requested advance: ${money(price)} — repayment same-day from Leg B proceeds.`);
  p.line("Collateral: equitable interest under the Leg A purchase agreement for the parcel above.");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type ClosingBundleResult =
  | { ok: true; url: string | null; path: string; hash: string; bytes: number }
  | { ok: false; error: string };

/**
 * Assemble the full closing bundle for a deal, stamp it with a SHA-256
 * integrity hash, upload to the closing-packages bucket, and write the
 * pointer back onto the deal row.
 */
export async function buildClosingBundle(dealId: string): Promise<ClosingBundleResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,address,city,state,zip,county,apn,asset_type,base_contract_price,optimized_acquisition_premium,lien_total,emd_amount,matched_buyer_id",
      )
      .eq("id", dealId)
      .maybeSingle();
    if (!data) return { ok: false, error: "deal_not_found" };
    const d = data as unknown as ClosingDeal;

    const pdf = await PDFDocument.create();
    const ctx: Ctx = {
      pdf,
      font: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    };

    buildBlindHud(ctx, d);
    buildDoubleCloseContracts(ctx, d);
    buildEscrowInstructions(ctx, d);

    pdf.setTitle(`Closing Package — ${parcel(d)}`);
    pdf.setAuthor("Settlement Terminal");
    pdf.setSubject(`deal:${d.id}`);
    pdf.setProducer("Settlement Terminal Closing Engine");
    pdf.setCreationDate(new Date());

    const bytes = await pdf.save();
    const hash = await sha256Hex(bytes);
    pdf.setKeywords([JSON.stringify({ deal_id: d.id, sha256: hash })]);
    const finalBytes = await pdf.save();

    const path = `${d.id}/closing-package-${Date.now()}.pdf`;
    const up = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, finalBytes as unknown as ArrayBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (up.error) return { ok: false, error: up.error.message };

    const signed = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 30);

    const url = signed.data?.signedUrl ?? null;

    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        closing_bundle_url: url,
        closing_bundle_path: path,
        closing_bundle_hash: hash,
        closing_bundle_generated_at: new Date().toISOString(),
      } as never)
      .eq("id", d.id);

    return { ok: true, url, path, hash, bytes: finalBytes.length };
  } catch (e) {
    console.error("[closing-docs] bundle failed", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Raw bytes of the current bundle (regenerates if absent) — used for e-sign attachments. */
export async function getClosingBundleUrl(dealId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("closing_bundle_url,closing_bundle_path")
    .eq("id", dealId)
    .maybeSingle();
  const row = data as any;
  if (row?.closing_bundle_path) {
    const signed = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(row.closing_bundle_path, 60 * 60 * 24 * 7);
    if (signed.data?.signedUrl) return signed.data.signedUrl;
  }
  if (row?.closing_bundle_url) return row.closing_bundle_url as string;
  const built = await buildClosingBundle(dealId);
  return built.ok ? built.url : null;
}
