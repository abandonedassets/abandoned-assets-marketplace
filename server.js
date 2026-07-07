require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// --- NASA TELEMETRY: BOOT SEQUENCE ---
console.log("--- [NASA_STATUS]: BOOTING JUGGERNAUT CORE ---");
console.log("--- [NASA_STATUS]: TELEMETRY LINK ESTABLISHED ---");

app.post('/webhook/deal-intake', async (req, res) => {
    const payload = req.body;
    
    // --- TITANIC MODEL: STRUCTURAL INTEGRITY CHECK ---
    console.log("--- [TITANIC_SCAN]: ANALYZING ASSET STRUCTURAL INTEGRITY ---");
    if (!payload.arv || !payload.cost_basis) {
        console.log("--- [TITANIC_ALERT]: POTENTIAL ICEBERG DETECTED: MISSING METRICS ---");
        return res.status(400).send({ error: "Missing required financial metrics." });
    }

    try {
        // --- WATER FLOW: LIQUIDITY DYNAMICS ---
        console.log("--- [WATER_FLOW]: MODELING LIQUIDITY DYNAMICS ---");
        
        const { data, error } = await supabase
            .from('deals_master')
            .insert([{ 
                address: payload.address, 
                arv: payload.arv, 
                cost_basis: payload.cost_basis, 
                status: 'PENDING_CALCULATION' 
            }]);

        if (error) throw error;
        
        // --- WATER FLOW: ASSET ANCHORED ---
        console.log("--- [WATER_FLOW]: ASSET FLOW ANCHORED IN DATABASE ---");
        res.status(200).send({ status: "success", message: "Data anchored." });
        
    } catch (err) {
        // --- TITANIC MODEL: FAILURE CONTAINMENT ---
        console.error("--- [TITANIC_ALERT]: CATASTROPHIC LEAK IN PIPELINE ---", err.message);
        res.status(500).send({ error: "Containment failed." });
    }
});

app.listen(3000, () => console.log("--- [NASA_STATUS]: JUGGERNAUT ENGINE AT FLIGHT READINESS ---"));
