const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// NASA-TITANIC V8.0: THE STRATEGIC COMMANDER
const STALL_THRESHOLD_HOURS = 48;
const CRITICAL_STALL_HOURS = 72;
const ENTITY_THROTTLE_MINUTES = 60; // Wait 60 mins between pings to the same entity

let entityLastPing = {}; // Track pings to Title Companies/Agents

const executeSettlementStrike = async (dealId) => {
    console.log(`[SETTLEMENT_STRIKE]: Initiating for Deal ID: ${dealId}`);
    try {
        const { data: deal, error: fetchError } = await supabase
            .from("deals_master")
            .select("*")
            .eq("id", dealId)
            .single();

        if (fetchError) throw fetchError;

        if (!deal) {
            console.log(`[SETTLEMENT_STRIKE]: Deal ${dealId} not found.`);
            return;
        }

        if (deal.status !== "AWAITING_TITLE_WIRE") {
            console.log(`[SETTLEMENT_STRIKE]: Deal ${dealId} is not in AWAITING_TITLE_WIRE status. Current status: ${deal.status}`);
            return;
        }

        const grossArbitrage = deal.gross_arbitrage_spread;
        const netProfit = grossArbitrage * 0.7;
        const taxReserve = grossArbitrage * 0.3;

        const { error: updateError } = await supabase
            .from("deals_master")
            .update({
                status: "FUNDS_SETTLED",
                net_profit: netProfit,
                tax_reserve: taxReserve,
                last_ingested_at: new Date().toISOString(),
                wire_received: false // Reset flag after processing
            })
            .eq("id", dealId);

        if (updateError) throw updateError;

        console.log(`[SETTLEMENT_STRIKE]: Deal ${dealId} moved to FUNDS_SETTLED. Net Profit: $${netProfit.toFixed(2)}, Tax Reserve: $${taxReserve.toFixed(2)}`);

    } catch (error) {
        console.error(`[SETTLEMENT_STRIKE_ERROR]: Failed for Deal ID ${dealId}:`, error.message);
    }
};

