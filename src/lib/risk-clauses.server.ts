// Asymmetric liability profile. Every auto-generated A-to-B agreement caps the
// assignor's maximum downside at the nominal EMD and waives specific performance.

export const LIQUIDATED_DAMAGES_CLAUSE =
  "SOLE AND EXCLUSIVE REMEDY / LIQUIDATED DAMAGES. In the event Buyer (Assignor) defaults, " +
  "Seller's sole and exclusive remedy shall be retention of the Earnest Money Deposit as full " +
  "liquidated damages, the parties agreeing that actual damages are impracticable to determine. " +
  "Seller expressly and irrevocably WAIVES any right to specific performance, injunctive relief, " +
  "consequential damages, or any other legal or equitable remedy against Buyer. Buyer's aggregate " +
  "liability under this Agreement shall never exceed the Earnest Money Deposit amount.";

export const NON_REPUDIATION_CLAUSE =
  "ELECTRONIC EXECUTION / NON-REPUDIATION. Signatory consents under E-SIGN and UETA to electronic " +
  "execution and acknowledges that IP address, device fingerprint, browser user-agent, and " +
  "millisecond-precision timestamps are captured as conclusive evidence of authorization for both " +
  "the assignment and the associated ACH debit. Signatory waives any claim of non-authorization.";

export const EQUITABLE_INTEREST_CLAUSE =
  "EQUITABLE INTEREST / MEMORANDUM. Upon execution, Buyer acquires equitable interest in the Property " +
  "and is irrevocably authorized to record a Memorandum of Contract against the Property. Seller shall " +
  "not convey, encumber, or contract the Property with any third party until this Agreement terminates " +
  "and Buyer records a release.";

export function riskClauseHtml(emdAmount?: number | null): string {
  const emd = emdAmount ? `$${Math.round(emdAmount).toLocaleString("en-US")}` : "the Earnest Money Deposit";
  return `<div style="font:12px -apple-system,Segoe UI,sans-serif;border-left:3px solid #999;padding:8px 12px;margin:12px 0;color:#333">
    <p style="margin:0 0 6px"><b>Liability Cap:</b> Assignor's maximum downside is capped at ${emd}.</p>
    <p style="margin:0 0 6px">${LIQUIDATED_DAMAGES_CLAUSE}</p>
    <p style="margin:0 0 6px">${EQUITABLE_INTEREST_CLAUSE}</p>
    <p style="margin:0">${NON_REPUDIATION_CLAUSE}</p>
  </div>`;
}
