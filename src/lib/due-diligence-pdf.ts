// Client-side print-to-PDF generator for the institutional due diligence package.
import type { DataRoomDeal } from "@/lib/data-room.functions";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function printDueDiligence(p: {
  softwareEquity: number;
  inventory: number;
  totalCapital: number;
  commits: number;
  hours: number;
  rate: number;
  deals: DataRoomDeal[];
}) {
  const rows = p.deals
    .slice(0, 250)
    .map(
      (d) => `<tr>
        <td>${d.parcel_id ?? d.address ?? d.id.slice(0, 8)}</td>
        <td>${d.asset_class ?? "—"}</td>
        <td class="r">${usd(d.valuation)}</td>
        <td>${d.verification_status ?? d.status}</td>
        <td>${d.title_clean_hash ? d.title_clean_hash.slice(0, 16) + "…" : "—"}</td>
        <td>${d.source_system ?? "MAIN_CLEARINGHOUSE"}</td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Institutional Due Diligence Package</title>
<style>
  body{font:11px/1.45 ui-monospace,Menlo,monospace;color:#111;margin:32px}
  h1{font-size:16px;margin:0 0 4px} h2{font-size:12px;margin:20px 0 6px;border-bottom:1px solid #999;padding-bottom:3px}
  .muted{color:#666;font-size:10px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  td,th{border-bottom:1px solid #ddd;padding:3px 4px;text-align:left}
  .r{text-align:right}
  .kv{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:2px 0}
</style></head><body>
<h1>INSTITUTIONAL DUE DILIGENCE PACKAGE</h1>
<div class="muted">Confidential · Generated ${new Date().toLocaleString("en-US")} · GAAP ASC 350-40 / ASU 2025-06</div>

<h2>1. STATEMENT OF FINANCIAL POSITION</h2>
<div class="kv"><span>Escrow Deal Tape Inventory</span><span>${usd(p.inventory)}</span></div>
<div class="kv"><span>Capitalized Software Intangibles (${p.hours.toLocaleString("en-US")} hrs @ $${p.rate}/hr)</span><span>${usd(p.softwareEquity)}</span></div>
<div class="kv"><strong>TOTAL ASSETS</strong><strong>${usd(p.totalCapital)}</strong></div>

<h2>2. TECHNICAL AUDIT BASIS</h2>
<div class="kv"><span>Git commits audited (SHA-anchored)</span><span>${p.commits.toLocaleString("en-US")}</span></div>
<div class="kv"><span>Engineering hours logged</span><span>${p.hours.toLocaleString("en-US")}</span></div>
<div class="kv"><span>Benchmark labor rate</span><span>$${p.rate}/hr</span></div>

<h2>3. ACTIVE DEAL TAPE (${p.deals.length.toLocaleString("en-US")} positions)</h2>
<table><thead><tr><th>PARCEL</th><th>CLASS</th><th class="r">VALUATION</th><th>STATUS</th><th>TITLE HASH</th><th>SOURCE</th></tr></thead>
<tbody>${rows}</tbody></table>

<h2>4. ALGORITHMIC INGESTION</h2>
<div class="muted">GET /api/v1/institutional/feed — JSON payloads signed with X-M2M-Signature (HMAC-SHA256).</div>
</body></html>`;

  const w = window.open("", "_blank", "width=1024,height=768");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}
