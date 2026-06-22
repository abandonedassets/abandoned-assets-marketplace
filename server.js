const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 10000;

// Enforce strict DB connection with low bottleneck constraints
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: Math.min(parseInt(process.env.PG_POOL_MAX || 2), 5), // Cap pool low
    connectionTimeoutMillis: 5000,  // Handshake timeout
    idleTimeoutMillis: 10000,       // Drop idle connections fast
    query_timeout: 5000,            // Hard query limit
    statement_timeout: 5000         // Hard statement limit
});

let cachedFeed = null;
let cacheTimestamp = 0;

app.get('/api/terminal-feed', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
        
        // 60-second cache to prevent DB spam on 3-second client polls
        if (cachedFeed && (Date.now() - cacheTimestamp) < 60000) {
            return res.json({ status: "SUCCESS", count: cachedFeed.length, data: cachedFeed, cached: true });
        }

        const { rows } = await pool.query(`SELECT * FROM properties ORDER BY created_at DESC LIMIT $1`, [limit]);
        
        cachedFeed = rows;
        cacheTimestamp = Date.now();

        // Removed separate COUNT(*), using rows.length directly
        res.json({ status: "SUCCESS", count: rows.length, data: rows, cached: false });
    } catch (err) {
        console.error("CRITICAL_DB_CONNECTION_FAILURE:", err.message);
        
        let diagnostic_hint = "Verify DATABASE_URL.";
        if (err.message.includes('terminated unexpectedly')) {
            diagnostic_hint = "Check DB connection pooling limits (e.g., use the provider's Transaction string instead of Direct string) or external IP access limits.";
        }

        res.status(500).json({ 
            status: "CRITICAL_FAILURE", 
            error: err.message,
            diagnostic_hint: diagnostic_hint
        });
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(port, () => console.log(`SYSTEM_LIVE_ON_PORT:${port}`));
