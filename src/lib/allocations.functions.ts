import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AllocationRow = {
  id: string;
  address_raw: string | null;
  zip: string | null;
  state: string | null;
  asset_class: string | null;
  parcel_number: string | null;
  acreage: number | null;
  contract_price: number | null;
  assignment_fee: number | null;
  status: string | null;
  created_at: string | null;
  is_odd_parcel: boolean | null;
  primary_beneficiary: "OWNER" | "JAZMIN" | "JAQUITA";
  jaquita_share: number | null;
  jasmine_share: number | null;
  owner_share: number | null;
};

export type AllocationSnapshot = {
  at: string;
  role: "ADMIN" | "JAZMIN" | "JAQUITA";
  email: string | null;
  rows: AllocationRow[];
  totals: { gross: number; owner: number; jazmin: number; jaquita: number };
};

const COLS =
  "id,address_raw,zip,state,asset_class,parcel_number,acreage,contract_price,assignment_fee,status,created_at,is_odd_parcel,primary_beneficiary,jaquita_share,jasmine_share,owner_share";

function resolveRole(email: string | null): "ADMIN" | "JAZMIN" | "JAQUITA" {
  const e = (email ?? "").toLowerCase();
  if (e.includes("jazmin") || e.includes("ironclad")) return "JAZMIN";
  if (e.includes("jaquita")) return "JAQUITA";
  return "ADMIN";
}

/** Allocation tape + partner totals. Admins see everything; partners see their own lane. */
export const getAllocations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AllocationSnapshot> => {
    const ctx = context as unknown as { claims?: Record<string, unknown> };
    const email = (ctx.claims?.["email"] as string | undefined) ?? null;
    const role = resolveRole(email);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("deal_allocations_view" as never)
      .select(COLS)
      .order("created_at", { ascending: false })
      .limit(500);
    if (role !== "ADMIN") q = q.eq("primary_beneficiary", role);

    const { data } = await q;
    const rows = (data ?? []) as unknown as AllocationRow[];

    // Global totals always reflect the whole book for the master header.
    const { data: allData } = await supabaseAdmin
      .from("deal_allocations_view" as never)
      .select("assignment_fee,owner_share,jasmine_share,jaquita_share")
      .limit(5000);
    const all = (allData ?? []) as unknown as Array<Record<string, number | null>>;
    const sum = (k: string) => all.reduce((s, r) => s + (Number(r[k]) || 0), 0);

    return {
      at: new Date().toISOString(),
      role,
      email,
      rows,
      totals: {
        gross: sum("assignment_fee"),
        owner: sum("owner_share"),
        jazmin: sum("jasmine_share"),
        jaquita: sum("jaquita_share"),
      },
    };
  });
