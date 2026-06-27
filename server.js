require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const app = express();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

app.get('/api/data', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('properties_raw')
      .select('*')
      .neq('source', 'manual_entry');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
    
  } catch (err) {
    res.status(500).send("Internal Server Error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
