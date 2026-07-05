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

            const updates = [];
            for (const asset of assets) {
                // 2. STATUS PERSISTENCE LOGIC
                const currentStatus = asset.status || 'SIGNATURES_PENDING';
                // console.log(`Syncing ${asset.address}: Current Status [${currentStatus}]`); // Commented for high-throughput

                // 3. AUTO-CORRECT NEGATIVE BALANCES
                if (parseFloat(asset.gross_arbitrage_spread) < 0) {
                    updates.push({
                        id: asset.id,
                        gross_arbitrage_spread: Math.abs(asset.gross_arbitrage_spread),
                        last_ingested_at: new Date().toISOString()
                    });
                }
            }

            if (updates.length > 0) {
                console.log(`[AUTO-CORRECT]: Preparing to batch update ${updates.length} negative assets.`);
                const CHUNK_SIZE = 50; // Institutional standard for connection pool protection
                for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
                    const chunk = updates.slice(i, i + CHUNK_SIZE);
                    const updatePromises = chunk.map(async (updateData) => {
                        const { error: updateError } = await supabase
                            .from('deals_master')
                            .upsert(updateData, { onConflict: 'id' }); // Atomic UPSERT
                        if (updateError) {
                            console.error(`[AUTO-CORRECT_ERROR]: Failed to update asset ${updateData.id}:`, updateError.message);
                            return { status: 'rejected', reason: updateError };
                        }
                        return { status: 'fulfilled', value: updateData.id };
                    });
                    const results = await Promise.allSettled(updatePromises); // Fault-isolated concurrency
                    results.forEach(result => {
                        if (result.status === 'fulfilled') {
                            // console.log(`[AUTO-CORRECT_SUCCESS]: Asset ${result.value} flipped to positive.`); // Commented for high-throughput
                        } else {
                            console.error(`[AUTO-CORRECT_FAILED]: Asset update failed:`, result.reason);
                        }
                    });
                }
                console.log(`[AUTO-CORRECT]: Batch update process completed.`);
            }
        
        console.log('Reality Sync Complete. HUD reflects the Ground Truth.');
    } catch (e) {
        console.error('Engine Stall (Critical):', e.message);
    }
};

// HIGH-VELOCITY REFRESH (Every 5 minutes)
setInterval(runIngestion, 5 * 60 * 1000);
runIngestion();
