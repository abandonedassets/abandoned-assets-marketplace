const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const testDeals = [
    {
        id: 'deal-001-memphis',
        address: 'Memphis Ave',
        cost_basis: 30000,
        arv_projection: 87000,
        gross_arbitrage_spread: 57000,
        status: 'MATCH_CONFIRMED',
        last_ingested_at: new Date().toISOString(),
        created_at: new Date().toISOString()
    },
    {
        id: 'deal-002-courtyard',
        address: 'Courtyard Cir',
        cost_basis: 1500,
        arv_projection: 4600,
        gross_arbitrage_spread: 3100,
        status: 'AWAITING_TITLE_WIRE',
        last_ingested_at: new Date().toISOString(),
        created_at: new Date().toISOString()
    }
];

async function seedDatabase() {
    console.log('[SEED] Starting database initialization...');
    
    try {
        // First, try to delete existing test deals to avoid duplicates
        console.log('[SEED] Clearing existing test deals...');
        const { error: deleteError } = await supabase
            .from('deals_master')
            .delete()
            .in('id', testDeals.map(d => d.id));

        if (deleteError && deleteError.code !== 'PGRST116') {
            console.log('[SEED] Warning: Could not delete existing deals:', deleteError.message);
        }

        // Insert new test deals
        console.log('[SEED] Inserting test deals...');
        const { data, error } = await supabase
            .from('deals_master')
            .insert(testDeals)
            .select();

        if (error) {
            console.error('[ERROR] Failed to insert deals:', error.message);
            console.error('[ERROR] Details:', error);
            process.exit(1);
        }

        console.log('[SUCCESS] Test deals inserted successfully!');
        console.log('[DATA] Inserted deals:');
        data.forEach(deal => {
            console.log(`  - ${deal.property_address}: $${deal.gross_arbitrage_spread.toLocaleString()}`);
        });

        // Verify insertion
        const { data: verifyData, error: verifyError } = await supabase
            .from('deals_master')
            .select('*')
            .in('id', testDeals.map(d => d.id));

        if (verifyError) {
            console.error('[ERROR] Verification failed:', verifyError.message);
            process.exit(1);
        }

        console.log('[VERIFY] Database contains', verifyData.length, 'test deals');
        console.log('[SEED] Database initialization complete!');
        process.exit(0);

    } catch (err) {
        console.error('[ERROR] Unexpected error:', err.message);
        process.exit(1);
    }
}

seedDatabase();
