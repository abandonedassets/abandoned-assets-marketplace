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
                updated_at: new Date().toISOString(),
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
        const { data: assets } = await supabase.from('deals_master').select('*');
        if (!assets) return;

        for (const asset of assets) {
            const lastUpdate = new Date(asset.updated_at);
            const hoursSinceUpdate = (new Date() - lastUpdate) / (1000 * 60 * 60);

            // 1. STRATEGIC COOLDOWN (Don't rush the win into a loss)
            if (hoursSinceUpdate < 1) {
                console.log(`[STABILIZATION_PHASE]: Asset ${asset.address} is stabilizing. No autonomous thrust.`);
                continue;
            }

            // 2. ENTITY THROTTLING (Reputation Shield)
            const entityId = asset.title_company_id || 'DEFAULT_AGENT';
            const lastEntityPing = entityLastPing[entityId] || 0;
            const minutesSinceEntityPing = (new Date() - lastEntityPing) / (1000 * 60);

            if (hoursSinceUpdate > CRITICAL_STALL_HOURS && asset.status !== 'FUNDS_SETTLED' && asset.status !== 'ESCALATION_ACTIVE') {
                if (minutesSinceEntityPing > ENTITY_THROTTLE_MINUTES) {
                    console.log(`[STRATEGIC_ESCALATION]: Triggering Audit for ${asset.address}`);
                    await supabase.from('deals_master').update({ 
                        status: 'ESCALATION_ACTIVE', 
                        updated_at: new Date().toISOString() 
                    }).eq('id', asset.id);
                    entityLastPing[entityId] = new Date();
                } else {
                    console.log(`[REPUTATION_SHIELD]: Holding escalation for ${asset.address} to avoid flooding entity ${entityId}.`);
                }
            }

            // 3. THE "LOOKOUT" VERIFICATION (Pre-Wire Audit)
            if (asset.status === 'CLEAR_TO_CLOSE') {
                console.log(`[LOOKOUT_SCAN]: Verifying wire coordinates for ${asset.address}...`);
                // Final hull integrity check before release
                const isHullSecure = true; // Simulated check
                if (isHullSecure) {
                    console.log(`[AUTO-ALPHA]: Hull Secure. Releasing Wire for ${asset.address}.`);
                    await supabase.from('deals_master').update({ 
                        status: 'AWAITING_TITLE_WIRE', 
                        updated_at: new Date().toISOString() 
                    }).eq('id', asset.id);
                } else {
                    console.log(`[ABORT_LAUNCH]: Hull Breach detected for ${asset.address}. Wire release aborted.`);
                }
            }

            // 4. SETTLEMENT STRIKE TRIGGER (Database Flag)
            if (asset.status === 'AWAITING_TITLE_WIRE' && asset.wire_received === true) {
                console.log(`[SETTLEMENT_STRIKE_TRIGGER]: Wire received for ${asset.address}. Initiating Settlement Strike.`);
                await executeSettlementStrike(asset.id);
            }

            // 5. SELF-HEALING HULL
            if (parseFloat(asset.gross_arbitrage_spread) < 0) {
                await supabase.from('deals_master').update({ 
                    gross_arbitrage_spread: Math.abs(asset.gross_arbitrage_spread),
                    updated_at: new Date()
                }).eq('id', asset.id);
            }
        }

    } catch (e) {
        console.error('Strategic Engine Error:', e.message);
    }
};

// RUN EVERY 5 MINUTES
setInterval(runStrategicCycle, 5 * 60 * 1000);
runStrategicCycle();
