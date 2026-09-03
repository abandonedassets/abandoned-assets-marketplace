import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { projectOperatingExpenses } from "./franchise-opex";

/** Sites within a radius of a substation coordinate. */
export const findStoresNearSubstation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { lon: number; lat: number; radiusMiles?: number }) => {
    const lon = Number(input?.lon);
    const lat = Number(input?.lat);
    if (!isFinite(lon) || lon < -180 || lon > 180) throw new Error("Invalid longitude");
    if (!isFinite(lat) || lat < -90 || lat > 90) throw new Error("Invalid latitude");
    return {
      lon,
      lat,
      radiusMiles: Math.min(Math.max(Number(input?.radiusMiles) || 1, 0.1), 50),
    };
  })
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc(
      "retail_stores_within_radius",
      { _lon: data.lon, _lat: data.lat, _radius_miles: data.radiusMiles },
    );
    if (error) throw new Error(error.message);
    return { stores: rows ?? [] };
  });

/** 10-year operating cost projection, returned as a flat numeric table. */
export const projectFranchiseOpex = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { baseAnnualCost: number; inflationRate?: number }) => {
    const base = Number(input?.baseAnnualCost);
    if (!isFinite(base) || base <= 0) throw new Error("Invalid base annual cost");
    const rate = input?.inflationRate == null ? 0.03 : Number(input.inflationRate);
    if (!isFinite(rate) || rate < 0 || rate > 0.5) throw new Error("Invalid inflation rate");
    return { baseAnnualCost: base, inflationRate: rate };
  })
  .handler(async ({ data }) =>
    projectOperatingExpenses(data.baseAnnualCost, data.inflationRate),
  );
