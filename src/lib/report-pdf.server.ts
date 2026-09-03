import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type DealRow = {
  id: string;
  zip: string | null;
  status: string | null;
  base_contract_price: number | null;
  optimized_acquisition_premium: number | null;
  updated_at: string | null;
};

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Adds a SHA-256 checksum field to the JSON payload (integrity proof). */
export async function withChecksum<T extends Record<string, unknown>>(payload: T) {
  const canonical = JSON.stringify(payload);
  const checksum = await sha256Hex(canonical);
  return { ...payload, checksum_algorithm: "SHA-256", checksum };
}

const money = (n: number | null | undefined) =>
  n == null ? "-" : `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Deterministic vector PDF of the deal tape. Rendered with pdf-lib rather than a
 * headless browser: the deployment target is an edge worker, where Puppeteer/Chromium
 * cannot run.
 */
export async function renderDealReportPdf(rows: DealRow[]) {
  const totals = rows.reduce(
    (acc, r) => {
      acc.contract += r.base_contract_price ?? 0;
      acc.premium += r.optimized_acquisition_premium ?? 0;
      return acc;
    },
    { contract: 0, premium: 0 },
  );

  const payload = await withChecksum({
    report_type: "deal_summary",
    generated_at: new Date().toISOString(),
    row_count: rows.length,
    totals,
    rows,
  });

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const cols = [40, 190, 250, 340, 440, 520];
  const headers = ["DEAL ID", "ZIP", "STATUS", "CONTRACT", "FEE", "UPDATED"];
  const perPage = 40;

  for (let start = 0; start < Math.max(rows.length, 1); start += perPage) {
    const page = pdf.addPage([612, 792]);
    let y = 750;
    page.drawText("DEAL SUMMARY REPORT", { x: 40, y, size: 16, font: bold });
    y -= 16;
    page.drawText(`Generated ${payload.generated_at}  |  ${rows.length} rows`, {
      x: 40,
      y,
      size: 8,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    y -= 24;
    headers.forEach((h, i) =>
      page.drawText(h, { x: cols[i]!, y, size: 8, font: bold }),
    );
    y -= 6;
    page.drawLine({
      start: { x: 40, y },
      end: { x: 572, y },
      thickness: 0.75,
      color: rgb(0.7, 0.7, 0.7),
    });
    y -= 12;

    for (const r of rows.slice(start, start + perPage)) {
      const cells = [
        (r.id ?? "").slice(0, 24),
        r.zip ?? "-",
        (r.status ?? "-").slice(0, 16),
        money(r.base_contract_price),
        money(r.optimized_acquisition_premium),
        (r.updated_at ?? "").slice(0, 10),
      ];
      cells.forEach((c, i) =>
        page.drawText(String(c), { x: cols[i]!, y, size: 7.5, font }),
      );
      y -= 13;
    }

    if (start + perPage >= rows.length) {
      y -= 8;
      page.drawLine({
        start: { x: 40, y: y + 6 },
        end: { x: 572, y: y + 6 },
        thickness: 0.75,
        color: rgb(0.7, 0.7, 0.7),
      });
      page.drawText(
        `TOTAL CONTRACT ${money(totals.contract)}    TOTAL FEES ${money(totals.premium)}`,
        { x: 40, y: y - 6, size: 9, font: bold },
      );
    }
  }

  // Standard document properties (Dublin Core / XMP-backed fields).
  pdf.setTitle("Deal Summary Report");
  pdf.setAuthor("Settlement Terminal");
  pdf.setSubject(`sha256:${payload.checksum}`);
  pdf.setProducer("Settlement Terminal Report Engine");
  pdf.setCreator("Settlement Terminal");
  pdf.setCreationDate(new Date());
  // Machine-readable payload embedded in file properties so the admin dashboard
  // can read report data natively without OCR/text scraping.
  pdf.setKeywords([JSON.stringify(payload)]);

  const bytes = await pdf.save();
  return { bytes, checksum: payload.checksum, payload };
}
