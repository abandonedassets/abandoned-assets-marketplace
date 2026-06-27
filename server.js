require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const { handleAutoLogin } = require('./auto-login');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Login wall for the alpha page
app.get('/alpha', (req, res) => {
    if (req.headers.cookie && req.headers.cookie.includes('authenticated=true')) {
        res.sendFile(path.join(__dirname, 'alpha.html'));
    } else {
        res.sendFile(path.join(__dirname, 'login.html'));
    }
});

// Authentication endpoint
app.post('/api/login', handleAutoLogin);

// Raw Data endpoint (NO FILTERS)
app.get('/api/data', async (req, res) => {
    try {
        const { data, error } = await supabase.from('properties_raw').select('*');
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
