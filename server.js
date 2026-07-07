require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();

app.use(express.json());

// --- AUTONOMOUS BOOT CHECK ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("⚠️ [CRITICAL]: Missing Environment Variables. Check Render Dashboard.");
} else {
    console.log("--- [NASA_STATUS]: BOOTING JUGGERNAUT CORE ---");
}

const supabase = createClient(SUPABASE_URL || 'dummy', SUPABASE_KEY || 'dummy');

// --- AUTONOMOUS WEBHOOK HANDLER ---
app.post('/webhook/deal-intake', async (req, res) => {
    try {
        const { address, arv, cost_basis } = req.body;

        // --- TITANIC MODEL: SELF-VALIDATION ---
        if (!address || !arv || !cost_basis) {
            console.log("--- [TITANIC_ALERT]: REJECTING INVALID DATA ---");
            return res.status(400).json({ error: "Invalid Data: Missing fields." });
        }

        console.log("--- [WATER_FLOW]: ANALYZING ASSET ---");
        
        const { data, error } = await supabase
            .from('deals_master')
            .insert([{ address, arv, cost_basis, status: 'PENDING_CALCULATION' }]);

        if (error) throw error;

        console.log("--- [WATER_FLOW]: ASSET ANCHORED SUCCESSFULLY ---");
        res.status(200).json({ status: "success" });

    } catch (err) {
        // --- SELF-HEALING: CONTAINMENT ---
        console.error("--- [SYSTEM_ALERT]: PIPELINE ERROR -", err.message, "---");
        res.status(500).json({ status: "error", message: "System operational, but ingestion failed." });
    }
});

// --- KEEP-ALIVE ---
app.get('/', (req, res) => res.send('Juggernaut Engine Active.'));

app.listen(3000, () => console.log("--- [NASA_STATUS]: ENGINE AT FLIGHT READINESS ---"));
