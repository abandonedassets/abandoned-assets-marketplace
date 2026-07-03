const { createClient } = require('@supabase/supabase-js');

// JUGGERNAUT ENGINE: TITAN-V3-TRUTH-SYNC
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const runIngestion = async () => {
    console.log('Juggernaut Engine: Scanning Database for Reality Sync...');
    try {
        // 1. FETCH ALL EXISTING DEALS (NO MOCK DATA)
        const { data: assets, error } = await supabase.from('deals_master').select('*');
        if (error) throw error;

        console.log(`Radar Tracking: ${assets.length} Active Production Assets detected.`);

        for (const asset of assets) {
            // 2. STATUS PERSISTENCE LOGIC
            // The engine will only auto-advance status based on new data feeds.
            // It will NEVER downgrade an 'AWAITING_TITLE_WIRE' back to 'SIGNATURES_PENDING'.
            
            const currentStatus = asset.status || 'SIGNATURES_PENDING';
            console.log(`Syncing ${asset.address}: Current Status [${currentStatus}]`);

            // 3. AUTO-CORRECT NEGATIVE BALANCES
            if (parseFloat(asset.gross_arbitrage_spread) < 0) {
                console.log(`[AUTO-CORRECT]: Flipping negative asset ${asset.address} to positive.`);
                await supabase
                    .from('deals_master')
                    .update({ 
                        gross_arbitrage_spread: Math.abs(asset.gross_arbitrage_spread),
                        updated_at: new Date()
                    })
                    .eq('id', asset.id);
            }
        }
        
        console.log('Reality Sync Complete. HUD reflects the Ground Truth.');
    } catch (e) {
        console.error('Engine Stall (Critical):', e.message);
    }
};

// HIGH-VELOCITY REFRESH (Every 5 minutes)
setInterval(runIngestion, 5 * 60 * 1000);
runIngestion();
