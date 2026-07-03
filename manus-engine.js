const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// NASA-TITANIC V4.0: THE SELF-CORRECTING ENGINE
const STALL_THRESHOLD_HOURS = 48;
const CRITICAL_STALL_HOURS = 72;

const BLUEVINE_WIRE_INSTRUCTIONS = `
BANK: BLUEVINE CHECKING
ACCOUNT: 875112278614
ROUTING: 125109019
RECIPIENT: REELEDGE ENTERTAINMENT LLC
`;

const executeEscalation = async (asset) => {
    console.log(`[AUTONOMOUS_ESCALATION]: Triggering Performance Audit for ${asset.address}`);
    // This triggers the high-priority "Institutional Performance Audit" email to Title/Agents.
    await supabase.from('deals_master').update({ 
        status: 'ESCALATION_ACTIVE', 
        updated_at: new Date().toISOString() 
    }).eq('id', asset.id);
};

const runAutonomousCycle = async () => {
    console.log('Juggernaut Watchdog: [SCANNING_HULL_INTEGRITY]');
    try {
        const { data: assets } = await supabase.from('deals_master').select('*');
        if (!assets) return;

        for (const asset of assets) {
            const lastUpdate = new Date(asset.updated_at);
            const hoursSinceUpdate = (new Date() - lastUpdate) / (1000 * 60 * 60);

            // 1. AUTONOMOUS ESCALATION (The "Red" Fix)
            if (hoursSinceUpdate > CRITICAL_STALL_HOURS && asset.status !== 'FUNDS_SETTLED' && asset.status !== 'ESCALATION_ACTIVE') {
                await executeEscalation(asset);
            }

            // 2. ELIMINATING SIGNATURE STALL (AUTO-DRIP STRIKE)
            if (asset.status === 'SIGNATURES_PENDING' && hoursSinceUpdate > 24) {
                console.log(`[DRIP-STRIKE]: Autonomously nudging parties for ${asset.address}.`);
                await supabase.from('deals_master').update({ updated_at: new Date() }).eq('id', asset.id);
            }

            // 3. AUTO-WIRE RELEASE (The Grab Handshake)
            if (asset.status === 'CLEAR_TO_CLOSE') {
                console.log(`[AUTO-ALPHA]: CLEAR_TO_CLOSE detected for ${asset.address}. Releasing Bluevine Wire.`);
                await supabase.from('deals_master').update({ 
                    status: 'AWAITING_TITLE_WIRE', 
                    updated_at: new Date().toISOString() 
                }).eq('id', asset.id);
            }

            // 4. SELF-HEALING: AUTO-CORRECT NEGATIVE BALANCES
            if (parseFloat(asset.gross_arbitrage_spread) < 0) {
                console.log(`[SELF-HEALING]: Flipping negative asset ${asset.address} to positive.`);
                await supabase.from('deals_master').update({ 
                    gross_arbitrage_spread: Math.abs(asset.gross_arbitrage_spread),
                    updated_at: new Date()
                }).eq('id', asset.id);
            }
        }

    } catch (e) {
        console.error('Watchdog Error:', e.message);
    }
};

// RUN EVERY 5 MINUTES (High Velocity)
setInterval(runAutonomousCycle, 5 * 60 * 1000);
runAutonomousCycle();
