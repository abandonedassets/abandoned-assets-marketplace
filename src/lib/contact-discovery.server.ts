// Autonomous institutional contact discovery pipeline.
//
// Tier 1  Secretary of State / corporate registry mining (OpenCorporates)
// Tier 2  County clerk / assessor GIS + recorder feeds (ArcGIS REST, Socrata)
// Tier 3  Headless/text extraction from filing documents (regex + entity parse)
// Tier 4  DNS MX deliverability verification before any write
//
// Zero-placeholder rule: nothing is persisted unless the domain resolves a live
// MX record. Rejected candidates are recorded with verification_status='rejected'
// and never surfaced as a dispatch target.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const AGENT_RE = /(?:registered agent|statutory agent|agent for service)[^A-Za-z0-9]{0,10}([A-Za-z0-9 .,&'-]{3,80})/i;

const BANNED_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "email.com",
  "domain.com",
  "yourdomain.com",
  "localhost",
]);

export type Candidate = {
  entity_name: string;
  jurisdiction?: string | null;
  registry_id?: string | null;
  registered_agent?: string | null;
  principal_address?: string | null;
  mailing_address?: string | null;
  discovered_email?: string | null;
  discovery_tier: "tier1_sos" | "tier2_county_gis" | "tier3_document_parse";
  source: string;
  source_url?: string | null;
  raw?: Record<string, unknown> | null;
};

/* ------------------------------------------------------------------ */
/* Tier 4 — DNS MX verification (DoH; Workers cannot open raw UDP/53)  */
/* ------------------------------------------------------------------ */

export async function verifyMx(
  email: string,
): Promise<{ ok: boolean; host: string | null; reason?: string }> {
  const m = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(email.trim());
  if (!m) return { ok: false, host: null, reason: "malformed_address" };
  const domain = m[1]!.toLowerCase();
  if (BANNED_DOMAINS.has(domain) || domain.endsWith(".example"))
    return { ok: false, host: null, reason: "placeholder_domain" };

  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { accept: "application/dns-json" } },
    );
    if (!res.ok) return { ok: false, host: null, reason: `doh_${res.status}` };
    const json = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
    const mx = (json.Answer ?? []).filter((a) => a.type === 15);
    if (mx.length === 0) return { ok: false, host: null, reason: "no_mx_record" };
    const host = mx[0]!.data.split(/\s+/).pop()?.replace(/\.$/, "") ?? null;
    return { ok: true, host };
  } catch (e) {
    return { ok: false, host: null, reason: e instanceof Error ? e.message : "dns_error" };
  }
}

/* ------------------------------------------------------------------ */
/* Tier 1 — Secretary of State / corporate registry                    */
/* ------------------------------------------------------------------ */

export async function tier1CorporateRegistry(entityName: string): Promise<Candidate[]> {
  const token = process.env["OPENCORPORATES_API_TOKEN"];
  const url =
    `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(entityName)}` +
    `&per_page=5&order=score${token ? `&api_token=${token}` : ""}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const json = (await res.json()) as any;
    const companies: any[] = json?.results?.companies ?? [];
    const out: Candidate[] = [];
    for (const wrap of companies) {
      const c = wrap?.company;
      if (!c?.name) continue;
      const blob = JSON.stringify(c);
      const emails = blob.match(EMAIL_RE) ?? [];
      out.push({
        entity_name: c.name,
        jurisdiction: c.jurisdiction_code ?? null,
        registry_id: c.company_number ?? null,
        registered_agent: c.agent_name ?? null,
        principal_address: c.registered_address_in_full ?? null,
        mailing_address: c.agent_address ?? null,
        discovered_email: emails[0] ?? null,
        discovery_tier: "tier1_sos",
        source: "public_sos_filing",
        source_url: c.opencorporates_url ?? null,
        raw: c,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Tier 2 — County assessor / recorder GIS feeds                       */
/* ------------------------------------------------------------------ */

/** Query an ArcGIS REST parcel layer for the grantee/owner mailing record. */
export async function tier2CountyGis(input: {
  layerUrl: string; // e.g. https://gis.county.gov/arcgis/rest/services/Parcels/MapServer/0
  apn?: string | null;
  ownerName?: string | null;
}): Promise<Candidate[]> {
  const clauses: string[] = [];
  if (input.apn) clauses.push(`PIN='${input.apn.replace(/'/g, "''")}'`);
  if (input.ownerName) clauses.push(`UPPER(OWNER) LIKE '%${input.ownerName.replace(/'/g, "''").toUpperCase()}%'`);
  if (clauses.length === 0) return [];
  const where = clauses.join(" OR ");
  const url = `${input.layerUrl.replace(/\/$/, "")}/query?where=${encodeURIComponent(where)}&outFields=*&f=json&returnGeometry=false&resultRecordCount=5`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const json = (await res.json()) as any;
    const features: any[] = json?.features ?? [];
    return features
      .map((f) => f?.attributes ?? {})
      .filter((a) => Object.keys(a).length > 0)
      .map((a) => {
        const blob = JSON.stringify(a);
        const emails = blob.match(EMAIL_RE) ?? [];
        const name = a.OWNER ?? a.Owner ?? a.OWNER_NAME ?? a.GRANTEE ?? input.ownerName ?? "UNKNOWN";
        return {
          entity_name: String(name),
          jurisdiction: a.COUNTY ?? a.County ?? null,
          registry_id: a.PIN ?? a.APN ?? input.apn ?? null,
          mailing_address: a.MAIL_ADDR ?? a.MAILING_ADDRESS ?? a.OWNER_ADDR ?? null,
          principal_address: a.SITUS ?? a.SITE_ADDR ?? null,
          discovered_email: emails[0] ?? null,
          discovery_tier: "tier2_county_gis" as const,
          source: "county_gis_parcel_layer",
          source_url: url,
          raw: a,
        };
      });
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Tier 3 — Document text extraction (deeds, articles, annual reports) */
/* ------------------------------------------------------------------ */

