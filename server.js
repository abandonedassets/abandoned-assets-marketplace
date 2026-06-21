const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 10000;

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.get('/api/health', (req, res) => res.status(200).json({ status: 'ONLINE', ts: new Date().toISOString() }));

app.get('/api/terminal-feed', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
        const { rows } = await pool.query(`SELECT * FROM properties ORDER BY created_at DESC LIMIT $1`, [limit]);
        res.status(200).json({ status: 'ONLINE', count: rows.length, data: rows });
    } catch (err) {
        res.status(500).json({ error: 'DB_CONNECTION_FAILURE' });
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(port, () => console.log(`SYSTEM_LIVE_ON_PORT:${port}`));
