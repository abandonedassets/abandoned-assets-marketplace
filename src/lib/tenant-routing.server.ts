// Tenant routing: attribute incoming multi-frontend deals to the correct payee.
// Fail-forward: unknown headers never block ingestion.

export type SourceSystem = "IRONCLAD_ASSETS" | "MUNCIE_INFILL_JAQUITA" | "MAIN_CLEARINGHOUSE";

export type TenantPayload = {
  has_timber?: boolean;
  valuation?: number;
  parcel_number?: string | number | null;
  has_street_utilities?: boolean;
  asset_class?: string | null;
};

export type TenantRouting = {
  source_system: SourceSystem;
  fee_attribution: SourceSystem;
  asset_class: string | null;
  has_timber: boolean;
  has_street_utilities: boolean;
  parcel_number: string | null;
  rule: string;
};

export function normalizeSourceSystem(header: string | null | undefined): SourceSystem {
  const h = (header ?? "").trim().toUpperCase();
  if (h === "IRONCLAD_ASSETS") return "IRONCLAD_ASSETS";
  if (h === "MUNCIE_INFILL_JAQUITA") return "MUNCIE_INFILL_JAQUITA";
  return "MAIN_CLEARINGHOUSE";
}

function lastDigit(parcel: string | number | null | undefined): number | null {
  const digits = String(parcel ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return Number(digits[digits.length - 1]);
}

export function routeTenantDeal(
  header: string | null | undefined,
  payload: TenantPayload,
): TenantRouting {
  const source_system = normalizeSourceSystem(header);
  const parcel_number = payload.parcel_number == null ? null : String(payload.parcel_number);
  const has_timber = Boolean(payload.has_timber);
  const has_street_utilities = Boolean(payload.has_street_utilities);
  const valuation = Number(payload.valuation ?? 0);

  if (source_system === "MUNCIE_INFILL_JAQUITA") {
    return {
      source_system,
      fee_attribution: "MUNCIE_INFILL_JAQUITA",
      asset_class: "INFILL_LAND_MODULAR",
      has_timber,
      has_street_utilities,
      parcel_number,
      rule: "muncie_infill_modular",
    };
  }

  if (source_system === "IRONCLAD_ASSETS") {
    let fee_attribution: SourceSystem;
    let rule: string;
    if (has_timber) {
      fee_attribution = "IRONCLAD_ASSETS";
      rule = "ironclad_timber";
    } else if (valuation > 100_000) {
      fee_attribution = "MAIN_CLEARINGHOUSE";
      rule = "ironclad_high_value";
    } else {
      const d = lastDigit(parcel_number);
      const even = d !== null && d % 2 === 0;
      fee_attribution = even ? "IRONCLAD_ASSETS" : "MAIN_CLEARINGHOUSE";
      rule = `ironclad_parcel_modulo_${d === null ? "unknown_odd" : even ? "even" : "odd"}`;
    }
    return {
      source_system,
      fee_attribution,
      asset_class: payload.asset_class ?? null,
      has_timber,
      has_street_utilities,
      parcel_number,
      rule,
    };
  }

  return {
    source_system,
    fee_attribution: "MAIN_CLEARINGHOUSE",
    asset_class: payload.asset_class ?? null,
    has_timber,
    has_street_utilities,
    parcel_number,
    rule: "default_main",
  };
}

/** Persist tenant attribution on a deal record. Never throws. */
export async function applyTenantRouting(dealId: string, routing: TenantRouting) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        source_system: routing.source_system,
        fee_attribution: routing.fee_attribution,
        has_timber: routing.has_timber,
        has_street_utilities: routing.has_street_utilities,
        ...(routing.asset_class ? { asset_class: routing.asset_class } : {}),
        ...(routing.parcel_number ? { parcel_number: routing.parcel_number } : {}),
      } as never)
      .eq("id", dealId);
  } catch (e) {
    console.error("[tenant-routing] persist failed", dealId, e);
  }
  return routing;
}
