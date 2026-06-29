const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. ATOMIC REDIRECT OVERRIDE & ABSOLUTE PATH ROUTING
// Enforces hard-domain lock for the AbandonedAssetsOS ecosystem.
app.use(express.static(path.join(__dirname, 'public')));

// Mapping the 'Absolute Path' for the Daughter Settlement Gateway
app.get('/terminal/daughter-settlement-gateway', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settlement.html'));
});

// Force-mapping all root requests to the Terminal Instance
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settlement.html'));
});

// Fallback for all other defunct routing paths
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`[JUGGERNAUT_MANIFEST] Server running on port ${PORT}`);
  console.log(`[SOVEREIGN_REDIRECT] All incoming requests mapped to terminal instance.`);
});
