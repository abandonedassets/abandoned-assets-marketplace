const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const port = process.env.PORT || 3000;

// Initialize Supabase (Use your env variables)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- AUTH GATE MIDDLEWARE ---
const authMiddleware = (req, res, next) => {
  const passcode = req.headers['x-passcode']; // Passcode sent in header
  if (passcode === '120202') {
    next();
  } else {
    res.status(401).send('Unauthorized: Invalid Passcode');
  }
};

// --- ROUTES ---

// Protected Route: Returns filtered deals
app.get('/api/deals', authMiddleware, async (req, res) => {
  try {
    // --- THE FILTER FIX ---
    // Excludes 'manual_entry' sources from the public feed
    const { data, error } = await supabase
      .from('properties_raw')
      .select('*')
      .neq('source', 'manual_entry'); 

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve your static frontend files
app.use(express.static('public'));

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
