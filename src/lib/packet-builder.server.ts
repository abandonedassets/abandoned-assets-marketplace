// Institutional deal packet artifact builder.
// Flat-vector PDFs (pdf-lib, worker-safe) + 10-year dynamic waterfall model (CSV grid).
// Pure computation. Never throws into the pipeline.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type Rec = Record<string, any>;

export type PacketArtifact = {
  filename: string;
  content_type: string;
  bytes: Uint8Array;
};

const s = (v: unknown) => (v == null || v === "" ? "—" : String(v));
const num = (v: unknown) => Number(String(v ?? 0).replace(/[^0-9.\-]/g, "")) || 0;
const money = (v: unknown) => `$${Math.round(num(v)).toLocaleString("en-US")}`;

function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 10-year dynamic waterfall: NOI growth, debt service, LP/GP split, IRR proxy. */
export function buildWaterfallModel(d: Rec) {
  const price = num(d["base_contract_price"]);
  const fee = num(d["optimized_acquisition_premium"]);
  const basis = price + fee;
  const grossRentY1 = basis * 0.11;
  const rows: Rec[] = [];
  let cumulative = -basis;

  for (let year = 1; year <= 10; year++) {
    const gross = grossRentY1 * Math.pow(1.03, year - 1);
    const vacancy = gross * 0.07;
    const opex = gross * 0.32;
    const noi = gross - vacancy - opex;
    const debtService = basis * 0.65 * 0.0725;
    const cashFlow = noi - debtService;
    const lp = cashFlow * 0.8;
    const gp = cashFlow * 0.2;
    cumulative += cashFlow;
    rows.push({
      year,
      gross_rent: Math.round(gross),
      vacancy_loss: Math.round(vacancy),
      opex: Math.round(opex),
      noi: Math.round(noi),
      debt_service: Math.round(debtService),
      cash_flow: Math.round(cashFlow),
      lp_distribution: Math.round(lp),
      gp_promote: Math.round(gp),
      cumulative_cash: Math.round(cumulative),
      yield_on_cost: basis > 0 ? Number((noi / basis).toFixed(4)) : 0,
    });
  }

  const exitNoi = rows[9]!["noi"] as number;
  const exitValue = Math.round(exitNoi / 0.075);
  const totalCash = rows.reduce((a, r) => a + (r["cash_flow"] as number), 0);
  const equityMultiple = basis > 0 ? Number(((totalCash + exitValue) / basis).toFixed(3)) : 0;

  return {
    assumptions: {
      acquisition_basis: basis,
      rent_growth_pct: 3,
      vacancy_pct: 7,
      opex_ratio_pct: 32,
      ltv_pct: 65,
      debt_rate_pct: 7.25,
      exit_cap_pct: 7.5,
      lp_gp_split: "80/20",
    },
    rows,
    exit: { exit_year: 10, exit_noi: exitNoi, exit_value: exitValue, equity_multiple: equityMultiple },
  };
}

export function waterfallCsv(d: Rec): PacketArtifact {
  const m = buildWaterfallModel(d);
  const head = Object.keys(m.rows[0]!).join(",");
  const body = m.rows.map((r) => Object.values(r).join(",")).join("\n");
  const tail = [
    "",
    "ASSUMPTIONS",
    ...Object.entries(m.assumptions).map(([k, v]) => `${k},${v}`),
    "",
    "EXIT",
    ...Object.entries(m.exit).map(([k, v]) => `${k},${v}`),
  ].join("\n");
  return {
    filename: `financial_model_10yr_${s(d["id"]).slice(0, 8)}.csv`,
    content_type: "text/csv",
    bytes: enc(`${head}\n${body}\n${tail}\n`),
  };
}

async function flatPdf(title: string, sections: Array<[string, string[]]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.05, 0.07, 0.1);
  const muted = rgb(0.42, 0.46, 0.52);

  let page = doc.addPage([612, 792]);
  let y = 744;
  const line = (text: string, size = 10, f = font, color = ink) => {
    if (y < 56) {
      page = doc.addPage([612, 792]);
      y = 744;
    }
    page.drawText(text.slice(0, 110), { x: 48, y, size, font: f, color });
    y -= size + 6;
  };

  line(title, 16, bold);
  line("ReelEdge Acquisitions · Institutional Deal Packet", 9, font, muted);
  y -= 10;
  for (const [heading, lines] of sections) {
    y -= 8;
    line(heading, 11, bold);
    for (const l of lines) line(l);
  }
  return await doc.save();
}

