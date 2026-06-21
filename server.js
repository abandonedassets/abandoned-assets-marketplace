const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const publicPath = path.join(__dirname, 'public');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Institutional Alpha Processor
function processInstitutionalAlpha(properties) {
  return properties.map(prop => {
    const arv = parseFloat(prop.arv) || 0;
    const purchase = parseFloat(prop.purchase_price || prop.purchase) || 0;
    const repairs = parseFloat(prop.repair_costs || prop.repairs) || 0;
    const netSpread = arv - (purchase + repairs);
    const deltaScore = arv > 0 ? ((netSpread / arv) * 100).toFixed(2) : 0;
    
    return {
      address: prop.address || 'UNKNOWN LOCATION',
      delta_score: `${deltaScore}%`,
      execution_tier: deltaScore >= 30 ? 'DARK_POOL_FIRST_REFUSAL' : 'PUBLIC_MARKETPLACE',
      timestamp: new Date()
    };
  });
}

// API Routes
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ONLINE' }));

app.get('/api/terminal-feed', async (req, res) => {
  const mockData = [
    { address: "2847 Oak Ridge Drive, Phoenix AZ 85001", arv: 285000, purchase: 120000, repairs: 45000 },
    { address: "1523 Maple Street, Atlanta GA 30303", arv: 195000, purchase: 90000, repairs: 25000 }
  ];
  return res.status(200).json({ status: 'ONLINE', data: processInstitutionalAlpha(mockData), queue_count: 2 });
});

app.use(express.static(publicPath));
app.get('*', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Infrastructure live on port ${PORT}`));
