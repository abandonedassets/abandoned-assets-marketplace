// property-api.js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function getProperties(req, res) {
    try {
        // This command selects ALL data from the table with NO filters
        const { data, error } = await supabase
            .from('properties_raw')
            .select('*');

        if (error) {
            console.error("Supabase Error:", error);
            return res.status(500).json({ error: error.message });
        }

        // Send all the data found
        res.json(data);
    } catch (err) {
        res.status(500).send("Internal Server Error");
    }
}

module.exports = { getProperties };
