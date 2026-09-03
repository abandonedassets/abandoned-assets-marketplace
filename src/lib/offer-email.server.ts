import { maskedLabel } from "./address-mask";
// Text-first institutional transaction notice. No graphics, no multi-column HTML.
import { appBaseUrl } from "./links";

export type ContractData = {
  id: string;
  external_id?: string | null;
  apn?: string | null;
  zip?: string | null;
  city?: string | null;
  address?: string | null;
  base_contract_price?: number | null;
  optimized_acquisition_premium?: number | null;
  m2m_value?: number | null;
  target_yield_pct?: number | null;
  lien_offset?: number | null;
  tif_expires_at?: string | null;
};

export type BuyerData = {
  id?: string | null;
  email: string;
  entity_name?: string | null;
};

const usd = (n: number | null | undefined) =>
  n == null ? "N/A" : `$${Math.round(Number(n)).toLocaleString()}`;

export function generateTransactionEmail(
  contract: ContractData,
  buyer: BuyerData,
  baseUrl = appBaseUrl(),
) {
  const ref = contract.external_id ?? contract.apn ?? contract.id.slice(0, 8).toUpperCase();
  const zip = contract.zip ?? "N/A";
  const yieldPct =
    contract.target_yield_pct != null ? `${Number(contract.target_yield_pct).toFixed(1)}%` : "N/A";
  const tif = contract.tif_expires_at
    ? new Date(contract.tif_expires_at).toUTCString()
    : "60 minutes from dispatch";

  const params = new URLSearchParams({ utm_source: "email_dispatch" });
  if (buyer.id) params.set("buyer_id", buyer.id);
  const link = `${baseUrl}/sign/${contract.id}?${params.toString()}`;

  const subject = `[EXCLUSIVE OFFER] Assignable Contract - ZIP ${zip} | Target Cap: ${yieldPct}`;

  const lines = [
    buyer.entity_name ? `${buyer.entity_name},` : "Acquisitions Desk,",
    "",
    "An assignable contract matching your active buy box is available.",
    "",
    `Asset Reference:      ${ref}`,
    `Location:             ${maskedLabel({ address: contract.address, zip: String(zip), apn: (contract as any).apn })}`,
    `Contract Price:       ${usd(contract.base_contract_price)}`,
    `M2M Value:            ${usd(contract.m2m_value)}`,
    `Assignment Fee:       ${usd(contract.optimized_acquisition_premium)}`,
    `Estoppel Lien Offset: ${usd(contract.lien_offset)}`,
    `Target Yield:         ${yieldPct}`,
    `Execution Window:     ${tif} (Time-In-Force)`,
    "",
    "Execute or decline here:",
    link,
    "",
    "After the execution window lapses, this contract is re-offered to the next matched buy box in the shadow queue.",
    "",
    "ReelEdge Acquisitions",
  ];

  const text = lines.join("\n");
  const html = `<div style="font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#111"><pre style="font:inherit;white-space:pre-wrap;margin:0">${lines
    .map((l) =>
      l === link
        ? `<a href="${link}" style="color:#0645ad">${link}</a>`
        : l.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!),
    )
    .join("\n")}</pre></div>`;

  return { subject, text, html, link, headers: { "X-Asset-ID": contract.id, "X-Buyer-ID": buyer.id ?? "" } };
}

/** Snake-case alias to match the requested API name. */
export const generate_transaction_email = generateTransactionEmail;
