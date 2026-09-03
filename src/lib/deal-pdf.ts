import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type Rec = Record<string, unknown>;

const s = (v: unknown) => (v == null || v === "" ? "—" : String(v));
const money = (v: unknown) =>
  v == null ? "—" : `$${Math.round(Number(v)).toLocaleString()}`;

async function download(doc: PDFDocument, filename: string) {
  const bytes = await doc.save();
  const blob = new Blob([bytes as unknown as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 1-page development site sheet for manual distribution to local homebuilders. */
export async function generateSiteSheet(r: Rec) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.05, 0.07, 0.1);
  const accent = rgb(0.02, 0.55, 0.7);
  let y = 740;

  page.drawText("DEVELOPMENT SITE SHEET", { x: 48, y, size: 18, font: bold, color: accent });
  y -= 18;
  page.drawText("ReelEdge Entertainment LLC · Off-Market Land & Infill Desk", {
    x: 48, y, size: 9, font, color: rgb(0.4, 0.44, 0.5),
  });
  y -= 26;
  page.drawLine({ start: { x: 48, y }, end: { x: 564, y }, thickness: 1, color: accent });
  y -= 30;

  page.drawText(s(r["address"]), { x: 48, y, size: 14, font: bold, color: ink });
  y -= 16;
  page.drawText(
    [s(r["city"]), s(r["state"]), s(r["zip"])].join(", ") +
      (r["county"] ? ` · ${s(r["county"])} County` : ""),
    { x: 48, y, size: 10, font, color: rgb(0.35, 0.38, 0.44) },
  );
  y -= 34;

  const sections: Array<[string, Array<[string, string]>]> = [
    ["SITE & ZONING", [
      ["Zoning Class", s(r["zoning_class"])],
      ["Lot Size (sq ft)", r["lot_sqft"] ? Number(r["lot_sqft"]).toLocaleString() : "—"],
      ["Building SqFt", r["sqft"] ? Number(r["sqft"]).toLocaleString() : "—"],
      ["Year Built", s(r["year_built"])],
      ["APN", s(r["apn"])],
      ["Asset Type", s(r["asset_type"])],
    ]],
    ["UTILITIES & IMPROVEMENTS", [
      ["Water / Sewer", "Municipal connection at street (verify with county)"],
      ["Electric / Gas", "Existing service to parcel (verify with utility)"],
      ["Access", "Paved public right-of-way frontage"],
      ["Existing Structure", r["year_built"] ? "Yes — teardown/rehab candidate" : "None — vacant dirt"],
    ]],
    ["FINANCIAL", [
      ["Contract Price", money(r["base_contract_price"])],
      ["Assessed Value", money(r["assessed_value"])],
      ["Annual Property Tax", money(r["annual_property_tax"])],
      ["Recorded Liens", money(r["lien_total"])],
      ["Owner of Record", s(r["owner_entity"])],
    ]],
  ];

  for (const [title, rows] of sections) {
    page.drawText(title, { x: 48, y, size: 9, font: bold, color: accent });
    y -= 14;
    for (const [k, v] of rows) {
      page.drawText(k, { x: 56, y, size: 10, font, color: rgb(0.42, 0.45, 0.5) });
      page.drawText(v, { x: 280, y, size: 10, font: bold, color: ink });
      y -= 15;
    }
    y -= 12;
  }

  const tags = Array.isArray(r["enrichment_tags"]) ? (r["enrichment_tags"] as string[]) : [];
  if (tags.length) {
    page.drawText("TAGS", { x: 48, y, size: 9, font: bold, color: accent });
    y -= 14;
    page.drawText(tags.join("  ·  "), { x: 56, y, size: 9, font, color: ink });
    y -= 20;
  }

  page.drawText(
    "Information deemed reliable but not guaranteed. Buyer to verify all zoning, utility and survey data independently.",
    { x: 48, y: 60, size: 7.5, font, color: rgb(0.5, 0.53, 0.58) },
  );
  page.drawText(`Generated ${new Date().toLocaleString()}`, {
    x: 48, y: 46, size: 7.5, font, color: rgb(0.5, 0.53, 0.58),
  });

  await download(doc, `site-sheet-${s(r["id"]).slice(0, 8)}.pdf`);
}

/** Mutual Release of Purchase Agreement naming ReelEdge Entertainment LLC as releasing party. */
export async function generateMutualRelease(r: Rec) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.05, 0.07, 0.1);
  let y = 740;

  const wrap = (text: string, size = 10, lead = 14) => {
    const max = 88;
    const words = text.split(" ");
    let line = "";
    for (const w of words) {
      if ((line + w).length > max) {
        page.drawText(line, { x: 48, y, size, font, color: ink });
        y -= lead;
        line = "";
      }
      line += w + " ";
    }
    if (line.trim()) {
      page.drawText(line, { x: 48, y, size, font, color: ink });
      y -= lead;
    }
    y -= 8;
  };

  page.drawText("MUTUAL RELEASE OF PURCHASE AGREEMENT", { x: 48, y, size: 14, font: bold, color: ink });
  y -= 30;

  const addr = [s(r["address"]), s(r["city"]), s(r["state"]), s(r["zip"])].join(", ");
  wrap(
    `This Mutual Release ("Release") is entered into as of ${new Date().toLocaleDateString()} by and between ReelEdge Entertainment LLC ("Buyer/Assignor") and the record owner(s) of the real property commonly known as ${addr} ("Seller"), collectively the "Parties".`,
  );
  wrap(
    `WHEREAS, the Parties entered into a Purchase and Sale Agreement (the "Agreement") concerning the Property, with a stated contract price of ${money(r["base_contract_price"])}${r["apn"] ? `, APN ${s(r["apn"])}` : ""};`,
  );
  wrap(
    "WHEREAS, the Parties mutually desire to terminate the Agreement and release one another from any and all obligations arising thereunder;",
  );
  wrap(
    "NOW THEREFORE, for good and valuable consideration, the receipt and sufficiency of which is acknowledged, the Parties agree as follows:",
  );
  wrap(
    "1. TERMINATION. The Agreement is terminated in its entirety effective as of the date first written above, and is of no further force or effect.",
  );
  wrap(
    "2. MUTUAL RELEASE. Each Party hereby fully and forever releases, acquits and discharges the other Party, and its members, managers, officers, agents, successors and assigns, from any and all claims, demands, damages, liabilities, causes of action, equitable interests, liens, and clouds on title of any kind, whether known or unknown, arising out of or relating to the Agreement or the Property.",
  );
  wrap(
    "3. RELEASE OF EQUITABLE INTEREST. ReelEdge Entertainment LLC expressly disclaims and releases any equitable interest, memorandum of contract, affidavit of interest, or other encumbrance it may hold against the Property, and shall execute any instrument reasonably necessary to clear title of record.",
  );
  wrap(
    "4. EARNEST MONEY. Any earnest money deposit held in escrow shall be returned to the depositing Party, and escrow shall be closed without further obligation of either Party.",
  );
  wrap(
    "5. ENTIRE AGREEMENT. This Release contains the entire understanding of the Parties and supersedes all prior negotiations. It may be executed in counterparts, including by electronic signature.",
  );

  y -= 20;
  const sigY = Math.max(y, 170);
  page.drawText("BUYER / ASSIGNOR", { x: 48, y: sigY, size: 9, font: bold, color: ink });
  page.drawLine({ start: { x: 48, y: sigY - 34 }, end: { x: 280, y: sigY - 34 }, thickness: 0.8, color: ink });
  page.drawText("ReelEdge Entertainment LLC, by its Authorized Member", {
    x: 48, y: sigY - 46, size: 8, font, color: rgb(0.4, 0.43, 0.48),
  });

  page.drawText("SELLER", { x: 332, y: sigY, size: 9, font: bold, color: ink });
  page.drawLine({ start: { x: 332, y: sigY - 34 }, end: { x: 564, y: sigY - 34 }, thickness: 0.8, color: ink });
  page.drawText(s(r["owner_entity"]) === "—" ? "Record Owner" : s(r["owner_entity"]), {
    x: 332, y: sigY - 46, size: 8, font, color: rgb(0.4, 0.43, 0.48),
  });

  page.drawText(
    "This document is a template and is not legal advice. Have counsel review before execution.",
    { x: 48, y: 48, size: 7.5, font, color: rgb(0.5, 0.53, 0.58) },
  );

  await download(doc, `mutual-release-${s(r["id"]).slice(0, 8)}.pdf`);
}

