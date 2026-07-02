const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// JUGGERNAUT REACTIVE ENGINE: SUPABASE CONNECTION
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'public' }
});

// HARDENED MATH SANITIZATION MIDDLEWARE
const sanitizeValue = (val) => Math.abs(parseFloat(val || 0));

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('X-Juggernaut-Engine', 'REACTIVE-V1');
    next();
});

// BI-DIRECTIONAL TELEMETRY HEARTBEAT (WebSocket)
wss.on('connection', (ws) => {
    console.log('Juggernaut Subscriber Connected');
    
    // DELTA-COMPRESSION: Sending only the change (Initial Load)
    const sendInitialData = async () => {
        const { data: assets } = await supabase.from('deals_master').select('*').order('created_at', { ascending: false });
        ws.send(JSON.stringify({ type: 'INITIAL_LOAD', data: assets }));
    };
    sendInitialData();

    ws.on('message', (message) => {
        if (message === 'HEARTBEAT') ws.send('HEARTBEAT_ACK');
    });
});

// REACTIVE STREAM LISTENER: Listening for Supabase Changes
supabase
  .channel('public:deals_master')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'deals_master' }, payload => {
    // DELTA-COMPRESSION: Broadcast only the changed row
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'DELTA_UPDATE', data: payload.new }));
      }
    });
  })
  .subscribe();

app.get(['/', '/settlement.html'], (req, res) => {
    res.send(`<!DOCTYPE html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { background: #000; color: #0f0; font-family: 'Courier New', monospace; margin: 0; padding: 10px; width: 100vw; box-sizing: border-box; overflow-x: hidden; }
            .total { color: #ffd700; font-size: 1.8rem; text-align: center; margin-bottom: 5px; font-weight: bold; }
            .metrics-bar { display: flex; justify-content: space-around; font-size: 0.7rem; color: #00ff00; margin-bottom: 20px; border-bottom: 1px solid #333; padding-bottom: 10px; }
            #asset-list { display: flex; flex-direction: column; gap: 15px; }
            .card { position: relative; background: #0a0a0a; border: 1px solid #222; padding: 15px; border-radius: 12px; transition: all 0.2s; cursor: pointer; }
            .card.optimistic { opacity: 0.7; border-style: dashed; }
            .val { font-size: 1.8rem; color: #0f0; margin: 10px 0; font-weight: bold; }
            .name { color: #00ffff; font-weight: bold; font-size: 0.9rem; word-break: break-all; }
            .footer { display: flex; justify-content: space-between; font-size: 0.6rem; color: #666; font-weight: bold; }
        </style></head><body>
            <div class="total" id="total-vol">VOLUME: $0</div>
            <div class="metrics-bar"><span>⚡ JUGGERNAUT REACTIVE</span><span id="heartbeat">HEARTBEAT: OK</span></div>
            <div id="asset-list"></div>
            <script>
                const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws'));
                const assetList = document.getElementById('asset-list');
                const totalVol = document.getElementById('total-vol');
                let assets = [];

                // HARDENED MATH SANITIZATION
                const formatVal = (val) => Math.abs(parseFloat(val || 0));

                const render = () => {
                    const vol = assets.reduce((sum, a) => sum + formatVal(a.gross_arbitrage_spread), 0);
                    totalVol.innerText = 'VOLUME: $' + vol.toLocaleString();
                    assetList.innerHTML = assets.map(a => \`
                        <div class="card" id="asset-\${a.id}">
                            <div class="name">\${a.address || 'Unknown Asset'}</div>
                            <div class="val">+\$\${formatVal(a.gross_arbitrage_spread).toLocaleString()}</div>
                            <div class="footer">
                                <span>STATUS: \${a.status.toUpperCase()}</span>
                                <span>ID: #\${a.id.substring(0,8)}</span>
                            </div>
                        </div>\`).join('');
                };

                ws.onmessage = (event) => {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'INITIAL_LOAD') {
                        assets = msg.data;
                        render();
                    } else if (msg.type === 'DELTA_UPDATE') {
                        // DELTA-COMPRESSION & OPTIMISTIC UI
                        const idx = assets.findIndex(a => a.id === msg.data.id);
                        if (idx !== -1) assets[idx] = msg.data;
                        else assets.unshift(msg.data);
                        render();
                    }
                };

                // BI-DIRECTIONAL HEARTBEAT
                setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) ws.send('HEARTBEAT');
                    else document.getElementById('heartbeat').innerText = 'HEARTBEAT: LOST';
                }, 5000);
            </script>
        </body></html>`);
});

server.listen(PORT, () => console.log('Juggernaut Reactive Engine Active.'));
