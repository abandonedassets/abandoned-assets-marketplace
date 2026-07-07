const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

app.post('/webhook/deal-intake', async (req, res) => {
    const payload = req.body;
    console.log("--- 🌊 JUGGERNAUT INTAKE DETECTED ---");
    
    try {
        const { data, error } = await supabase
            .from('deals_master')
            .insert([{
                address: payload.address,
                arv: payload.arv,
                cost_basis: payload.cost_basis,
                status: 'PENDING_CALCULATION',
                intake_source: 'webhook_v5'
            }]);

        if (error) throw error;
        res.status(200).send({ status: "success" });
    } catch (err) {
        console.error("INGESTION FAILURE:", err.message);
        res.status(500).send({ error: err.message });
    }
});

app.listen(3000, () => console.log("Juggernaut Engine Online"));
