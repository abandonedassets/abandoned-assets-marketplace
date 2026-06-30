const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// 1. HARD-CODED DIRECTORY MAPPING (ZERO AMBIGUITY)
// Forces the system to serve from /public exclusively
app.use(express.static(path.join(__dirname, 'public')));

// 2. JUGGERNAUT-STANDARD ROUTING
const serveTerminal = (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'settlement.html'));
};

app.get('/', serveTerminal);
app.get('/settlement', serveTerminal);
app.get('/settlement.html', serveTerminal);
app.get('/terminal', serveTerminal);
app.get('/index.html', serveTerminal);

// 3. WEBSOCKET FLOW CONTROL
wss.on('connection', (ws) => {
    console.log('[JUGGERNAUT] Node connected to Hydraulic Pipe');
    ws.send(JSON.stringify({ type: 'CONNECTION_ESTABLISHED', timestamp: Date.now() }));
});

// 4. START THE ENGINE
server.listen(PORT, () => {
    console.log(`[JUGGERNAUT_RESTART] System live on port ${PORT}`);
    console.log(`[FLOW_LOCKED] All routes mapped to /public/settlement.html`);
});
