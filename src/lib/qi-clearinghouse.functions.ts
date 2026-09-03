import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

export const getClearinghouse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    const nowIso = new Date().toISOString();

    const { data: boxes } = await context.supabase
      .from("buyer_buy_boxes")
      .select(
        "id,buyer_id,label,qi_entity,exchange_deadline_at,target_zip_codes,target_asset_types,max_contract_price,min_placement_margin,capital_to_deploy_usd,urgency_score,active",
      )
      .eq("is_1031_buyer", true)
      .order("exchange_deadline_at", { ascending: true })
      .limit(100);

    const { data: matched } = await context.supabase
      .from("closing_pipeline_items")
      .select(
        "id,address,city,state,zip,asset_type,sqft,acreage,timber_density_score,enrichment_tags,zoning_category,base_contract_price,optimized_acquisition_premium,composite_score,status,qi_entity,exchange_deadline_at,matched_buy_box_id,calculated_arv,arv_source,arv_comp_count,arv_updated_at,absolute_floor_price,is_fee_positive,estimated_repairs,has_signed_marketing_auth,escrow_status",
      )
      .eq("is_1031_candidate", true)
      .order("exchange_deadline_at", { ascending: true })
      .limit(200);

    const { computeFeeMath } = await import("@/lib/fee-matrix");
    const { classifyAllocation, allocationDrift } = await import("@/lib/allocation-matrix");
    const { claimHash } = await import("@/lib/claim.server");
    const siteBase = process.env["PUBLIC_SITE_URL"] ?? "https://asset-weaver-30.lovable.app";
    const enriched = ((matched ?? []) as Array<Record<string, any>>).map((a) => {
      const price = Number(a['base_contract_price'] ?? 0);
      const arv = Number(a['calculated_arv'] ?? 0) || Math.round(price * 1.25);
      const m = computeFeeMath({
        price,
        arv,
        repairs: a['estimated_repairs'],
        asset: {
          asset_type: a['asset_type'],
          zoning_category: a['zoning_category'],
          enrichment_tags: a['enrichment_tags'],
          address: a['address'],
          sqft: a['sqft'],
          acreage: a['acreage'],
          timber_density_score: a['timber_density_score'],
        },
      });
      const alloc = classifyAllocation({
        asset_type: a['asset_type'],
        zoning_category: a['zoning_category'],
        enrichment_tags: a['enrichment_tags'],
        address: a['address'],
        sqft: a['sqft'],
        acreage: a['acreage'],
      });
      return {
        ...a,
        asset_class: m.asset_class,
        target_fee: m.target_fee,
        projected_cap_rate: m.projected_cap_rate,
        fee_cleared: m.is_fee_positive,
        allocation_bucket: alloc.bucket,
        allocation_label: alloc.label,
        allocation_weight: alloc.target_weight,
        title_x_compliant: alloc.compliant,
        screen_reason: alloc.screen_reason,
        claim_url: `${siteBase}/claim/${claimHash(String(a['id']))}?id=${a['id']}`,
      };
    });

    const allocation = allocationDrift(
      ((matched ?? []) as Array<Record<string, any>>).map((a) => ({
        asset_type: a['asset_type'],
        zoning_category: a['zoning_category'],
        enrichment_tags: a['enrichment_tags'],
        address: a['address'],
        sqft: a['sqft'],
        acreage: a['acreage'],
      })),
    );

    return {
      now: nowIso,
      boxes: (boxes ?? []) as Array<Record<string, any>>,
      matched: enriched as Array<Record<string, any>>,
      allocation,
    };
  });

export const runExchangeSweep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    try {
      const origin = process.env["PUBLIC_SITE_URL"] ?? "https://asset-weaver-30.lovable.app";
      const res = await fetch(`${origin}/api/public/hooks/exchange-match`, { method: "POST" });
      const json = (await res.json()) as { ok?: boolean; dispatched?: number };
      return { ok: !!json.ok, dispatched: Number(json.dispatched ?? 0) };
    } catch (e) {
      return { ok: false, dispatched: 0, error: (e as Error).message };
    }
  });

// Kicks the zero-cost comps engine (county REST → public sold feed → floor math).
export const runArvComps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    try {
      const origin = process.env["PUBLIC_SITE_URL"] ?? "https://asset-weaver-30.lovable.app";
      const res = await fetch(`${origin}/api/public/hooks/calculate-real-arv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25 }),
      });
      const json = (await res.json()) as { ok?: boolean; scanned?: number };
      return { ok: !!json.ok, scanned: Number(json.scanned ?? 0) };
    } catch (e) {
      return { ok: false, scanned: 0, error: (e as Error).message };
    }
  });

// Autonomous engine telemetry: pipeline velocity + master cron trigger.
export const getEngineStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    const count = async (build: (q: any) => any) => {
      try {
        const q = build(
          context.supabase.from("closing_pipeline_items").select("id", { count: "exact", head: true }),
        );
        const { count: c } = await q;
        return Number(c ?? 0);
      } catch {
        return 0;
      }
    };

    const ingested = await count((q: any) => q);
    const scored = await count((q: any) => q.not("calculated_arv", "is", null));
    const strikeSent = await count((q: any) => q.contains("enrichment_tags", ["REVERSE_STRIKE_SENT"]));
    const matched = await count((q: any) => q.not("matched_buy_box_id", "is", null));
    const dispatched = await count((q: any) => q.eq("status", "Webhook_Dispatched"));

    const { data: fees } = await context.supabase
      .from("closing_pipeline_items")
      .select("optimized_acquisition_premium,base_contract_price")
      .not("matched_buy_box_id", "is", null)
      .is("payout_at", null)
      .limit(1000);
    const rows = (fees ?? []) as Array<Record<string, any>>;
    const pendingFees = rows.reduce((a, r) => a + Number(r["optimized_acquisition_premium"] ?? 0), 0);
    const clearedValue = rows.reduce((a, r) => a + Number(r["base_contract_price"] ?? 0), 0);

    return {
      velocity: { ingested, scored, strikeSent, matched, dispatched },
      pendingFees,
      clearedValue,
      cron: "RUNNING (10m interval)",
    };
  });

export const runMasterCron = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    try {
      const origin = process.env["PUBLIC_SITE_URL"] ?? "https://asset-weaver-30.lovable.app";
      const res = await fetch(`${origin}/api/public/hooks/clearinghouse-master-cron`, { method: "POST" });
      const j = (await res.json()) as Record<string, any>;
      return {
        ok: !!j["ok"],
        arvs_calculated: Number(j["arvs_calculated"] ?? 0),
        counters_sent: Number(j["counters_sent"] ?? 0),
        matches_dispatched: Number(j["1031_matches_dispatched"] ?? 0),
        total_assignment_fees_locked: Number(j["total_assignment_fees_locked"] ?? 0),
        error: null as string | null,
      };
    } catch (e) {
      return {
        ok: false,
        arvs_calculated: 0,
        counters_sent: 0,
        matches_dispatched: 0,
        total_assignment_fees_locked: 0,
        error: (e as Error).message,
      };
    }
  });
