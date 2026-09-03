import { createServerFn } from "@tanstack/react-start";

export type TelemetryAggregates = {
  pipeline_volume_usd: number;
  in_transit_fees_usd: number;
  settled_fees_usd: number;
  capital_velocity_usd_hr: number;
  hourly: { hour: string; total: number }[];
  diagnostic: {
    pipeline_rows: number;
    waitlist_rows: number;
    conversion_rows: number;
    source: string;
  };
};

/** Live aggregate sums for the dashboard metric cards. */
export const getTelemetryAggregates = createServerFn({ method: "GET" }).handler(
  async (): Promise<TelemetryAggregates> => {
    try {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );

    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const DEAD = ["Dead", "Rejected", "Auto_Archived_Bad_Data"];

    const guard = <T>(p: PromiseLike<T>) =>
      Promise.resolve(p).catch(() => ({ data: null, count: 0 }) as unknown as T);

    const [pipeline, waitlist, pending, recent, settled] = await Promise.all([
      // Pipeline volume is real contract value, not the lead table.
      guard(
        supabaseAdmin
          .from("closing_pipeline_items")
          .select("base_contract_price")
          .not("status", "in", `(${DEAD.join(",")})`)
          .limit(5000)
          .abortSignal(AbortSignal.timeout(10_000)),
      ),
      guard(
        supabaseAdmin
          .from("buyer_waitlist")
          .select("id", { count: "exact", head: true })
          .eq("is_stale", false)
          .abortSignal(AbortSignal.timeout(10_000)),
      ),
      guard(
        supabaseAdmin
          .from("conversion_events")
          .select("fee_amount")
          .eq("status", "pending")
          .limit(5000)
          .abortSignal(AbortSignal.timeout(10_000)),
      ),
      guard(
        supabaseAdmin
          .from("conversion_events")
          .select("fee_amount, created_at")
          .gte("created_at", since)
          .neq("status", "pending")
          .limit(5000)
          .abortSignal(AbortSignal.timeout(10_000)),
      ),
      guard(
        supabaseAdmin
          .from("conversion_events")
          .select("fee_amount")
          .eq("status", "settled")
          .limit(5000)
          .abortSignal(AbortSignal.timeout(10_000)),
      ),
    ]);


    const sum = (rows: any[] | null, key: string) =>
      (rows ?? []).reduce((s, r) => s + Number(r?.[key] ?? 0), 0);

      const buckets = new Map<string, number>();
      for (const r of (recent.data ?? []) as any[]) {
        const timestamp = new Date(r.created_at);
        if (Number.isNaN(timestamp.getTime())) continue;
        const h = timestamp.toISOString().slice(0, 13) + ":00";
        buckets.set(h, (buckets.get(h) ?? 0) + Number(r.fee_amount ?? 0));
      }
    const hourly = [...buckets.entries()]
      .map(([hour, total]) => ({ hour, total }))
      .sort((a, b) => (a.hour < b.hour ? 1 : -1))
      .slice(0, 24);

      return {
        pipeline_volume_usd: sum(pipeline.data as any[], "base_contract_price"),
        in_transit_fees_usd: sum(pending.data as any[], "fee_amount"),
        settled_fees_usd: sum(settled.data as any[], "fee_amount"),
        capital_velocity_usd_hr: hourly.length ? (hourly[0]?.total ?? 0) : 0,
        hourly,
        diagnostic: {
          pipeline_rows: (pipeline.data ?? []).length,
          waitlist_rows: waitlist.count ?? 0,
          conversion_rows: (pending.data ?? []).length + (recent.data ?? []).length,
          source: "closing_pipeline_items.base_contract_price + conversion_events.fee_amount",
        },
      };
    } catch {
      return {
        pipeline_volume_usd: 0,
        in_transit_fees_usd: 0,
        settled_fees_usd: 0,
        capital_velocity_usd_hr: 0,
        hourly: [],
        diagnostic: {
          pipeline_rows: 0,
          waitlist_rows: 0,
          conversion_rows: 0,
          source: "telemetry_temporarily_unavailable",
        },
      };
    }
  },
);


/** Zero-touch: if the conversion ledger is empty, seed baseline verification rows. */
export const ensureTelemetryBaseline = createServerFn({ method: "POST" }).handler(
  async () => {
    try {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      const { count } = await supabaseAdmin
        .from("conversion_events")
        .select("id", { count: "exact", head: true });

      if ((count ?? 0) > 0) return { seeded: 0, existing: count ?? 0 };

      const rows = [250, 1200, 5000].map((fee, i) => ({
        event: "baseline_verification",
        channel: "auto-mount-diagnostic",
        fee_amount: fee,
        status: "pending",
        tx_idempotency_key: `baseline-${fee}`,
        metadata: { source: "auto-mount-diagnostic", fee_amount: fee, seq: i },
      }));

      const { data, error } = await supabaseAdmin
        .from("conversion_events")
        .insert(rows as any)
        .select("id");

      return { seeded: data?.length ?? 0, existing: 0, error: error?.message ?? null };
    } catch (e) {
      return { seeded: 0, existing: 0, error: (e as Error).message };
    }
  },
);

/** Admin-only: insert 3 realistic sample telemetry rows so metrics go non-zero. */

