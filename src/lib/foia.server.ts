// Zero-cost builder/permit acquisition — automated public-records (FOIA /
// Sunshine Law) requests. Weekly templated email to clerk/building dept
// addresses; the returned CSV is intercepted by the inbound email webhook and
// parsed straight into buyer_waitlist. Fail-forward: never throws.

const WEEK_MS = 7 * 86400_000;

async function cfg(key: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("system_config").select("value").eq("key", key).maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  return typeof v === "string" ? v : null;
}

async function setCfg(key: string, value: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("system_config").upsert({ key, value } as never, { onConflict: "key" });
}

function requestBody(): string {
  const end = new Date();
  const start = new Date(end.getTime() - WEEK_MS);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return `
<p>To the Records Custodian,</p>
<p>Pursuant to the applicable state public records / Sunshine Law, this is a standing
request for an electronic copy (CSV or XLSX) of all building permits issued between
<b>${fmt(start)}</b> and <b>${fmt(end)}</b> in the categories:</p>
<ul>
  <li>Raw Land Development</li>
  <li>Foundation / New Residential Construction</li>
  <li>Commercial Site Work</li>
</ul>
<p>Please include: permit number, issue date, parcel/APN, site address, permit type,
valuation, applicant/contractor name, and applicant email or phone.</p>
<p>Electronic delivery to this address satisfies the request in full. If any portion is
withheld, please cite the specific exemption. If fees exceed $25, please advise first.</p>
<p>Thank you,<br/>Records Requests — Abandoned Asset OS</p>`;
}

/** Send this week's public-records requests (idempotent per 7-day window). */
export async function runFoiaSweep(force = false) {
  const recipientsRaw = (await cfg("FOIA_RECIPIENTS")) ?? process.env["FOIA_RECIPIENTS"] ?? "";
  let recipients: string[] = [];
  try {
    const parsed = JSON.parse(recipientsRaw);
    if (Array.isArray(parsed)) recipients = parsed.filter((x) => typeof x === "string");
  } catch {
    recipients = recipientsRaw.split(/[,\s]+/).filter((s) => s.includes("@"));
  }
  if (!recipients.length) return { ok: true, sent: 0, reason: "no_recipients" };

  if (!force) {
    const last = await cfg("FOIA_LAST_RUN");
    if (last && Date.now() - Date.parse(last) < WEEK_MS)
      return { ok: true, sent: 0, reason: "within_window" };
  }

  const { sendM2MEmail } = await import("./email.server");
  let sent = 0;
  const failures: string[] = [];
  for (const to of recipients.slice(0, 50)) {
    try {
      const r = await sendM2MEmail({
        to,
        subject: "Public Records Request — Weekly Permit Export (Land Development / Foundation)",
        html: requestBody(),
        headers: { "X-Request-Type": "PUBLIC-RECORDS" },
      });
      if (r.ok) sent++;
      else failures.push(`${to}:${r.error}`);
    } catch (e) {
      failures.push(`${to}:${(e as Error).message}`);
    }
  }
  await setCfg("FOIA_LAST_RUN", new Date().toISOString());
  return { ok: true, sent, failures };
}

// ─── CSV interception ──────────────────────────────────────────────────────

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse a permit CSV export and drop applicants/builders into buyer_waitlist.
 * Tolerant of column-name variation; rows without a name are skipped.
 */
export async function ingestPermitCsv(csv: string, source = "foia_csv") {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { ok: true, inserted: 0, rows: 0 };
  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const idx = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iName = idx("applicant", "contractor", "builder", "owner", "company");
  const iEmail = idx("email");
  const iPhone = idx("phone");
  const iZip = idx("zip", "postal");
  const iType = idx("permit type", "type", "category");
  if (iName < 0) return { ok: true, inserted: 0, rows: lines.length - 1, reason: "no_name_column" };

  const seenLocal = new Set<string>();
  const rows = lines
    .slice(1)
    .map(splitCsvLine)
    .map((c) => ({
      fund_name: (c[iName] ?? "").trim(),
      contact_email: iEmail >= 0 ? (c[iEmail] || null) : null,
      contact_phone: iPhone >= 0 ? (c[iPhone] || null) : null,
      target_zips: iZip >= 0 && /^\d{5}/.test(c[iZip] ?? "") ? [c[iZip]!.slice(0, 5)] : [],
      buyer_tier: "BUILDER_PERMIT",
      status: "permit_lead",
      source_ip: source,
      message: iType >= 0 ? `Permit: ${c[iType] ?? ""}` : "Permit lead",
    }))
    .filter((r) => {
      if (r.fund_name.length < 2 || seenLocal.has(r.fund_name)) return false;
      seenLocal.add(r.fund_name);
      return true;
    })
    .slice(0, 500);
  if (!rows.length) return { ok: true, inserted: 0, rows: lines.length - 1 };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existing } = await supabaseAdmin
    .from("buyer_waitlist")
    .select("fund_name")
    .in("fund_name", rows.map((r) => r.fund_name));
  const seen = new Set((existing ?? []).map((r: { fund_name: string }) => r.fund_name));
  const fresh = rows.filter((r) => !seen.has(r.fund_name));
  if (!fresh.length) return { ok: true, inserted: 0, rows: rows.length };

  const { error } = await supabaseAdmin.from("buyer_waitlist").insert(fresh);
  if (error) return { ok: false, inserted: 0, rows: rows.length, error: error.message };
  return { ok: true, inserted: fresh.length, rows: rows.length };
}
