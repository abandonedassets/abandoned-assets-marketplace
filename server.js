const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// JUGGERNAUT TITAN: SUPABASE INITIALIZATION
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'public' }
});

const sanitizeAsset = (a) => ({
    ...a,
    gross_arbitrage_spread: Math.abs(parseFloat(a.gross_arbitrage_spread || 0)),
    address: a.address || 'Unknown Asset',
    status: (a.status || 'Pending').toUpperCase(),
    id: a.id || '00000000'
});

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('X-Juggernaut-Engine', 'STRIPE-STRIKE-V1');
    next();
});

// REACTIVE STREAM LISTENER (WebSocket)
wss.on('connection', (ws) => {
    const sendData = async () => {
        try {
            const { data: assets } = await supabase.from('deals_master').select('*').order('created_at', { ascending: false });
            ws.send(JSON.stringify({ type: 'INITIAL_LOAD', data: (assets || []).map(sanitizeAsset) }));
        } catch (e) { ws.send(JSON.stringify({ type: 'CIRCUIT_BREAKER', error: 'Database Desync' })); }
    };
    sendData();
    ws.on('message', (m) => { if (m === 'HEARTBEAT') ws.send('HEARTBEAT_ACK'); });
});

supabase.channel('public:deals_master').on('postgres_changes', { event: '*', schema: 'public', table: 'deals_master' }, p => {
    const sanitized = sanitizeAsset(p.new);
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'DELTA_UPDATE', data: sanitized })); });
}).subscribe();

