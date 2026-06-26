require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const app = express();

// Configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Debugging: This prints to your Render logs so you can see if the URL is wrong
console.log("CRITICAL DEBUG: App is connecting to this URL:", supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

app.get('/api/data', async (req, res) => {
  try {
    // The filter is applied here so 'manual_entry' is ignored forever
    const { data, error } = await supabase
      .from('properties_raw')
      .select('*')
      .neq('source', 'manual_entry');

    if (error) {
      console.error("Supabase Fetch Error:", error);
      return res.status(500).json({ error: error.message });
    }

    console.log("Fetch successful. Records retrieved:", data ? data.length : 0);
    res.json(data);
    
  } catch (err) {
    console.error("System Error:", err);
    res.status(500).send("Internal Server Error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
