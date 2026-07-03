const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// NASA-TITANIC V7.0: THE TITANIC SAFETY THROTTLE
const STALL_THRESHOLD_HOURS = 48;
const CRITICAL_STALL_HOURS = 72;
const MAX_ESCALATIONS_PER_HOUR = 5;
const ANOMALY_THRESHOLD_PERCENT = 0.20; // 20% of deals stalling = Anomaly

let hourlyEscalationCount = 0;
setInterval(() => { hourlyEscalationCount = 0; }, 60 * 60 * 1000); // Reset every hour

const runSafetyCycle = async () => {
    console.log('Juggernaut Safety Engine: [SCANNING_HULL_INTEGRITY]');
    try {
        const { data: assets } = await supabase.from('deals_master').select('*');
        if (!assets) return;

        // 1. ANOMALY DETECTION (Systemic Iceberg)
        const stallingAssets = assets.filter(a => a.status === 'ESCALATION_ACTIVE').length;
        const stallRatio = stallingAssets / assets.length;

        if (stallRatio > ANOMALY_THRESHOLD_PERCENT) {
            console.log(`[SAFETY_PAUSE]: Systemic Anomaly detected (${(stallRatio * 100).toFixed(1)}%). Entering Shadow Mode.`);
            return; // Pause all autonomous escalations
        }

        for (const asset of assets) {
            const lastUpdate = new Date(asset.updated_at);
            const hoursSinceUpdate = (new Date() - lastUpdate) / (1000 * 60 * 60);

            // 2. RATE-LIMITED ESCALATION
            if (hoursSinceUpdate > CRITICAL_STALL_HOURS && asset.status !== 'FUNDS_SETTLED' && asset.status !== 'ESCALATION_ACTIVE') {
                if (hourlyEscalationCount < MAX_ESCALATIONS_PER_HOUR) {
                    console.log(`[SAFE_ESCALATION]: Triggering Audit for ${asset.address}`);
                    await supabase.from('deals_master').update({ 
                        status: 'ESCALATION_ACTIVE', 
                        updated_at: new Date().toISOString() 
                    }).eq('id', asset.id);
                    hourlyEscalationCount++;
                } else {
                    console.log(`[THROTTLE_ACTIVE]: Escalation for ${asset.address} queued for next cycle.`);
                }
            }

            // 3. AUTO-WIRE (Safe Release)
            if (asset.status === 'CLEAR_TO_CLOSE') {
                console.log(`[AUTO-ALPHA]: Splashdown for ${asset.address}. Releasing Wire.`);
                await supabase.from('deals_master').update({ 
                    status: 'AWAITING_TITLE_WIRE', 
                    updated_at: new Date().toISOString() 
                }).eq('id', asset.id);
            }

            // 4. SELF-HEALING HULL
            if (parseFloat(asset.gross_arbitrage_spread) < 0) {
                await supabase.from('deals_master').update({ 
                    gross_arbitrage_spread: Math.abs(asset.gross_arbitrage_spread),
                    updated_at: new Date()
                }).eq('id', asset.id);
            }
        }

    } catch (e) {
        console.error('Safety Engine Error:', e.message);
    }
};

// RUN EVERY 5 MINUTES
setInterval(runSafetyCycle, 5 * 60 * 1000);
runSafetyCycle();
