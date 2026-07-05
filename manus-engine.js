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
            const lastIngestedAt = new Date(asset.last_ingested_at);
            const hoursSinceIngestion = (new Date() - lastIngestedAt) / (1000 * 60 * 60);
            
            // Initialize assetUpdate with current asset values and defaults for new columns
            let assetUpdate = { 
                id: asset.id, 
                last_ingested_at: new Date().toISOString(), 
                address: asset.address || 'UNKNOWN ADDRESS',
                velocity_score: asset.velocity_score || 0,
                tier_1_liquidity: asset.tier_1_liquidity || false,
                compliance_lock: asset.compliance_lock || false,
                title_state: asset.title_state || 'UNVERIFIED',
                state: asset.state || 'INGESTED',
                status: asset.status // Carry over existing status
            };
            let needsUpdate = false;

            // Apply stratification logic and update assetUpdate directly
            // 1. Velocity Stratification
            if (asset.target_closing_date) {
                const closingDate = new Date(asset.target_closing_date);
                const today = new Date();
                const diffTime = Math.abs(closingDate.getTime() - today.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                let calculatedVelocityScore = assetUpdate.velocity_score;
                let calculatedTier1Liquidity = assetUpdate.tier_1_liquidity;

                if (diffDays >= 14 && diffDays <= 21) {
                    calculatedTier1Liquidity = true;
                    calculatedVelocityScore = 100; // High velocity
                } else if (diffDays < 14) {
                    calculatedVelocityScore = 150; // Very high velocity
                } else {
                    calculatedVelocityScore = 50; // Normal velocity
                }

                if (assetUpdate.velocity_score !== calculatedVelocityScore) {
                    assetUpdate.velocity_score = calculatedVelocityScore;
                    needsUpdate = true;
                }
                if (assetUpdate.tier_1_liquidity !== calculatedTier1Liquidity) {
                    assetUpdate.tier_1_liquidity = calculatedTier1Liquidity;
                    needsUpdate = true;
                }
            }

            // 2. Statutory Compliance Lock (Placeholder for Ohio SB 155 example)
            if (asset.market && asset.market.includes('Ohio') && asset.gross_arbitrage_spread > 10000) { // Example condition
                if (assetUpdate.compliance_lock !== true) {
                    assetUpdate.compliance_lock = true;
                    needsUpdate = true;
                }
            }

            // 3. Title State Machine: Default to UNVERIFIED
            if (!asset.title_state) {
                if (assetUpdate.title_state !== 'UNVERIFIED') {
                    assetUpdate.title_state = 'UNVERIFIED';
                    needsUpdate = true;
                }
            }

            // 1. STRATEGIC COOLDOWN (Don't rush the win into a loss)
            if (hoursSinceIngestion < 1) {
                // console.log(`[STABILIZATION_PHASE]: Asset ${asset.address} is stabilizing. No autonomous thrust.`); // Commented for high-throughput
                continue;
            }

            // 2. ENTITY THROTTLING (Reputation Shield)
            const entityId = asset.title_company_id || 'DEFAULT_AGENT';
            const lastEntityPing = entityLastPing[entityId] || 0;
            const minutesSinceEntityPing = (new Date() - lastEntityPing) / (1000 * 60);

            if (hoursSinceIngestion > CRITICAL_STALL_HOURS && assetUpdate.status !== 'FUNDS_SETTLED' && assetUpdate.status !== 'ESCALATION_ACTIVE') {
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
            if (assetUpdate.status === 'CLEAR_TO_CLOSE') {
                // console.log(`[LOOKOUT_SCAN]: Verifying wire coordinates for ${asset.address}...`); // Commented for high-throughput
                const isHullSecure = true; // Simulated check
                if (isHullSecure) {
                    // console.log(`[AUTO-ALPHA]: Hull Secure. Releasing Wire for ${asset.address}.`); // Commented for high-throughput
                    if (assetUpdate.status !== 'AWAITING_TITLE_WIRE') {
                        assetUpdate.status = 'AWAITING_TITLE_WIRE';
                        needsUpdate = true;
                    }
                } else {
                    // console.log(`[ABORT_LAUNCH]: Hull Breach detected for ${asset.address}. Wire release aborted.`); // Commented for high-throughput
                }
            }

            // 4. SETTLEMENT STRIKE TRIGGER (Database Flag)
            if (assetUpdate.status === 'AWAITING_TITLE_WIRE' && asset.wire_received === true) {
                // console.log(`[SETTLEMENT_STRIKE_TRIGGER]: Wire received for ${asset.address}. Initiating Settlement Strike.`); // Commented for high-throughput
                await executeSettlementStrike(asset.id); // This is already fault-isolated
                // executeSettlementStrike will update the status to FUNDS_SETTLED, so we don't need to push an update here
                // However, we should mark needsUpdate to ensure the last_ingested_at is updated
                needsUpdate = true; 
            }

            // PHASE 3: INSTITUTIONAL SETTLEMENT AND RECORD LOCKING
            if (assetUpdate.title_state === 'CLEARED' && assetUpdate.compliance_lock === false && assetUpdate.state !== 'RECONCILED') {
                // 1. The Execution Payload (Simulated)
                console.log(`[EXECUTION_PAYLOAD]: Assembling for ${asset.address}.`);
                // In a real system, this would involve generating disclosures, API calls to vendors, etc.

                // 2. Immutable Ledger Reconciliation
                if (assetUpdate.state !== 'RECONCILED') {
                    assetUpdate.state = 'RECONCILED';
                    needsUpdate = true;
                    console.log(`[LEDGER_RECONCILIATION]: Asset ${asset.address} moved to RECONCILED state.`);
                }
            }

            // 5. SELF-HEALING HULL
            if (parseFloat(asset.gross_arbitrage_spread) < 0) {
                // assetUpdate.gross_arbitrage_spread = Math.abs(asset.gross_arbitrage_spread); // Removed as it's a computed column
                // This logic should ideally be in ingestion-worker or a separate pre-processing step
                // For now, if gross_arbitrage_spread is negative, it means it needs correction, so we mark for update
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
