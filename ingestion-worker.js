const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// JUGGERNAUT ENGINE: TITAN-V2-INGESTION
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'public' }
});

// WATER-FLOW SANITIZATION ENGINE
const sanitize = (val) => Math.abs(parseFloat(val || 0));

// INSTITUTIONAL STATUS MAPPING
const mapStatus = (status) => {
    const s = (status || '').toUpperCase();
    if (s.includes('SETTLED') || s.includes('READY')) return 'FUNDS_SETTLED';
    if (s.includes('WIRE') || s.includes('VELOCITY')) return 'AWAITING_TITLE_WIRE';
    if (s.includes('CLOSE')) return 'CLEAR_TO_CLOSE';
    return 'CONTRACT_EXECUTED';
};

const runIngestion = async () => {
    console.log('Juggernaut Engine: Starting High-Velocity Ingestion Cycle...');
    try {
        // MOCK INSTITUTIONAL DATA (REPLACE WITH LIVE FEED API)
        const mockData = [
            { id: 'TX-57000-SETTLE', address: '57K Settlement Asset', spread: 57000, status: 'AWAITING_TITLE_WIRE' },
            { id: 'FL-125000-PAD', address: 'Aurora Commercial Pad', spread: 125000, status: 'CLEAR_TO_CLOSE' },
            { id: 'CA-45000-COURT', address: 'Courtyard Cir. Commercial', spread: 45000, status: 'CONTRACT_EXECUTED' }
        ];

        for (const item of mockData) {
            const mappedStatus = mapStatus(item.status);
            
            const { error } = await supabase
                .from('deals_master')
                .upsert({ 
                    id: item.id, 
                    address: item.address, 
                    gross_arbitrage_spread: sanitize(item.spread),
                    status: mappedStatus,
                    updated_at: new Date()
                }, { onConflict: 'id' });
            
            if (error) {
                console.error(`Ingestion Leak [${item.id}]:`, error.message);
            } else {
                console.log(`Water-Flow Success: ${item.address} -> [${mappedStatus}] Synced.`);
            }
        }
        console.log('Ingestion Cycle Complete. Handshake Maintained.');
    } catch (e) {
        console.error('Engine Stall (Critical):', e.message);
    }
};

// HIGH-VELOCITY REFRESH (Every 5 minutes for "Light Speed" feel)
setInterval(runIngestion, 5 * 60 * 1000);
runIngestion();
