const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// JUGGERNAUT ENGINE: INITIALIZATION
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// DATA SANITIZATION FORTRESS
const sanitize = (val) => Math.abs(parseFloat(val || 0));

const runIngestion = async () => {
    console.log('Juggernaut Engine: Starting Ingestion Cycle...');
    try {
        // MOCK ATTOM DATA FOR DEMO (REPLACE WITH ACTUAL API CALL)
        const mockData = [
            { id: '77291', address: 'Aurora Commercial Pad', spread: 125000, status: 'Settlement_Ready' },
            { id: '99120', address: 'Courtyard Cir.', spread: 45000, status: 'Escrow_Velocity' }
        ];

        for (const item of mockData) {
            const { error } = await supabase
                .from('deals_master')
                .upsert({ 
                    id: item.id, 
                    address: item.address, 
                    gross_arbitrage_spread: sanitize(item.spread),
                    status: item.status,
                    updated_at: new Date()
                });
            
            if (error) console.error('Ingestion Leak:', error.message);
            else console.log(`Ingestion Success: ${item.address} Synced.`);
        }
    } catch (e) {
        console.error('Engine Stall:', e.message);
    }
};

// EXECUTE EVERY 15 MINUTES (ALIGN WITH RENDER SLEEP CYCLE)
setInterval(runIngestion, 15 * 60 * 1000);
runIngestion();
