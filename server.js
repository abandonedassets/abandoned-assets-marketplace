const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // This ensures your index.html still works

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 1. THE BRAIN GATEKEEPER
async function validateAndUpsert(dealData) {
    if (dealData.id === 'roar-protected-id') {
        console.log("Protecting Roar Commercial Pack...");
        return;
    }
    if (dealData.deal_value > 100000000 || dealData.deal_value < 1000) {
        throw new Error("Data Out of Range: Sanity check failed.");
    }
    const { data, error } = await supabase.from('qre_institutional_deal_tape').upsert(dealData);
    if (error) throw error;
}

// 2. THE PIPE (Manual Ingestion)
app.post('/api/ingest', async (req, res) => {
    try {
        await validateAndUpsert(req.body);
        res.status(200).send("Juggernaut: Asset validated and ingested.");
    } catch (err) {
        res.status(400).send("Ghost-Killer: Validation failed - " + err.message);
    }
});

// 3. THE HUNTER (Autonomous Crawler)
// Runs every 60 minutes
setInterval(async () => {
    console.log("Juggernaut: Hunter active. Scanning targets...");
    try {
        // Target site logic (Add your specific URLs here)
        const { data } = await axios.get('https://example-real-estate-site.com/listings');
        const $ = cheerio.load(data);
        
        // Example: logic to find data in the HTML
        // const listings = $('.listing-class').map(...) 
        
        // Feed found deals into the validator
        // await validateAndUpsert(foundDeal); 
    } catch (err) {
        console.log("Hunter Error:", err.message);
    }
}, 3600000);

app.listen(process.env.PORT || 3000, () => {
    console.log("System Online. Engine running.");
});
