// Auto-VDR: headless, tokenized Virtual Data Room payload.
// Institutional scrapers hit the token URL and ingest a complete preliminary
// due-diligence package (zoning, parcel, tax, title, settlement terms) with
// zero human analyst involvement — driving the deal's friction score to zero.

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function vdrSecret(): string {
  // Dedicated signing key — decoupled from the inbound-email webhook secret so
  // rotating one never cascades into invalidating live VDR links.
  return (
    process.env.VDR_TOKEN_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "reeledge-vdr"
  );
}


async function sign(dealId: string): Promise<string> {
  const data = new TextEncoder().encode(`${dealId}:${vdrSecret()}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return b64url(digest).slice(0, 22);
}

/** Deterministic token — regenerating a dispatch never invalidates prior links. */
export async function vdrToken(dealId: string): Promise<string> {
  return `${dealId}.${await sign(dealId)}`;
}

export async function vdrUrl(origin: string, dealId: string): Promise<string> {
  return `${origin}/api/public/vdr/${await vdrToken(dealId)}`;
}

export async function resolveVdrToken(token: string): Promise<string | null> {
  const idx = token.lastIndexOf(".");
  if (idx < 0) return null;
  const dealId = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) return null;
  const expected = await sign(dealId);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? dealId : null;
}

export type VdrPackage = Record<string, unknown>;

/** Compiles the public due-diligence dossier for a single asset. */
export async function buildVdrPackage(dealId: string): Promise<VdrPackage | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: d } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("*")
    .eq("id", dealId)
    .maybeSingle();
  if (!d) return null;

  const deal = d as Record<string, any>;
  const address = [deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", ");
  const apn = deal.apn ?? null;

  const { BLIND_HUD_DIRECTIVE } = await import("./blind-hud.server");

  return {
    document: "VIRTUAL_DATA_ROOM_PACKAGE",
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    assignor: "ReelEdge Entertainment LLC",
    asset: {
      id: deal.id,
      address,
      street: deal.address ?? null,
      city: deal.city ?? null,
      state: deal.state ?? null,
      zip: deal.zip ?? null,
      apn,
      asset_type: deal.asset_type ?? null,
      county: deal.county ?? null,
    },
    zoning: {
      code: deal.zoning_code ?? deal.zoning ?? null,
      commercial_eligible: deal.commercial_eligible ?? null,
      epa_precleared: deal.epa_precleared ?? null,
    },
    valuation: {
      contract_price: Number(deal.base_contract_price) || 0,
      assignment_fee: Number(deal.optimized_acquisition_premium) || 0,
      estimated_stumpage_mbf: deal.estimated_stumpage_mbf ?? null,
      liquidity_tier: deal.liquidity_tier ?? null,
      market_alpha_tag: deal.market_alpha_tag ?? null,
    },
    title: {
      status: deal.title_status ?? "Pending",
      escrow_status: deal.escrow_status ?? null,
      structure: "Double-escrow assignment (A→B / B→C)",
      directive: BLIND_HUD_DIRECTIVE,
    },
    terms: {
      settlement: "ACH / us_bank_account only",
      emd_lock_hours: 24,
      anti_circumvention_liquidated_damages_usd: 25000,
      inspection: "Waived — asset accepted as-is",
      seller_sole_remedy: "Retention of Earnest Money Deposit as liquidated damages",
      specific_performance: "Expressly waived by Seller",
      ofac_screening: "Counterparty entity + signatory screened against OFAC SDN at execution",
      title_cloud: "Memorandum of Contract recorded against the deed on A-to-B execution",
      non_repudiation:
        "IP, device fingerprint, user-agent and millisecond timestamp captured at execution (E-SIGN/UETA)",
    },

    status: {
      pipeline_status: deal.status ?? null,
      verification_status: deal.verification_status ?? null,
      cleared_at: deal.cleared_at ?? null,
      updated_at: deal.updated_at ?? null,
    },
  };
}