/**
 * Assignment / Novation agreement with the four Titanic safety bulkheads:
 * anti-circumvention, 24h non-refundable EMD, inspection termination,
 * and automatic double-close switch above the novation threshold.
 */
export async function generateAssignmentAgreement(
  r: Rec,
  opts?: { penaltyUsd?: number; emdMinUsd?: number; novationThresholdUsd?: number },
) {
  const penalty = opts?.penaltyUsd ?? 25000;
  const emdMin = opts?.emdMinUsd ?? 2500;
  const novationAt = opts?.novationThresholdUsd ?? 20000;
  const fee = Number(r["optimized_acquisition_premium"] ?? 0);
  const doubleClose = fee > novationAt;
  const emd = Math.max(emdMin, Math.round(fee * 0.1));

  const doc = await PDFDocument.create();
  let page = doc.addPage([612, 792]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.05, 0.07, 0.1);
  let y = 740;

  const nl = (n = 8) => {
    y -= n;
  };
  const guard = () => {
    if (y < 90) {
      page = doc.addPage([612, 792]);
      y = 740;
    }
  };
  const head = (t: string, size = 10) => {
    guard();
    page.drawText(t, { x: 48, y, size, font: bold, color: ink });
    y -= size + 6;
  };
  const wrap = (text: string, size = 10, lead = 14) => {
    const max = 92;
    const words = text.split(" ");
    let line = "";
    for (const w of words) {
      if ((line + w).length > max) {
        guard();
        page.drawText(line, { x: 48, y, size, font, color: ink });
        y -= lead;
        line = "";
      }
      line += w + " ";
    }
    if (line.trim()) {
      guard();
      page.drawText(line, { x: 48, y, size, font, color: ink });
      y -= lead;
    }
    nl();
  };

  head(
    doubleClose
      ? "NOVATION / DOUBLE-CLOSE PURCHASE AGREEMENT"
      : "ASSIGNMENT OF PURCHASE AGREEMENT",
    14,
  );
  const addr = [s(r["address"]), s(r["city"]), s(r["state"]), s(r["zip"])].join(", ");
  wrap(
    `This Agreement is entered into as of ${new Date().toLocaleDateString()} between ReelEdge Entertainment LLC ("Assignor") and the undersigned purchaser ("Assignee") concerning the real property commonly known as ${addr}${r["apn"] ? `, APN ${s(r["apn"])}` : ""} (the "Property").`,
  );
  wrap(
    `Underlying contract price: ${money(r["base_contract_price"])}. Consideration payable to Assignor: ${money(fee)}. Structure: ${doubleClose ? "A-to-B / B-to-C double close (novation)" : "purchase option assignment"}.`,
  );

  head("1. NON-CIRCUMVENTION SHIELD");
  wrap(
    `Assignee agrees strictly not to contact the underlying Property Owner (Seller) directly. Any direct contact, attempt to re-negotiate, or bypass of Assignor shall immediately void Assignee's purchase right and incur liquidated damages of ${money(penalty)} payable to Assignor.`,
  );

  head("2. HARDENED EARNEST MONEY DEPOSIT LOCK");
  wrap(
    `This Agreement is not legally binding until Assignee places a non-refundable Earnest Money Deposit of ${money(emd)} (the greater of ${money(emdMin)} or 10% of the total fee) into escrow within twenty-four (24) hours of execution. Failure to deposit auto-terminates this Agreement and releases the deal back to the active stream.`,
  );

  head("3. INSPECTION PERIOD DEAD-MAN'S SWITCH");
  wrap(
    "Upon Assignee's execution of this Agreement, all inspection contingencies inherited from the underlying contract are deemed satisfied and waived in full.",
  );

  head("4. NOVATION / DOUBLE-CLOSE CIRCUIT BREAKER");
  wrap(
    doubleClose
      ? `Because consideration exceeds ${money(novationAt)}, this transaction is automatically structured as an A-to-B / B-to-C double close or novation. Assignee acknowledges Assignor takes title of record prior to conveyance and that Assignor's margin is not disclosed.`
      : `Should consideration exceed ${money(novationAt)}, or should county or state law restrict wholesale assignments, this Agreement automatically converts to an A-to-B / B-to-C double close or novation agreement without further action by either party.`,
  );

  nl(16);
  const sigY = Math.max(y, 160);
  page.drawText("ASSIGNOR", { x: 48, y: sigY, size: 9, font: bold, color: ink });
  page.drawLine({
    start: { x: 48, y: sigY - 34 },
    end: { x: 280, y: sigY - 34 },
    thickness: 0.8,
    color: ink,
  });
  page.drawText("ReelEdge Entertainment LLC, by its Authorized Member", {
    x: 48, y: sigY - 46, size: 8, font, color: rgb(0.4, 0.43, 0.48),
  });
  page.drawText("ASSIGNEE", { x: 332, y: sigY, size: 9, font: bold, color: ink });
  page.drawLine({
    start: { x: 332, y: sigY - 34 },
    end: { x: 564, y: sigY - 34 },
    thickness: 0.8,
    color: ink,
  });
  page.drawText("Purchaser / Authorized Signatory", {
    x: 332, y: sigY - 46, size: 8, font, color: rgb(0.4, 0.43, 0.48),
  });
  page.drawText(
    "This document is a template and is not legal advice. Have counsel review before execution.",
    { x: 48, y: 48, size: 7.5, font, color: rgb(0.5, 0.53, 0.58) },
  );

  await download(doc, `assignment-${s(r["id"]).slice(0, 8)}.pdf`);
}

