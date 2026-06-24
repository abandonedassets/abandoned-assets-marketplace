const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(express.json());

// Initialize Supabase Client
// This pulls directly from the Environment Variables you set in Render
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Root Health Check - This clears the 404 error
app.get('/', (req, res) => {
    res.status(200).send("Juggernaut Engine is Online and Operational.");
});

// Placeholder Ingestion Route 
// Add your specific business logic here as you develop
app.post('/api/ingest', async (req, res) => {
    try {
        // Example: logic to process data would go here
        res.status(200).json({ message: "Data received by engine." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Server Initialization
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`System Online. Server running on port ${PORT}`);
});
