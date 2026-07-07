require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const app = express();

app.use(express.json());
// --- NASA TELEMETRY: SERVING STATIC ASSETS ---
app.use(express.static('public')); 

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// --- NASA TELEMETRY: BOOT SEQUENCE ---
console.log("--- [NASA_STATUS]: BOOTING JUGGERNAUT CORE ---");

// --- WEBHOOK: DATA INTAKE ---
app.post('/webhook/deal-intake', async (req, res) => {
    const payload = req.body;
    try {
        const { error } = await supabase.from('deals_master').insert([{ 
            address: payload.address, 
            arv: payload.arv, 
            cost_basis: payload.cost_basis, 
            status: 'PENDING_CALCULATION' 
        }]);
        if (error) throw error;
        console.log("--- [WATER_FLOW]: ASSET ANCHORED ---");
        res.status(200).json({ status: "success" });
    } catch (err) {
        console.error("--- [TITANIC_ALERT]: PIPELINE BREACH ---", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- ROUTE: SERVE DASHBOARD (The "Dopamine Cards") ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("--- [NASA_STATUS]: ENGINE AT FLIGHT READINESS ---"));
