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

app.get('/api/terminal-feed', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM properties ORDER BY created_at DESC LIMIT 500`);
        res.json({ source: "database", data: rows });
    } catch (err) {
        console.error("CRITICAL_DB_CONNECTION_FAILURE:", err.message);
        res.status(500).json({ source: "fallback", error: err.message });
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(port, () => console.log(`SYSTEM_LIVE_ON_PORT:${port}`));