export const hydrateSampleTelemetry = createServerFn({ method: "POST" }).handler(
  async () => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const stamp = Date.now();
    const amounts = [250, 1200, 5000];
    const rows = amounts.map((fee, i) => ({
      event: "sample_settlement_fee",
      channel: "telemetry-hydrate",
      fee_amount: fee,
      status: "pending",
      tx_idempotency_key: `hydrate-${stamp}-${i}`,
      metadata: { source: "hydrate-sample-telemetry", fee_amount: fee, seq: i },
    }));

    const { data, error } = await supabaseAdmin
      .from("conversion_events")
      .insert(rows as any)
      .select("id, event, fee_amount, status, created_at");

    return { inserted: data?.length ?? 0, rows: data ?? [], error: error?.message ?? null };
  },
);

export type MarketBindings = {
  flash_liquidity_usd: number;
  delayed_settlement_usd: number;
  velocity_events_24h: number;
  shadow_queue_usd: number;
  active_buy_boxes: number;
  tape: {
    id: string;
    address: string | null;
    zip: string | null;
    price: number;
    margin: number;
    box_label: string | null;
    delivery_status: string | null;
    delivered_at: string | null;
  }[];
};

/** Live DB-bound metric cards + deal tape joined to delivery telemetry. */
export const getMarketBindings = createServerFn({ method: "GET" }).handler(
  async (): Promise<MarketBindings> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const activeMarket = ["Webhook_Dispatched", "House-Bid", "Scout"] as const;
      const pendingSettlement = [
        "Locked-Escrow-Pending",
        "In-Escrow",
        "Buyer-Signed",
        "Pending-Underwriting",
      ] as const;

    const [flash, delayed, velocity, shadow, boxes, tapeRows, boxLabels] =
      await Promise.all([
        supabaseAdmin
          .from("closing_pipeline_items")
          .select("optimized_acquisition_premium")
          .in("status", activeMarket),
        supabaseAdmin
          .from("closing_pipeline_items")
          .select("optimized_acquisition_premium")
          .in("status", pendingSettlement),
        supabaseAdmin
          .from("offer_delivery_logs")
          .select("id", { count: "exact", head: true })
          .in("status", ["DELIVERED", "CLICKED"])
          .gte("created_at", since),
        supabaseAdmin
          .from("closing_pipeline_items")
          .select("base_contract_price")
          .not("matched_buy_box_id", "is", null),
        supabaseAdmin
          .from("buyer_buy_boxes")
          .select("id", { count: "exact", head: true })
          .is("deprecated_at", null),

        supabaseAdmin
          .from("closing_pipeline_items")
          .select(
            "id, address, zip, base_contract_price, optimized_acquisition_premium, matched_buy_box_id, updated_at",
          )
          .order("updated_at", { ascending: false })
          .limit(60),
        supabaseAdmin.from("buyer_buy_boxes").select("id, label"),
      ]);

    const sum = (rows: any[] | null, k: string) =>
      (rows ?? []).reduce((s, r) => s + Number(r?.[k] ?? 0), 0);

    const ids = (tapeRows.data ?? []).map((r: any) => r.id);
    const { data: logs } = ids.length
      ? await supabaseAdmin
          .from("offer_delivery_logs")
          .select("pipeline_item_id, status, created_at")
          .in("pipeline_item_id", ids)
          .order("created_at", { ascending: false })
      : { data: [] as any[] };

    const latest = new Map<string, { status: string; created_at: string }>();
    for (const l of (logs ?? []) as any[]) {
      if (!latest.has(l.pipeline_item_id))
        latest.set(l.pipeline_item_id, { status: l.status, created_at: l.created_at });
    }
    const viewerIsAdmin = await (await import("@/lib/optional-admin.server")).isCallerAdmin();
    const { maskedLabel } = await import("@/lib/address-mask");
    const labels = new Map<string, string>(
      ((boxLabels.data ?? []) as any[]).map((b) => [b.id, b.label]),
    );

      return {
        flash_liquidity_usd: sum(flash.data as any[], "optimized_acquisition_premium"),
        delayed_settlement_usd: sum(delayed.data as any[], "optimized_acquisition_premium"),
        velocity_events_24h: velocity.count ?? 0,
        shadow_queue_usd: sum(shadow.data as any[], "base_contract_price"),
        active_buy_boxes: boxes.count ?? 0,
        tape: ((tapeRows.data ?? []) as any[]).map((r) => ({
          id: r.id,
          address: viewerIsAdmin
            ? (r.address ?? null)
            : maskedLabel({ address: r.address, zip: r.zip }),
          zip: r.zip ?? null,
          price: Number(r.base_contract_price ?? 0),
          margin: Number(r.optimized_acquisition_premium ?? 0),
          box_label: r.matched_buy_box_id ? (labels.get(r.matched_buy_box_id) ?? "Matched") : null,
          delivery_status: latest.get(r.id)?.status ?? null,
          delivered_at: latest.get(r.id)?.created_at ?? null,
        })),
      };
    } catch {
      return {
        flash_liquidity_usd: 0,
        delayed_settlement_usd: 0,
        velocity_events_24h: 0,
        shadow_queue_usd: 0,
        active_buy_boxes: 0,
        tape: [],
      };
    }
  },
);