export function tier3ParseDocumentText(input: {
  text: string;
  entityName: string;
  sourceUrl?: string | null;
}): Candidate[] {
  const emails = Array.from(new Set(input.text.match(EMAIL_RE) ?? []));
  const agent = AGENT_RE.exec(input.text)?.[1]?.trim() ?? null;
  if (emails.length === 0 && !agent) return [];
  const list = emails.length > 0 ? emails : [null];
  return list.map((email) => ({
    entity_name: input.entityName,
    registered_agent: agent,
    discovered_email: email,
    discovery_tier: "tier3_document_parse" as const,
    source: "public_filing_document",
    source_url: input.sourceUrl ?? null,
    raw: { agent, emails },
  }));
}

/** Fetch a public filing/deed URL and parse it as text (HTML or plain). */
export async function tier3FetchAndParse(url: string, entityName: string): Promise<Candidate[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("pdf")) {
      const buf = new Uint8Array(await res.arrayBuffer());
      // Extract ASCII runs from the uncompressed portions of the PDF stream.
      let text = "";
      for (const b of buf) text += b >= 32 && b < 127 ? String.fromCharCode(b) : " ";
      return tier3ParseDocumentText({ text, entityName, sourceUrl: url });
    }
    const html = await res.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
    return tier3ParseDocumentText({ text, entityName, sourceUrl: url });
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Persistence — MX gate enforced before any accepted write            */
/* ------------------------------------------------------------------ */

export async function persistCandidates(
  candidates: Candidate[],
  assetId?: string | null,
): Promise<{ accepted: number; rejected: number; rows: Array<Record<string, unknown>> }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let accepted = 0;
  let rejected = 0;
  const rows: Array<Record<string, unknown>> = [];

  for (const c of candidates) {
    let mx: { ok: boolean; host: string | null; reason?: string } = {
      ok: false,
      host: null,
      reason: "no_email",
    };
    if (c.discovered_email) mx = await verifyMx(c.discovered_email);

    const row = {
      entity_name: c.entity_name,
      jurisdiction: c.jurisdiction ?? null,
      registry_id: c.registry_id ?? null,
      registered_agent: c.registered_agent ?? null,
      principal_address: c.principal_address ?? null,
      mailing_address: c.mailing_address ?? null,
      discovered_email: c.discovered_email ?? null,
      discovery_tier: c.discovery_tier,
      source: c.source,
      source_url: c.source_url ?? null,
      mx_valid: mx.ok,
      mx_host: mx.host,
      verification_status: mx.ok ? "verified" : "rejected",
      verified_at: mx.ok ? new Date().toISOString() : null,
      asset_id: assetId ?? null,
      raw: { ...(c.raw ?? {}), mx_reason: mx.reason ?? null },
    };

    const { error } = await supabaseAdmin
      .from("entity_contacts")
      .upsert(row as never, { onConflict: "entity_name,discovered_email", ignoreDuplicates: false });
    if (error) {
      // Unique index is expression-based; fall back to plain insert-if-absent.
      await supabaseAdmin.from("entity_contacts").insert(row as never);
    }
    if (mx.ok) accepted++;
    else rejected++;
    rows.push(row);
  }
  return { accepted, rejected, rows };
}

/** Promote MX-verified discoveries into buyer_waitlist intake targets. */
export async function promoteVerifiedContacts(limit = 25): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("entity_contacts")
    .select("entity_name, discovered_email, source")
    .eq("verification_status", "verified")
    .not("discovered_email", "is", null)
    .limit(limit);

  let promoted = 0;
  for (const r of (data ?? []) as Array<{ entity_name: string; discovered_email: string; source: string }>) {
    const { data: existing } = await supabaseAdmin
      .from("buyer_waitlist")
      .select("id")
      .eq("contact_email", r.discovered_email)
      .maybeSingle();
    if (existing) continue;
    const { error } = await supabaseAdmin.from("buyer_waitlist").insert({
      fund_name: r.entity_name,
      contact_email: r.discovered_email,
      status: "discovered",
      contact_source: r.source,
      contact_mx_valid: true,
      contact_verified_at: new Date().toISOString(),
    } as never);
    if (!error) promoted++;
  }
  return promoted;
}

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */

export async function runContactDiscoveryWorker(limit = 10): Promise<{
  ok: true;
  scanned: number;
  accepted: number;
  rejected: number;
  promoted: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: assets } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("id, address, apn, owner_entity")
    .order("optimized_acquisition_premium", { ascending: false })
    .limit(limit);

  let accepted = 0;
  let rejected = 0;
  let scanned = 0;

  for (const a of (assets ?? []) as Array<{ id: string; apn: string | null; owner_entity: string | null }>) {
    const entity = a.owner_entity?.trim();
    if (!entity) continue;
    scanned++;
    try {
      const candidates = await tier1CorporateRegistry(entity);
      const res = await persistCandidates(candidates, a.id);
      accepted += res.accepted;
      rejected += res.rejected;
    } catch {
      // Fail-forward: one bad registry response never stalls the sweep.
    }
  }

  const promoted = await promoteVerifiedContacts();
  return { ok: true, scanned, accepted, rejected, promoted };
}
