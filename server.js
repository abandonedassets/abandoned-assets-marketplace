const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 10000;

// Force No-Cache Headers
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// Resilient DB Pool Setup
let pool;
if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
}

// Standby Inventory (Fail-Safe Mechanism)
const STANDBY_FEED = [
    { id: 1, address: "2847 Oak Ridge Drive, Phoenix AZ 85001", arv: 285000, purchase_price: 120000, repair_costs: 45000 },
    { id: 2, address: "1523 Maple Street, Atlanta GA 30303", arv: 195000, purchase_price: 90000, repair_costs: 25000 }
];

// Explicit Routes
app.get('/marketplace', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'marketplace.html'));
});

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ONLINE', database: pool ? 'CONNECTED' : 'STANDBY_MODE', ts: new Date().toISOString() });
});

// Dynamic Data Ingestion Feed
app.get('/api/terminal-feed', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
    
    if (!pool) {
        const processed = STANDBY_FEED.slice(0, limit).map(prop => ({
            id: prop.id,
            address: prop.address,
            delta_score: ((prop.arv - (prop.purchase_price + prop.repair_costs)) / prop.arv * 100).toFixed(2),
            basis: prop.purchase_price
        }));
        return res.status(200).json({ status: 'STANDBY_MODE', count: processed.length, data: processed });
    }

    try {
        const { rows } = await pool.query(`SELECT * FROM properties ORDER BY created_at DESC LIMIT $1`, [limit]);
        const processed = rows.map(prop => ({
            id: prop.id,
            address: prop.address,
            delta_score: prop.arv ? ((prop.arv - ((prop.purchase_price || 0) + (prop.repair_costs || 0))) / prop.arv * 100).toFixed(2) : "0.00",
            basis: prop.purchase_price || 0
        }));
        res.status(200).json({ status: 'ONLINE', count: processed.length, data: processed });
    } catch (err) {
        const processed = STANDBY_FEED.slice(0, limit).map(prop => ({
            id: prop.id,
            address: prop.address,
            delta_score: ((prop.arv - (prop.purchase_price + prop.repair_costs)) / prop.arv * 100).toFixed(2),
            basis: prop.purchase_price
        }));
        res.status(200).json({ status: 'DATABASE_FALLBACK', count: processed.length, data: processed });
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(port, () => console.log(`SYSTEM_LIVE_ON_PORT:${port}`));
