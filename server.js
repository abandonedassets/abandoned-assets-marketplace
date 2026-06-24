const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();

app.use(express.json());

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function validateAndUpsert(dealData) {
    // 1. Hard Protection: Never overwrite protected assets
    if (dealData.id === 'roar-protected-id') {
        console.log("Protecting Roar Commercial Pack...");
        return;
    }

    // 2. Sniper Validation: Sanity check the numbers
    if (dealData.deal_value > 100000000 || dealData.deal_value < 1000) {
        throw new Error("Data Out of Range: Sanity check failed.");
    }

    // 3. Execution
    const { data, error } = await supabase.from('qre_institutional_deal_tape').upsert(dealData);
    if (error) throw error;
}

// The Pipe
app.post('/api/ingest', async (req, res) => {
    try {
        await validateAndUpsert(req.body);
        res.status(200).send("Juggernaut: Asset validated and ingested.");
    } catch (err) {
        res.status(400).send("Ghost-Killer: Validation failed - " + err.message);
    }
});

app.listen(process.env.PORT || 3000, () => {
    console.log("System Online.");
});
