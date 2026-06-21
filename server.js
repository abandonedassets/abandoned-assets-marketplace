const express = require('express');
const path = require('path');
const app = express();

const publicPath = path.join(__dirname, 'public');

// 1. HEALTH CHECK: Defined first for Render uptime monitoring
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// 2. ISOLATED TELEMETRY FEED (Safe Patch - Zero Dependency Fallback)
app.get('/api/terminal-feed', async (req, res) => {
  // High-stability fallback: Inherits database-free launch mode perfectly
  return res.status(200).json({ 
    status: 'ONLINE', 
    queue_count: 0,
    data: [
      { id: 0, address: "Telemetry baseline online. Ingestion stream idling...", arv: "0", created_at: new Date() }
    ] 
  });
});

// 3. STATIC FILES: Serve your assets securely
app.use(express.static(publicPath));

// 4. CLEAN ALIASES: Direct routing without trailing extensions
app.get('/marketplace', (req, res) => {
  res.sendFile(path.join(publicPath, 'marketplace.html'));
});

app.get('/terminal', (req, res) => {
  res.sendFile(path.join(publicPath, 'terminal.html'));
});

// 5. CATCH-ALL: Absolute fallback route
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Render-specific port configuration
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
