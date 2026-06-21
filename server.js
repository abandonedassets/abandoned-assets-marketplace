const express = require('express');
const path = require('path');
const app = express();

const publicPath = path.join(__dirname, 'public');

// 1. HEALTH CHECK: Defined first
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// 2. STATIC FILES: Serve your assets
app.use(express.static(publicPath));

// 3. CLEAN ALIASES
app.get('/marketplace', (req, res) => {
  res.sendFile(path.join(publicPath, 'marketplace.html'));
});

// 4. CATCH-ALL: Must be last
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Render-specific port configuration
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
