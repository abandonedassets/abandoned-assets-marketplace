// Blind Double-Escrow protocol: title/escrow officer instruction cover sheet.
// Attached to every executed contract package so the assignor spread is never
// exposed on a unified settlement statement.

export const BLIND_HUD_DIRECTIVE =
  "DOUBLE-ESCROW / ASSIGNMENT TRANSACTION. Separate closing statements required. " +
  "Buyer and Seller must NOT receive unified settlement disclosures revealing the assignor spread. " +
  "Issue an A-to-B settlement statement to Seller only and a B-to-C settlement statement to End Buyer only. " +
  "Do not cross-email parties. All correspondence routes through the Assignor of record.";

export type BlindHudSheet = {
  document: "TITLE_ESCROW_INSTRUCTION_COVER_SHEET";
  generated_at: string;
  assignor: string;
  asset: { id: string; address: string | null; apn: string | null };
  directive: string;
  instructions: string[];
};

export function buildBlindHudSheet(input: {
  dealId: string;
  address?: string | null;
  apn?: string | null;
  assignor?: string;
}): BlindHudSheet {
  return {
    document: "TITLE_ESCROW_INSTRUCTION_COVER_SHEET",
    generated_at: new Date().toISOString(),
    assignor: input.assignor ?? "ReelEdge Entertainment LLC",
    asset: { id: input.dealId, address: input.address ?? null, apn: input.apn ?? null },
    directive: BLIND_HUD_DIRECTIVE,
    instructions: [
      "Separate A-to-B and B-to-C settlement statements (HUD-1 / CD) are mandatory.",
      "Seller receives no disclosure of the assignment fee or end-buyer identity.",
      "End Buyer receives no disclosure of the original acquisition price or seller identity.",
      "No party-to-party email threads; escrow corresponds with the Assignor only.",
      "Assignment fee disburses to the Assignor at closing as a separate wire line item.",
      "Any request to merge statements must be refused and escalated to the Assignor.",
    ],
  };
}

export function blindHudHtml(sheet: BlindHudSheet): string {
  return `<div style="font:13px -apple-system,Segoe UI,sans-serif;border:1px solid #ccc;padding:12px;border-radius:6px">
    <h3 style="margin:0 0 6px">Title / Escrow Instruction Cover Sheet</h3>
    <p style="margin:0 0 8px"><b>${sheet.directive}</b></p>
    <ul style="margin:0;padding-left:18px">${sheet.instructions.map((i) => `<li>${i}</li>`).join("")}</ul>
  </div>`;
}
