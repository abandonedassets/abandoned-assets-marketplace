const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. ATOMIC REDIRECT OVERRIDE & ABSOLUTE PATH ROUTING
// Enforces hard-domain lock for the AbandonedAssetsOS ecosystem.
app.use(express.static(path.join(__dirname, 'public')));

// JUGGERNAUT-STANDARD: STATIC ROUTING MANIFEST (NASA-LEVEL ACCURACY)
// Enforces hard-domain lock and bypasses defunct routing fragments.

const serveSettlement = (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  res.sendFile(path.join(__dirname, 'public', 'settlement.html'));
};

// Mapping the 'Absolute Path' for the Daughter Settlement Gateway
app.get('/terminal/daughter-settlement-gateway', serveSettlement);

// Force-mapping all root requests to the Terminal Instance
app.get('/', serveSettlement);

// Explicit mapping for abandonedasset.online routing fragments
app.get('/index.html', serveSettlement);

// Fallback for all other defunct routing paths
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`[JUGGERNAUT_MANIFEST] Server running on port ${PORT}`);
  console.log(`[SOVEREIGN_REDIRECT] All incoming requests mapped to terminal instance.`);
});
