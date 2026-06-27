require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const app = express();
const path = require('path');

app.use(express.json());
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 1. Force Login Check for the /alpha route
app.get('/alpha', (req, res) => {
    // If you haven't logged in, redirect to login page
    // Change 'loggedIn' to your specific cookie/session logic if needed
    if (!req.headers.cookie || !req.headers.cookie.includes('authenticated=true')) {
        return res.sendFile(path.join(__dirname, 'login.html'));
    }
    res.sendFile(path.join(__dirname, 'alpha.html')); 
});

// 2. Fetch Data (No filters, raw access)
app.get('/api/data', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('properties_raw')
            .select('*');

        if (error) {
            console.error("Supabase Error:", error);
            return res.status(500).json({ error: error.message });
        }

        console.log("DEBUG: Data fetched from Supabase:", data ? data.length : 0, "rows found.");
        res.json(data || []);
    } catch (err) {
        console.error("Server Error:", err);
        res.status(500).send("Internal Server Error");
    }
});

// 3. Static Files
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