const runStrategicCycle = async () => {
    console.log('Juggernaut Strategic Engine: [SCANNING_TRAJECTORY_WITH_WISDOM]');
    try {
        const { data: assets } = await supabase.from("deals_master").select("*").neq("state", "RECONCILED"); // Ingestion Shielding
        if (!assets) return;

        const updates = [];
        const CHUNK_SIZE = 50; // Institutional standard for connection pool protection

        for (const asset of assets) {
            const lastUpdate = new Date(asset.updated_at);
            const hoursSinceUpdate = (new Date() - lastUpdate) / (1000 * 60 * 60);
            let assetUpdate = { id: asset.id, last_ingested_at: new Date().toISOString(), address: asset.address || 'UNKNOWN ADDRESS' };
            let needsUpdate = false;
            let velocityScore = asset.velocity_score || 0;
            let tier1Liquidity = asset.tier_1_liquidity || false;
            let complianceLock = asset.compliance_lock || false;
            let titleState = asset.title_state || 'UNVERIFIED';
            let state = asset.state || 'INGESTED';

            // 1. Velocity Stratification
            if (asset.target_closing_date) {
                const closingDate = new Date(asset.target_closing_date);
                const today = new Date();
                const diffTime = Math.abs(closingDate.getTime() - today.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays >= 14 && diffDays <= 21) {
                    tier1Liquidity = true;
                    velocityScore = 100; // High velocity
                } else if (diffDays < 14) {
                    velocityScore = 150; // Very high velocity
                } else {
                    velocityScore = 50; // Normal velocity
                }
            }

            // 2. Statutory Compliance Lock (Placeholder for Ohio SB 155 example)
            if (asset.market && asset.market.includes('Ohio') && asset.gross_arbitrage_spread > 10000) { // Example condition
                complianceLock = true;
            }

            // 3. Title State Machine: Default to UNVERIFIED
            if (!asset.title_state) {
                titleState = 'UNVERIFIED';
            }

            // Update asset properties for UPSERT
            assetUpdate.velocity_score = velocityScore;
            assetUpdate.tier_1_liquidity = tier1Liquidity;
            assetUpdate.compliance_lock = complianceLock;
            assetUpdate.title_state = titleState;
            assetUpdate.state = state;

            // 1. STRATEGIC COOLDOWN (Don't rush the win into a loss)
            if (hoursSinceUpdate < 1) {
                // console.log(`[STABILIZATION_PHASE]: Asset ${asset.address} is stabilizing. No autonomous thrust.`); // Commented for high-throughput
                continue;
            }

            // 2. ENTITY THROTTLING (Reputation Shield)
            const entityId = asset.title_company_id || 'DEFAULT_AGENT';
            const lastEntityPing = entityLastPing[entityId] || 0;
            const minutesSinceEntityPing = (new Date() - lastEntityPing) / (1000 * 60);

            if (hoursSinceUpdate > CRITICAL_STALL_HOURS && asset.status !== 'FUNDS_SETTLED' && asset.status !== 'ESCALATION_ACTIVE') {
                if (minutesSinceEntityPing > ENTITY_THROTTLE_MINUTES) {
                    // console.log(`[STRATEGIC_ESCALATION]: Triggering Audit for ${asset.address}`); // Commented for high-throughput
                    assetUpdate.status = 'ESCALATION_ACTIVE';
                    entityLastPing[entityId] = new Date();
                    needsUpdate = true;
                } else {
                    // console.log(`[REPUTATION_SHIELD]: Holding escalation for ${asset.address} to avoid flooding entity ${entityId}.`); // Commented for high-throughput
                }
            }

            // 3. THE "LOOKOUT" VERIFICATION (Pre-Wire Audit)
            if (asset.status === 'CLEAR_TO_CLOSE') {
                // console.log(`[LOOKOUT_SCAN]: Verifying wire coordinates for ${asset.address}...`); // Commented for high-throughput
                const isHullSecure = true; // Simulated check
                if (isHullSecure) {
                    // console.log(`[AUTO-ALPHA]: Hull Secure. Releasing Wire for ${asset.address}.`); // Commented for high-throughput
                    assetUpdate.status = 'AWAITING_TITLE_WIRE';
                    needsUpdate = true;
                } else {
                    // console.log(`[ABORT_LAUNCH]: Hull Breach detected for ${asset.address}. Wire release aborted.`); // Commented for high-throughput
                }
            }

            // 4. SETTLEMENT STRIKE TRIGGER (Database Flag)
            if (asset.status === 'AWAITING_TITLE_WIRE' && asset.wire_received === true) {
                // console.log(`[SETTLEMENT_STRIKE_TRIGGER]: Wire received for ${asset.address}. Initiating Settlement Strike.`); // Commented for high-throughput
                await executeSettlementStrike(asset.id); // This is already fault-isolated
            }

            // PHASE 3: INSTITUTIONAL SETTLEMENT AND RECORD LOCKING
            if (asset.title_state === 'CLEARED' && asset.compliance_lock === false && asset.state !== 'RECONCILED') {
                // 1. The Execution Payload (Simulated)
                console.log(`[EXECUTION_PAYLOAD]: Assembling for ${asset.address}.`);
                // In a real system, this would involve generating disclosures, API calls to vendors, etc.

                // 2. Immutable Ledger Reconciliation
                assetUpdate.state = 'RECONCILED';
                needsUpdate = true;
                console.log(`[LEDGER_RECONCILIATION]: Asset ${asset.address} moved to RECONCILED state.`);
            }
            }

            // 5. SELF-HEALING HULL
            if (parseFloat(asset.gross_arbitrage_spread) < 0) {
                // assetUpdate.gross_arbitrage_spread = Math.abs(asset.gross_arbitrage_spread); // Removed as it's a computed column
                needsUpdate = true;
            }

            if (needsUpdate) {
                updates.push(assetUpdate);
            }
        }

        // Process updates in chunks with fault isolation
        for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
            const chunk = updates.slice(i, i + CHUNK_SIZE);
            const updatePromises = chunk.map(async (updateData) => {
                const { error: updateError } = await supabase
                    .from('deals_master')
                    .upsert(updateData, { onConflict: 'id' }); // Atomic UPSERT
                if (updateError) {
                    console.error(`[STRATEGIC_ENGINE_ERROR]: Failed to update asset ${updateData.id}:`, updateError.message);
                    return { status: 'rejected', reason: updateError };
                }
                return { status: 'fulfilled', value: updateData.id };
            });
            await Promise.allSettled(updatePromises); // Fault-isolated concurrency
        }
        console.log('Juggernaut Strategic Engine: Strategic Cycle Complete. All assets processed.');

    } catch (e) {
        console.error('Strategic Engine Error:', e.message);
    }
};

// RUN EVERY 5 MINUTES
setInterval(runStrategicCycle, 5 * 60 * 1000);
runStrategicCycle();
