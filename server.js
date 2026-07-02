const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// JUGGERNAUT BREAK-PROOF: SUPABASE INITIALIZATION
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'public' }
});

// SERVER-SIDE SANITIZATION FORTRESS
const sanitizeAsset = (a) => ({
    ...a,
    gross_arbitrage_spread: Math.abs(parseFloat(a.gross_arbitrage_spread || 0)),
    address: a.address || 'Unknown Asset',
    status: (a.status || 'Pending').toUpperCase()
});

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('X-Juggernaut-Status', 'BREAK-PROOF-V1');
    next();
});

// CIRCUIT BREAKER & REACTIVE STREAM
wss.on('connection', (ws) => {
    console.log('Juggernaut Subscriber Connected');
    
    const sendData = async () => {
        try {
            const { data: assets } = await supabase.from('deals_master').select('*').order('created_at', { ascending: false });
            ws.send(JSON.stringify({ type: 'INITIAL_LOAD', data: (assets || []).map(sanitizeAsset) }));
        } catch (e) {
            console.error('Circuit Breaker Tripped: Initial Load Failed');
        }
    };
    sendData();

    ws.on('message', (message) => {
        if (message === 'HEARTBEAT') ws.send('HEARTBEAT_ACK');
    });
});

// SUPABASE REALTIME LISTENER
supabase
  .channel('public:deals_master')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'deals_master' }, payload => {
    const sanitized = sanitizeAsset(payload.new);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'DELTA_UPDATE', data: sanitized }));
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
            .card:active { transform: scale(0.98); background: #111; }
            .val { font-size: 1.8rem; color: #0f0; margin: 10px 0; font-weight: bold; }
            .name { color: #00ffff; font-weight: bold; font-size: 0.9rem; word-break: break-all; }
            .footer { display: flex; justify-content: space-between; font-size: 0.6rem; color: #666; font-weight: bold; }
            .circuit-breaker { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); color: #ff4444; z-index: 10000; justify-content: center; align-items: center; text-align: center; font-weight: bold; }
        </style></head><body>
            <div id="cb" class="circuit-breaker">CIRCUIT BREAKER ACTIVE: RE-ESTABLISHING STREAM...</div>
            <div class="total" id="total-vol">VOLUME: $0</div>
            <div class="metrics-bar"><span>⚡ BREAK-PROOF ENGINE</span><span id="heartbeat">HEARTBEAT: OK</span></div>
            <div id="asset-list"></div>
            <script>
                const connect = () => {
                    const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws'));
                    const assetList = document.getElementById('asset-list');
                    const totalVol = document.getElementById('total-vol');
                    const cb = document.getElementById('cb');
                    let assets = [];

                    const render = () => {
                        const vol = assets.reduce((sum, a) => sum + a.gross_arbitrage_spread, 0);
                        totalVol.innerText = 'VOLUME: $' + vol.toLocaleString();
                        assetList.innerHTML = assets.map(a => \`
                            <div class="card" id="asset-\${a.id}">
                                <div class="name">\${a.address}</div>
                                <div class="val">+\$\${a.gross_arbitrage_spread.toLocaleString()}</div>
                                <div class="footer">
                                    <span>STATUS: \${a.status}</span>
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
                            const idx = assets.findIndex(a => a.id === msg.data.id);
                            if (idx !== -1) assets[idx] = msg.data;
                            else assets.unshift(msg.data);
                            render();
                        }
                    };

                    ws.onclose = () => {
                        cb.style.display = 'flex';
                        setTimeout(connect, 2000);
                    };

                    ws.onopen = () => { cb.style.display = 'none'; };

                    setInterval(() => {
                        if (ws.readyState === WebSocket.OPEN) ws.send('HEARTBEAT');
                    }, 5000);
                };
                connect();
            </script>
        </body></html>`);
});

server.listen(PORT, () => console.log('Juggernaut Break-Proof Engine Active.'));
