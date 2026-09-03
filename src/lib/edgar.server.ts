// Zero-cost institutional liquidity harvester — SEC EDGAR (free, no key).
// Form D  = fresh private capital raised, must be deployed.
// Form 8-K = material event (often a large asset sale) => 1031 liquidity.
// Fail-forward: never throws; a dead endpoint returns a zero-count result.

const UA = "AbandonedAssetOS/1.0 (deals@asset-weaver-30.lovable.app)";

type Filing = { form: string; name: string; cik: string | null; link: string | null };

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Parse EDGAR "getcurrent" atom feed entries. */
function parseAtom(xml: string, form: string): Filing[] {
  const out: Filing[] = [];
  const entries = xml.split("<entry>").slice(1);
  for (const e of entries) {
    const title = decode(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    if (!title) continue;
    // "D - ACME CAPITAL FUND LP (0001234567) (Filer)"
    const name = decode(title.replace(/^[^-]*-\s*/, "").replace(/\(\d{5,}\).*$/, ""));
    const cik = title.match(/\((\d{7,10})\)/)?.[1] ?? null;
    const link = e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? null;
    if (name.length > 2) out.push({ form, name, cik, link: link ? decode(link) : null });
  }
  return out;
}

async function fetchForm(form: string, count = 40): Promise<Filing[]> {
  try {
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(
      form,
    )}&company=&dateb=&owner=include&count=${count}&output=atom`;
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/atom+xml" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    return parseAtom(await res.text(), form);
  } catch {
    return [];
  }
}

/**
 * Harvest freshly-capitalized funds from EDGAR into buyer_waitlist.
 * Institutional leads land as status='sec_lead' so dispatch can enrich later.
 */
export async function runEdgarHarvest(limit = 60) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const filings = [...(await fetchForm("D")), ...(await fetchForm("8-K"))].slice(0, limit);
  if (!filings.length) return { ok: true, scanned: 0, inserted: 0 };

  // Dedupe against what's already tracked.
  const names = Array.from(new Set(filings.map((f) => f.name)));
  const { data: existing } = await supabaseAdmin
    .from("buyer_waitlist")
    .select("fund_name")
    .in("fund_name", names);
  const seen = new Set((existing ?? []).map((r: { fund_name: string }) => r.fund_name));

  const rows = filings
    .filter((f) => !seen.has(f.name))
    .filter((f, i, arr) => arr.findIndex((x) => x.name === f.name) === i)
    .map((f) => ({
      fund_name: f.name,
      buyer_tier: f.form === "D" ? "INSTITUTIONAL_FRESH_CAPITAL" : "INSTITUTIONAL_1031",
      status: "sec_lead",
      aum_bracket: null,
      target_zips: [] as string[],
      source_ip: "sec_edgar",
      message: `EDGAR ${f.form}${f.cik ? ` CIK ${f.cik}` : ""}${f.link ? ` ${f.link}` : ""}`,
    }));

  if (!rows.length) return { ok: true, scanned: filings.length, inserted: 0 };

  const { error } = await supabaseAdmin.from("buyer_waitlist").insert(rows);
  if (error) return { ok: false, scanned: filings.length, inserted: 0, error: error.message };
  return { ok: true, scanned: filings.length, inserted: rows.length };
}