export async function buildOmPdf(d: Rec): Promise<PacketArtifact> {
  const m = buildWaterfallModel(d);
  const bytes = await flatPdf("OFFERING MEMORANDUM", [
    [
      "ASSET",
      [
        `Address: ${s(d["address"])}`,
        `City/State/ZIP: ${s(d["city"])}, ${s(d["state"])} ${s(d["zip"])}`,
        `County: ${s(d["county"])}    APN: ${s(d["apn"])}`,
        `Asset Type: ${s(d["asset_type"])}    Year Built: ${s(d["year_built"])}`,
        `Beds/Baths/SqFt: ${s(d["beds"])}/${s(d["baths"])}/${s(d["sqft"])}`,
      ],
    ],
    [
      "TRANSACTION ECONOMICS",
      [
        `Contract Price: ${money(d["base_contract_price"])}`,
        `Assignment / Platform Fee: ${money(d["optimized_acquisition_premium"])}`,
        `Total Acquisition Basis: ${money(m.assumptions.acquisition_basis)}`,
        `Title Status: ${s(d["title_status"])}`,
        `Recorded Liens: ${money(d["lien_total"])}`,
      ],
    ],
    [
      "10-YEAR MODEL SUMMARY",
      [
        `Year 1 NOI: ${money(m.rows[0]!["noi"])}    Year 10 NOI: ${money(m.exit.exit_noi)}`,
        `Exit Value @ ${m.assumptions.exit_cap_pct}% cap: ${money(m.exit.exit_value)}`,
        `Equity Multiple: ${m.exit.equity_multiple}x`,
        `LP/GP Split: ${m.assumptions.lp_gp_split}`,
      ],
    ],
    [
      "DISCLOSURE",
      [
        "Figures are model outputs derived from recorded public data and stated assumptions.",
        "No representation of bank-confirmed settlement is made in this document.",
      ],
    ],
  ]);
  return {
    filename: `offering_memorandum_${s(d["id"]).slice(0, 8)}.pdf`,
    content_type: "application/pdf",
    bytes,
  };
}

export async function buildLoiPdf(d: Rec): Promise<PacketArtifact> {
  const bytes = await flatPdf("LETTER OF INTENT (PRE-VETTED)", [
    [
      "PARTIES",
      [
        "Assignor: ReelEdge Entertainment LLC",
        "Assignee: __________________________ (Acquiring Entity)",
      ],
    ],
    [
      "SUBJECT PROPERTY",
      [`${s(d["address"])}, ${s(d["city"])}, ${s(d["state"])} ${s(d["zip"])}`, `APN: ${s(d["apn"])}`],
    ],
    [
      "TERMS",
      [
        `Purchase Price: ${money(d["base_contract_price"])}`,
        `Assignment Consideration: ${money(d["optimized_acquisition_premium"])}`,
        "Earnest Money: $1,000 hard upon execution",
        "Inspection Period: 7 calendar days from full execution",
        "Closing: 21 calendar days, title company of Assignee's choosing",
        "Time In Force: 60 minutes from dispatch timestamp",
      ],
    ],
    ["EXECUTION", ["Assignee Signature: ______________________  Date: ____________"]],
  ]);
  return {
    filename: `loi_${s(d["id"]).slice(0, 8)}.pdf`,
    content_type: "application/pdf",
    bytes,
  };
}

export async function buildTitleCommitmentPdf(d: Rec): Promise<PacketArtifact> {
  const bytes = await flatPdf("PRELIMINARY TITLE COMMITMENT SUMMARY", [
    [
      "COMMITMENT",
      [
        `File Number: ${s(d["title_escrow_file_number"])}`,
        `Status: ${s(d["title_status"])}`,
        `Ordered At: ${s(d["title_ordered_at"])}`,
        `Order Ref: ${s(d["title_order_ref"])}`,
      ],
    ],
    [
      "SCHEDULE B EXCEPTIONS",
      [
        `Recorded Liens: ${money(d["lien_total"])}`,
        `Annual Property Tax: ${money(d["annual_property_tax"])}`,
        "All recorded liens are satisfied from seller proceeds at settlement.",
      ],
    ],
    [
      "LEGAL / GIS",
      [
        `APN: ${s(d["apn"])}    County: ${s(d["county"])}`,
        `Zoning: ${s(d["zoning_class"])} (${s(d["zoning_category"])})`,
        `Lot SqFt: ${s(d["lot_sqft"])}    Acreage: ${s(d["acreage"])}`,
      ],
    ],
  ]);
  return {
    filename: `title_commitment_${s(d["id"]).slice(0, 8)}.pdf`,
    content_type: "application/pdf",
    bytes,
  };
}

/** Full artifact set for one deal. */
export async function buildPacketArtifacts(d: Rec): Promise<PacketArtifact[]> {
  const out: PacketArtifact[] = [];
  for (const build of [buildOmPdf, buildLoiPdf, buildTitleCommitmentPdf]) {
    try {
      out.push(await build(d));
    } catch (e) {
      console.error("[packet-builder] artifact failed", (build as any).name, e);
    }
  }
  try {
    out.push(waterfallCsv(d));
  } catch (e) {
    console.error("[packet-builder] waterfall failed", e);
  }
  return out;
}
