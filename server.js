const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const publicPath = path.join(__dirname, 'public');

// Initialize Cloud PostgreSQL Pool via Render Environment Variable
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ========================================================================
// QUANT COUNTERPARTY SCORING ENGINE (The Secret Layer)
// ========================================================================
function processInstitutionalAlpha(properties) {
  return properties.map(prop => {
    const arv = parseFloat(prop.arv) || 0;
    const purchase = parseFloat(prop.purchase_price || prop.purchase) || 0;
    const repairs = parseFloat(prop.repair_costs || prop.repairs) || 0;
    
    // 1. Secret: Arbitrage Delta Calculation
    const netSpread = arv - (purchase + repairs);
    const deltaScore = arv > 0 ? ((netSpread / arv) * 100).toFixed(2) : 0;
    
    // 2. Secret: Autonomous Circuit Breaker Middleware
    let systemStatus = 'PASSED';
    if (arv <= 0 || purchase <= 0 || repairs >= arv) {
      systemStatus = 'QUARANTINED_ANOMALY';
    }
    
    // 3. Secret: Alpha Target Flagging (>30% Profit Spreads)
    const isAlphaTarget = deltaScore >= 30 && systemStatus === 'PASSED';
    
    return {
      id: prop.id,
      address: prop.address || 'UNKNOWN LOCATION',
      arv: arv,
      delta_score: `${deltaScore}%`,
      alpha_target: isAlphaTarget,
      circuit_breaker: systemStatus,
      execution_tier: isAlphaTarget ? 'DARK_POOL_FIRST_REFUSAL' : 'PUBLIC_MARKETPLACE',
      timestamp: prop.created_at || new Date()
    };
  });
}

// ========================================================================
// ROUTES & ENDPOINTS
// ========================================================================

// 1. HEALTH MONITOR
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ONLINE', infrastructure: 'RENDER_CLOUD' });
});

// 2. LIVE TELEMETRY STREAM
app.get('/api/terminal-feed', async (req, res) => {
  if (process.env.DATABASE_URL) {
    try {
      const result = await pool.query(`
        SELECT id, address, arv, purchase_price, repair_costs, created_at 
        FROM properties 
        ORDER BY created_at DESC 
        LIMIT 20
      `);
      
      const processedData = processInstitutionalAlpha(result.rows);
      return res.status(200).json({
        status: 'ONLINE',
        pipeline: 'LIVE_DATABASE',
        queue_count: result.rowCount,
        data: processedData
      });
    } catch (error) {
      console.error("Database connection active but tables initializing:", error.message);
    }
  }

  // Cloud Standby Mode: Generates high-fidelity quantitative data if DB is provisioning
  const mockDatabaseRows = [
    { id: 101, address: "2847 Oak Ridge Drive, Phoenix AZ", arv: 285000, purchase: 120000, repairs: 45000, created_at: new Date(Date.now() - 1000) },
    { id: 102, address: "1523 Maple Street, Atlanta GA", arv: 195000, purchase: 90000, repairs: 25000, created_at: new Date(Date.now() - 5000) },
    { id: 103, address: "88 Dewitt Dr, Boston MA", arv: 510000, purchase: 400000, repairs: 150000, created_at: new Date(Date.now() - 12000) }, // Anomaly
    { id: 104, address: "567 Riverside Ave, Austin TX", arv: 340000, purchase: 180000, repairs: 30000, created_at: new Date(Date.now() - 18000) }
  ];

  return res.status(200).json({
    status: 'ONLINE',
    pipeline: 'STANDBY_ENGINE',
    queue_count: mockDatabaseRows.length,
    data: processInstitutionalAlpha(mockDatabaseRows)
  });
});

// Serve Static Frontends Safely
app.use(express.static(publicPath));

// Clean Extensions Mapping
app.get('/marketplace', (req, res) => {
  res.sendFile(path.join(publicPath, 'marketplace.html'));
});

app.get('/terminal', (req, res) => {
  res.sendFile(path.join(publicPath, 'terminal.html'));
});

// Catch-All Routing
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Autonomous Core live on port ${PORT}`);
});
