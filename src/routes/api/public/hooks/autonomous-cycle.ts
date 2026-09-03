// Zero-click cloud worker. Runs unattended on pg_cron (every minute) and is
// also fired directly by the closing_pipeline_items INSERT/UPDATE trigger via
// pg_net. No human click is required for any core workflow.
//
// Sequence (fail-forward — a failing step never blocks the next):
//   1. Settlement sweep  (DUE -> FEES IN TRANSIT, facility bypass on)
//   2. Ledger sheet sync (delta when the trigger passes ids, otherwise full)
//   3. Lender network broadcast to registered intake endpoints
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/autonomous-cycle")({
  server: {
    handlers: {
      GET: async ({ request }) => run({ origin: new URL(request.url).origin }),
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          ids?: string[];
          mode?: "full" | "delta";
          reason?: string;
        };
        return run({ ...(body ?? {}), origin: new URL(request.url).origin });
      },
    },
  },
});

/** Non-blocking heartbeat write. Never throws. */
async function beat(payload: Record<string, unknown>) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("system_config").upsert(
      {
        key: "last_autonomous_cycle",
        value: payload as never,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "key" },
    );
  } catch {
    /* heartbeat is non-blocking */
  }
}

async function run(body: {
  ids?: string[];
  mode?: "full" | "delta";
  reason?: string;
  origin?: string;
}) {
  const started = Date.now();
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean).slice(0, 500) : [];
  const mode = body.mode ?? (ids.length ? "delta" : "full");
  const out: Record<string, unknown> = { ok: true, reason: body.reason ?? "cron", mode };

  // Stamp the heartbeat BEFORE any work: a slow or truncated sweep must never
  // make the engine look dead. The terminal reads this key for liveness.
  await beat({ ...out, phase: "running", ran_at: new Date().toISOString() });


  // 0. autonomous release — lift the safety lock the moment rails verify
  try {
    const { attemptAutoRelease } = await import("@/lib/auto-release.server");
    out["auto_release"] = await attemptAutoRelease(body.reason ?? "cron");
  } catch (e) {
    out["auto_release"] = { ok: false, error: (e as Error).message };
  }

  // 0a. Scarcity engine — revoke lapsed 15-minute reservation locks and
  // re-cascade those assets to the next fund in the waterfall.
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("sweep_expired_reservations" as never);
    out["reservation_sweep"] = error
      ? { ok: false, error: error.message }
      : { ok: true, revoked: ((data as unknown[]) ?? []).length };
  } catch (e) {
    out["reservation_sweep"] = { ok: false, error: (e as Error).message };
  }

  // 0a-bis. 30-minute FBO eviction clock — a buyer that fails to wire inside
  // the window loses the account token and the asset returns to the open tape.
  try {
    const { runEvictionSweep } = await import("@/lib/eviction.server");
    out["eviction_sweep"] = await runEvictionSweep(200);
  } catch (e) {
    out["eviction_sweep"] = { ok: false, error: (e as Error).message };
  }


  // 0a2. Algorithmic track — 60-second M2M handshake sweep + JSON waterfall.
  try {
    const { sweepM2MTimeouts, dispatchM2MWaterfall } = await import("@/lib/m2m-algo.server");
    out["m2m_sweep"] = await sweepM2MTimeouts();
    out["m2m_dispatch"] = await dispatchM2MWaterfall();
  } catch (e) {
    out["m2m_sweep"] = { ok: false, error: (e as Error).message };
  }

  // 0a3. Micro-TIF circuit breaker — millisecond lock decay. A stalled
  // counterparty releases the asset instantly and takes a latency strike.
  try {
    const { sweepMicroTif, runDarkCross } = await import("@/lib/dark-cross.server");
    out["micro_tif"] = await sweepMicroTif();
    // 0a4. Cryptographic dark crossing — blind match sealed intents.
    out["dark_cross"] = await runDarkCross(50);
  } catch (e) {
    out["micro_tif"] = { ok: false, error: (e as Error).message };
  }

  // 0b. Stage 2 → Stage 3 chain: underwrite, mint FBO accounts, dispatch tape
  try {
    const { runPipelineChain } = await import("@/lib/pipeline-chain.server");
    const chain = await runPipelineChain({
      reason: body.reason ?? "cron",
      baseUrl: body.origin,
    });
    out["underwrite"] = chain.underwrite;
    out["fbo_provision"] = chain.fbo;
    out["buyer_dispatch"] = chain.dispatch;
  } catch (e) {
    out["fbo_provision"] = { ok: false, error: (e as Error).message };
  }

  // 0c. Autonomous allocation — standing capital matching + machine e-sign.
  try {
    const { runAutoAllocation } = await import("@/lib/auto-allocate.server");
    out["auto_allocation"] = await runAutoAllocation(50);
  } catch (e) {
    out["auto_allocation"] = { ok: false, error: (e as Error).message };
  }

  // 0c2. 1031 categorization + parity fee-lane routing (sovereign lock >= $100k).
  try {
    const { runAllocationLaneSweep } = await import("@/lib/allocation-lane.server");
    out["allocation_lane"] = await runAllocationLaneSweep(100);
  } catch (e) {
    out["allocation_lane"] = { ok: false, error: (e as Error).message };
  }



  // 0c-i. Anti-Deed matrix — wrap unwrapped assets in SPVs before allocation.
  try {
    const { provisionSpvWrappers } = await import("@/lib/spv-wrapper.server");
    out["spv_wrapping"] = await provisionSpvWrappers(50);
  } catch (e) {
    out["spv_wrapping"] = { ok: false, error: (e as Error).message };
  }

  // 0c-i-b. DUES Protocol — estoppel resolution + micro-escrow holdback.
  try {
    const { runDuesSweep } = await import("@/lib/dues.server");
    out["dues_protocol"] = await runDuesSweep(100);
  } catch (e) {
    out["dues_protocol"] = { ok: false, error: (e as Error).message };
  }

  // 0c-ii. Maker/Taker liquidity incentive recalculation.
  try {
    const { syncMakerTakerProfiles } = await import("@/lib/maker-taker.server");
    out["maker_taker"] = await syncMakerTakerProfiles();
  } catch (e) {
    out["maker_taker"] = { ok: false, error: (e as Error).message };
  }

  // 0c-iii. TTL micro-auction expiry + price ratchet.
  try {
    const { sweepMicroAuctions } = await import("@/lib/ttl-auction.server");
    out["ttl_auctions"] = await sweepMicroAuctions(200);
  } catch (e) {
    out["ttl_auctions"] = { ok: false, error: (e as Error).message };
  }

  // 0c-iv. Pre-crime predictive staging.
  try {
    const { runPreCrimeScan } = await import("@/lib/pre-crime.server");
    out["pre_crime"] = await runPreCrimeScan(100);
  } catch (e) {
    out["pre_crime"] = { ok: false, error: (e as Error).message };
  }

  // 0c-v. Tax-loss harvesting on dead inventory.
  try {
    const { harvestDeadAssets } = await import("@/lib/tax-harvest.server");
    out["tax_harvest"] = await harvestDeadAssets(200);
  } catch (e) {
    out["tax_harvest"] = { ok: false, error: (e as Error).message };
  }

  // 0c-vi. Bifurcated Cloud Matrix — Track A residential / Track B commercial.
  try {
    const { runBifurcationSweep, run1031PanicRouting } = await import("@/lib/bifurcation.server");
    out["bifurcation"] = await runBifurcationSweep(200);
    out["panic_1031"] = await run1031PanicRouting(50);
  } catch (e) {
    out["bifurcation"] = { ok: false, error: (e as Error).message };
  }

  // 0c-vii. Track B CRE underwriting — NOI / WALE / DSCR + DST-QOF packaging.
  try {
    const { runCreUnderwriteSweep } = await import("@/lib/cre-underwrite.server");
    out["cre_underwrite"] = await runCreUnderwriteSweep(150);
  } catch (e) {
    out["cre_underwrite"] = { ok: false, error: (e as Error).message };
  }

  // 0c-viii. Treasury routing — 80% corporate reserve / 20% compute reserve.
  try {
    const { runTreasuryRouting } = await import("@/lib/treasury.server");
    out["treasury"] = await runTreasuryRouting(100);
  } catch (e) {
    out["treasury"] = { ok: false, error: (e as Error).message };
  }

  // 0c-viii-b. Synthetic Tri-Party Clearing — service SBLOC debt in transit.
  try {
    const { runAtomicDebtSweep } = await import("@/lib/debt-sweep.server");
    out["atomic_debt_sweep"] = await runAtomicDebtSweep(100);
  } catch (e) {
    out["atomic_debt_sweep"] = { ok: false, error: (e as Error).message };
  }

  // 0c-ix. Zero-cost liquidity harvest — SEC EDGAR Form D / 8-K + weekly FOIA.
  try {
    const { runEdgarHarvest } = await import("@/lib/edgar.server");
    out["edgar_harvest"] = await runEdgarHarvest(60);
  } catch (e) {
    out["edgar_harvest"] = { ok: false, error: (e as Error).message };
  }
  try {
    const { runFoiaSweep } = await import("@/lib/foia.server");
    out["foia"] = await runFoiaSweep(false);
  } catch (e) {
    out["foia"] = { ok: false, error: (e as Error).message };
  }

  // 0c-bis. Jittered outbound dispatch drain (idempotent, bounded per cycle).
  try {
    const { runDispatchQueue } = await import("@/lib/dispatch-queue.server");
    out["dispatch_queue"] = await runDispatchQueue();
  } catch (e) {
    out["dispatch_queue"] = { ok: false, error: (e as Error).message };
  }

  // 0c-ter. Autonomous resolution loops — dispatch contracts, push payloads to
  // counterparties and order title instead of blocking on the operator.
  try {
    const { runGateResolution } = await import("@/lib/gate-resolution.server");
    out["gate_resolution"] = await runGateResolution(40);
  } catch (e) {
    out["gate_resolution"] = { ok: false, error: (e as Error).message };
  }

  // 0c-quater. Autonomous counterparty acquisition — resolve real corporate
  // domains for registry/EDGAR leads, MX-verify, and attach SEC phone numbers.
  // This removes the operator from contact sourcing entirely.
  try {
    const { runBuyerEnrichment } = await import("@/lib/buyer-enrichment.server");
    out["buyer_enrichment"] = await runBuyerEnrichment(8);
  } catch (e) {
    out["buyer_enrichment"] = { ok: false, error: (e as Error).message };
  }

  // 0c-quinquies. Registry contact discovery (Tier 1-4, MX gated).
  try {
    const { runContactDiscoveryWorker } = await import("@/lib/contact-discovery.server");
    out["contact_discovery"] = await runContactDiscoveryWorker(10);
  } catch (e) {
    out["contact_discovery"] = { ok: false, error: (e as Error).message };
  }

  // 0c-sexies. Institutional packet dispatch to verified counterparties only.
  try {
    const { runPacketDispatchWorker } = await import("@/lib/packet-dispatch.server");
    out["packet_dispatch"] = await runPacketDispatchWorker(15);
  } catch (e) {
    out["packet_dispatch"] = { ok: false, error: (e as Error).message };
  }

  // 0c-septies. Un-ACKed dispatch failover — a silent counterparty is
  // re-routed to the next standing buy box instead of stalling the tape.
  try {
    const base = (
      process.env["PUBLIC_APP_URL"] ||
      process.env["APP_PUBLIC_URL"] ||
      "http://localhost:8080"
    ).replace(/\/+$/, "");
    const res = await fetch(`${base}/api/public/hooks/ack`, { signal: AbortSignal.timeout(20_000) });
    out["ack_failover"] = await res.json();
  } catch (e) {
    out["ack_failover"] = { ok: false, error: (e as Error).message };
  }


  // 0d. Autonomous self-heal — clear exceptions, sanitize rows, drain outbox.
  try {
    const { runDiagnosticSweep } = await import("@/lib/self-heal.server");
    out["self_heal"] = await runDiagnosticSweep();
  } catch (e) {
    out["self_heal"] = { ok: false, error: (e as Error).message };
  }

  // 1. settlement
  try {
    const { runAutoSettleSweep, isAutoSettleEnabled } = await import("@/lib/auto-settle.server");
    if (await isAutoSettleEnabled()) {
      out["settlement"] = await runAutoSettleSweep(200, { bypassWindow: true });
    } else {
      out["settlement"] = { skipped: "auto_settle_disabled" };
    }
  } catch (e) {
    out["settlement"] = { ok: false, error: (e as Error).message };
  }

  // 2. sheet sync
  try {
    const { runLedgerSync } = await import("@/lib/ledger-sync.server");
    out["sheet_sync"] = await runLedgerSync({ mode, ids });
  } catch (e) {
    out["sheet_sync"] = { ok: false, error: (e as Error).message };
  }

  // 3. lender broadcast
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { broadcastLenderPackage } = await import("@/lib/lender-broadcast.server");
    const { data: rows } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id, parcel_number, apn, asset_class, asset_type, base_contract_price, zip, state")
      .is("cleared_at", null)
      .order("base_contract_price", { ascending: false })
      .limit(ids.length ? 500 : 250);
    const positions = ((rows ?? []) as any[]).filter((r) => !ids.length || ids.includes(r.id));
    if (positions.length) {
      out["lender_broadcast"] = await broadcastLenderPackage({
        trigger: body.reason ?? "cron",
        position_count: positions.length,
        collateral_value_usd: positions.reduce(
          (s, r) => s + (Number(r.base_contract_price) || 0),
          0,
        ),
        positions: positions.slice(0, 250).map((r) => ({
          id: r.id,
          parcel: r.parcel_number ?? r.apn ?? null,
          assetClass: r.asset_class ?? r.asset_type ?? "UNCLASSIFIED",
          valuation: Number(r.base_contract_price) || 0,
          zip: r.zip ?? null,
          state: r.state ?? null,
        })),
      });
    } else {
      out["lender_broadcast"] = { dispatched: false, reason: "no_open_positions" };
    }
  } catch (e) {
    out["lender_broadcast"] = { ok: false, error: (e as Error).message };
  }

  out["ms"] = Date.now() - started;
  out["ran_at"] = new Date().toISOString();
  out["phase"] = "complete";

  // final heartbeat with the full sub-result map
  await beat(out);


  return Response.json(out);
}
