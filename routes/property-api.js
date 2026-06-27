// property-api.js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function getProperties(req, res) {
    try {
        // We removed the .neq('source', 'manual_entry') filter
        // Now you will see EVERYTHING in your database
        const { data, error } = await supabase
            .from('properties_raw')
            .select('*');

        if (error) throw error;
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

module.exports = { getProperties };
