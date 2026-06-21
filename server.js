const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 10000;

// Force No-Cache for API and HTML routes
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Dynamic API Feed
app.get('/api/terminal-feed', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
        const { rows } = await pool.query(`SELECT * FROM properties ORDER BY created_at DESC LIMIT $1`, [limit]);
        
        // Institutional Processing Logic
        const processed = rows.map(prop => ({
            id: prop.id,
            address: prop.address,
            arv: prop.arv,
            basis: prop.purchase_price,
            capex: prop.repair_costs,
            delta_score: ((prop.arv - (prop.purchase_price + prop.repair_costs)) / prop.arv * 100).toFixed(2)
        }));
        
        res.status(200).json({ status: 'ONLINE', count: processed.length, data: processed });
    } catch (err) {
        res.status(500).json({ error: 'DB_CONNECTION_FAILURE' });
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(port, () => console.log(`Infrastructure live on port ${port}`));
