const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 10000;

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
});

let pool;
if (process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

app.get('/api/terminal-feed', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
    
    if (!pool) {
        return res.json({ source: "standby_engine", data: [{ address: "STANDBY_ASSET_01", delta_score: "0.00", basis: 0 }] });
    }

    try {
        const { rows } = await pool.query(`SELECT * FROM properties ORDER BY created_at DESC LIMIT $1`, [limit]);
        res.json({ source: "database", data: rows });
    } catch (err) {
        res.status(500).json({ source: "fallback", error: "DB_CONNECTION_FAILURE" });
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(port, () => console.log(`SYSTEM_LIVE_ON_PORT:${port}`));