app.get(['/', '/settlement.html'], (req, res) => {
    res.send(`<!DOCTYPE html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { background: #000; color: #0f0; font-family: 'Courier New', monospace; margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden; box-sizing: border-box; }
            .hud { position: fixed; top: 0; left: 0; width: 100%; height: 60px; background: rgba(0,20,0,0.9); border-bottom: 2px solid #0f0; display: flex; justify-content: space-between; align-items: center; padding: 0 20px; z-index: 1000; box-sizing: border-box; }
            .hud-gauge { color: #00ffff; font-size: 0.7rem; font-weight: bold; }
            .volume-ticker { color: #ffd700; font-size: 1.2rem; font-weight: bold; }
            #waterfall { position: absolute; top: 60px; left: 0; width: 100%; height: calc(100vh - 60px); overflow-y: auto; padding: 20px; box-sizing: border-box; display: flex; flex-direction: column; gap: 20px; }
            .card { position: relative; background: #0a0a0a; border: 1px solid #222; padding: 20px; border-radius: 12px; animation: cascade 0.6s ease-out; cursor: pointer; transition: all 0.3s; }
            @keyframes cascade { from { transform: translateY(-30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            .status-pulse { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #ffd700; box-shadow: 0 0 10px #ffd700; animation: heartbeat 1.5s infinite; margin-right: 10px; }
            @keyframes heartbeat { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.4; } 100% { transform: scale(1); opacity: 1; } }
            .status-pulse.green { background: #00ff00; box-shadow: 0 0 20px #00ff00; }
            .name { color: #00ffff; font-weight: bold; font-size: 1rem; word-break: break-all; }
            .val { font-size: 2.2rem; color: #0f0; margin: 15px 0; font-weight: bold; }
            .footer { display: flex; justify-content: space-between; font-size: 0.7rem; color: #555; font-weight: bold; }
            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); backdrop-filter: blur(10px); padding: 25px; box-sizing: border-box; z-index: 2000; }
            .modal-content { border: 2px solid #0f0; padding: 30px; border-radius: 20px; background: #050505; max-width: 500px; margin: auto; }
            .btn-stripe { width: 100%; padding: 20px; background: #635bff; color: #fff; border: none; border-radius: 12px; font-weight: 900; font-size: 1.1rem; margin-top: 20px; cursor: pointer; animation: pulse-stripe 2s infinite; text-transform: uppercase; }
            @keyframes pulse-stripe { 0% { box-shadow: 0 0 0 0 rgba(99, 91, 255, 0.7); } 70% { box-shadow: 0 0 0 15px rgba(99, 91, 255, 0); } 100% { box-shadow: 0 0 0 0 rgba(99, 91, 255, 0); } }
            .btn-close { width: 100%; padding: 15px; background: transparent; color: #0f0; border: 1px solid #0f0; border-radius: 12px; font-weight: bold; margin-top: 15px; cursor: pointer; }
            #cb { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,20,40,0.9); color: #00ffff; z-index: 10000; justify-content: center; align-items: center; text-align: center; font-size: 1.2rem; font-weight: bold; }
        </style></head><body>
            <div id="cb">NEURAL HANDSHAKE IN PROGRESS...</div>
            <div class="hud">
                <div>INGESTION: <span class="hud-gauge">NASA LIGHT-SPEED</span></div>
                <div id="total-vol" class="volume-ticker">$0</div>
                <div>STRIPE: <span style="color:#635bff">ACTIVE</span></div>
            </div>
            <div id="waterfall"></div>
            <div id="modal" class="modal">
                <div class="modal-content">
                    <h2 id="mName" style="color:#00ffff; margin-bottom: 5px; word-break: break-all;"></h2>
                    <div id="mVal" style="font-size: 3rem; color: #ffd700; margin: 20px 0; font-weight: 900;"></div>
                    <div style="background: #111; padding: 15px; border-radius: 10px; border-left: 4px solid #635bff;">
                        <p style="color: #888; margin: 0; font-size: 0.8rem;">SETTLEMENT GATEWAY:</p>
                        <p style="color: #635bff; font-weight: bold; margin: 5px 0 0 0; letter-spacing: 2px;">STRIPE_STRIKE [READY]</p>
                    </div>
                    <button class="btn-stripe" onclick="alert('STRIPE SETTLEMENT INITIATED')">STRIKE VIA STRIPE</button>
                    <button class="btn-close" onclick="closeModal()">DISMISS DOSSIER</button>
                </div>
            </div>
            <script>
                const connect = () => {
                    const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws'));
                    const waterfall = document.getElementById('waterfall');
                    const totalVol = document.getElementById('total-vol');
                    const cb = document.getElementById('cb');
                    let assets = [];

                    const render = (newId) => {
                        const vol = assets.reduce((sum, a) => sum + a.gross_arbitrage_spread, 0);
                        totalVol.innerText = '$' + vol.toLocaleString();
                        waterfall.innerHTML = assets.map(a => \`
                            <div class="card" onclick="openModal(\${JSON.stringify(a).replace(/"/g, '&quot;')})">
                                <div class="name"><span class="status-pulse \${a.status === 'SETTLED' ? 'green' : ''}"></span>\${a.address}</div>
                                <div class="val">+\$\${a.gross_arbitrage_spread.toLocaleString()}</div>
                                <div class="footer">
                                    <span>STATUS: \${a.status}</span>
                                    <span>ID: #\${a.id.substring(0,8)}</span>
                                </div>
                            </div>\`).join('');
                    };

                    ws.onmessage = (event) => {
                        const msg = JSON.parse(event.data);
                        if (msg.type === 'INITIAL_LOAD') { assets = msg.data; render(); }
                        else if (msg.type === 'DELTA_UPDATE') {
                            const idx = assets.findIndex(a => a.id === msg.data.id);
                            if (idx !== -1) assets[idx] = msg.data;
                            else assets.unshift(msg.data);
                            render(msg.data.id);
                        }
                    };
                    ws.onclose = () => { cb.style.display = 'flex'; setTimeout(connect, 2000); };
                    ws.onopen = () => { cb.style.display = 'none'; };
                };
                connect();

                function openModal(data) {
                    document.getElementById('mName').innerText = data.address;
                    document.getElementById('mVal').innerText = '+$' + data.gross_arbitrage_spread.toLocaleString();
                    document.getElementById('modal').style.display = 'block';
                }
                function closeModal() { document.getElementById('modal').style.display = 'none'; }
            </script>
        </body></html>`);
});

server.listen(PORT, () => console.log('Juggernaut Stripe-Strike Active.'));
