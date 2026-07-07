require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();

app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// --- 1. SETUP LISTENER BEFORE SUBSCRIBING ---
const channel = supabase.channel('db-changes');

channel.on(
  'postgres_changes',
  { event: 'INSERT', schema: 'public', table: 'deals_master' },
  (payload) => {
    console.log('--- 🌊 JUGGERNAUT INTAKE DETECTED ---');
    console.log('New Record:', payload.new);
  }
);

// --- 2. SUBSCRIBE LAST ---
channel.subscribe();

// --- 3. WEBHOOK ROUTE ---
app.post('/webhook/deal-intake', async (req, res) => {
    const { address, arv, cost_basis } = req.body;
    
    const { data, error } = await supabase
        .from('deals_master')
        .insert([{ address, arv, cost_basis, status: 'PENDING_CALCULATION' }]);

    if (error) return res.status(500).send(error);
    res.status(200).send({ status: "success" });
});

app.listen(3000, () => console.log("Juggernaut Engine Online"));
