/**
 * ARCHITECTURAL BUILD: MANUS-ENGINE.JS
 * STATUS: MONOLITHIC REFACTOR - PRODUCTION GRADE
 * ENVIRONMENT: Keys injected via process.env (Render Dashboard)
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("[FATAL] Missing SUPABASE_URL or SUPABASE_KEY. Halting.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runStrategicCycle() {
    console.log("Strategic Cycle Initiated: LIGHT SPEED OPTIMIZATION MODE.");

    try {
        const { data: deals, error: fetchError } = await supabase
            .from('deals_master')
            .select('*')
            .eq('state', 'INGESTED');

        if (fetchError) throw fetchError;
        if (!deals || deals.length === 0) {
            console.log("Pipeline Sync: No assets in INGESTED state. Cycle complete.");
            return;
        }

        console.log(`Pipeline Sync: Processing ${deals.length} assets.`);

        let settled = 0;
        let failed = 0;

        for (const deal of deals) {
            const velocityScore = calculateVelocity(deal);
            const assetUpdate = {
                velocity_score: velocityScore,
                tier_1_liquidity: (velocityScore >= 80),
                compliance_lock: true,
                title_state: 'VERIFIED',
                state: 'SETTLED'
            };

            try {
                const { error: updateError } = await supabase
                    .from('deals_master')
                    .update(assetUpdate)
                    .eq('id', deal.id);

                if (updateError) throw updateError;
                console.log(`[SUCCESS] Asset ID ${deal.id} settled. Velocity: ${velocityScore}`);
                settled++;
            } catch (innerError) {
                console.error(`[CRITICAL] Engine stall on Asset ${deal.id}:`, innerError.message);
                failed++;
                continue;
            }
        }

        console.log(`--- Cycle Report ---`);
        console.log(`Total Processed: ${deals.length}`);
        console.log(`Settled: ${settled}`);
        console.log(`Failed: ${failed}`);
        console.log(`--- End Report ---`);

    } catch (globalError) {
        console.error("[FATAL] Critical System Failure:", globalError.message);
    }
}

function calculateVelocity(deal) {
    const base = deal.arb_spread_pct || 0;
    return Math.min(Math.floor(base * 5), 100);
}

runStrategicCycle().catch(console.error);
