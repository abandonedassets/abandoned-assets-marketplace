import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EscrowItem = {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: string | null;
  asset_type: string | null;
  optimized_acquisition_premium: number | null;
  base_contract_price: number | null;
  confidence_score: number | null;
  liquidity_match_score: number | null;
  enrichment_tags: string[] | null;
  locked_at: string | null;
  created_at: string;
  matched_buyer_id: string | null;
  matched_buyers_count: number;
};

export const listEscrowItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("closing_pipeline_items")
      .select(
        "id,address,city,state,zip,status,asset_type,optimized_acquisition_premium,base_contract_price,confidence_score,liquidity_match_score,enrichment_tags,locked_at,created_at,matched_buyer_id",
      )
      .in("status", ["In-Escrow", "Locked-Escrow-Pending", "Buyer-Signed", "House-Bid", "New"])
      .order("locked_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const assetTypes = Array.from(
      new Set(rows.map((r) => r.asset_type).filter((x): x is string => !!x)),
    );

    const counts: Record<string, number> = {};
    if (assetTypes.length > 0) {
      const { data: boxes } = await context.supabase
        .from("buyer_buy_boxes")
        .select("target_asset_types")
        .eq("active", true);
      for (const b of boxes ?? []) {
        const types = (b.target_asset_types ?? []) as string[];
        for (const t of types) {
          if (assetTypes.includes(t)) counts[t] = (counts[t] ?? 0) + 1;
        }
      }
    }

    return rows.map((r) => ({
      ...r,
      matched_buyers_count: r.asset_type ? (counts[r.asset_type] ?? 0) : 0,
    })) as EscrowItem[];
  });

export type PipelineRow = {
  id: string;
  address: string | null;
  status: string | null;
  optimized_acquisition_premium: number | null;
  locked_at: string | null;
};

export const listFullPipeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("closing_pipeline_items")
      .select("id,address,status,optimized_acquisition_premium,locked_at")
      .order("locked_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? []) as PipelineRow[];
  });

export type StatusBucket = { status: string; count: number; premium: number };

// Bucket counts + Σ optimized_acquisition_premium per status (live, not cached).
export const listStatusBuckets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("closing_pipeline_items")
      .select("status,optimized_acquisition_premium")
      .limit(50000);
    if (error) throw new Error(error.message);
    const map = new Map<string, StatusBucket>();
    for (const r of data ?? []) {
      const s = (r.status as string) ?? "Unknown";
      const b = map.get(s) ?? { status: s, count: 0, premium: 0 };
      b.count += 1;
      b.premium += Number(r.optimized_acquisition_premium ?? 0);
      map.set(s, b);
    }
    return Array.from(map.values());
  });

// Accelerate a deal one valid step. Respects the adversarial-audit trigger
// (terminal/illegal transitions raise check_violation in Postgres).
const NEXT_STATUS: Record<string, string> = {
  Scout: "New",
  New: "Buyer-Signed",
  "Buyer-Signed": "Locked-Escrow-Pending",
  "In-Escrow": "Locked-Escrow-Pending",
};

export const accelerateDeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: row, error: readErr } = await context.supabase
      .from("closing_pipeline_items")
      .select("id,status")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("not_found");

    const next = NEXT_STATUS[row.status as string];
    if (!next) throw new Error(`no_next_step_from:${row.status}`);

    const patch: { status: typeof next; updated_at: string; locked_at?: string } = {
      status: next as typeof next,
      updated_at: new Date().toISOString(),
    };
    if (next === "Locked-Escrow-Pending") patch.locked_at = new Date().toISOString();

    const { error: updErr } = await context.supabase
      .from("closing_pipeline_items")
      .update(patch as never)


      .eq("id", data.id);
    if (updErr) throw new Error(updErr.message);
    return { id: data.id, from: row.status, to: next };
  });

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

// Drives Locked-Escrow-Pending / Buyer-Signed → In-Escrow and stamps the audit log.
export const openTitleEscrow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("invalid_id");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: readErr } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id,status,address,zip,base_contract_price,optimized_acquisition_premium,title_status")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("not_found");

    const r = row as any;
    if (!["Locked-Escrow-Pending", "Buyer-Signed"].includes(r.status)) {
      throw new Error(`cannot_open_escrow_from:${r.status}`);
    }

    const { error: updErr } = await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        status: "In-Escrow",
        escrow_status: "OPEN",
        escrow_pending_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", data.id);
    if (updErr) throw new Error(updErr.message);

    await supabaseAdmin.from("system_audit_log").insert({
      table_name: "closing_pipeline_items",
      row_id: data.id,
      operation: "ESCROW_DISPATCH_INITIATED",
      old_data: { status: r.status },
      new_data: { status: "In-Escrow", initiated_by: context.userId },
    } as never);

    return { ok: true as const, id: data.id, from: r.status, to: "In-Escrow" };
  });

// Compiled title-package payload (JSON) for download / title-company hand-off.
export const getTitlePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("invalid_id");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [deal, pkg] = await Promise.all([
      supabaseAdmin.from("closing_pipeline_items").select("*").eq("id", data.id).maybeSingle(),
      supabaseAdmin
        .from("title_packages")
        .select("id,package_status,payload,title_company_ref,created_at,updated_at")
        .eq("pipeline_item_id", data.id)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (deal.error) throw new Error(deal.error.message);
    if (!deal.data) throw new Error("not_found");

    const d = deal.data as any;
    return {
      generated_at: new Date().toISOString(),
      deal: {
        id: d.id,
        address: d.address,
        city: d.city,
        state: d.state,
        zip: d.zip,
        apn: d.apn,
        county: d.county,
        owner_entity: d.owner_entity,
        asset_type: d.asset_type,
        beds: d.beds,
        baths: d.baths,
        sqft: d.sqft,
        year_built: d.year_built,
        base_contract_price: d.base_contract_price,
        optimized_acquisition_premium: d.optimized_acquisition_premium,
        status: d.status,
        escrow_status: d.escrow_status,
        title_status: d.title_status,
        title_notes: d.title_notes,
        requires_legal_review: d.requires_legal_review,
        lien_total: d.lien_total,
        assessed_value: d.assessed_value,
        annual_property_tax: d.annual_property_tax,
        emd_amount: d.emd_amount,
        emd_tier: d.emd_tier,
      },
      title_package: (pkg.data ?? [])[0] ?? null,
      escrow_instructions: (await import("./blind-hud.server")).buildBlindHudSheet({
        dealId: d.id,
        address: [d.address, d.city, d.state, d.zip].filter(Boolean).join(", "),
        apn: d.apn,
      }),
      escrow_doc_path: d.escrow_doc_path ?? null,
    };

  });

export type TitlePackageMeta = {
  pipeline_item_id: string;
  package_status: string;
  title_company_ref: string | null;
  updated_at: string;
};

export const listTitlePackages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("title_packages")
      .select("pipeline_item_id,package_status,title_company_ref,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? []) as TitlePackageMeta[];
  });



