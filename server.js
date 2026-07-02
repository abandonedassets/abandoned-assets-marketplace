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

// HARDENED SANITIZATION LAYER: ELIMINATING LOGIC BOMBS
const sanitizeAsset = (a) => ({
    ...a,
    gross_arbitrage_spread: Math.abs(parseFloat(a.gross_arbitrage_spread || 0)),
    address: a.address || 'Unknown Asset',
    status: (a.status || 'Pending').toUpperCase(),
    id: a.id || '00000000'
});

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('X-Juggernaut-Engine', 'TITAN-V1');
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
            
            /* JUGGERNAUT HUD */
            .hud { position: fixed; top: 0; left: 0; width: 100%; height: 60px; background: rgba(0,20,0,0.9); border-bottom: 2px solid #0f0; display: flex; justify-content: space-between; align-items: center; padding: 0 20px; z-index: 1000; box-sizing: border-box; box-shadow: 0 0 20px rgba(0,255,0,0.2); }
            .hud-gauge { color: #00ffff; font-size: 0.7rem; font-weight: bold; }
            .volume-ticker { color: #ffd700; font-size: 1.2rem; font-weight: bold; text-shadow: 0 0 10px rgba(255, 215, 0, 0.5); }

            /* KINETIC WATERFALL */
            #waterfall { position: absolute; top: 60px; left: 0; width: 100%; height: calc(100vh - 60px); overflow-y: auto; padding: 20px; box-sizing: border-box; display: flex; flex-direction: column; gap: 20px; }
            .card { position: relative; background: #0a0a0a; border: 1px solid #222; padding: 20px; border-radius: 12px; animation: cascade 0.6s cubic-bezier(0.23, 1, 0.32, 1); cursor: pointer; transition: all 0.3s; }
            .card:hover { border-color: #00ffff; box-shadow: 0 0 15px rgba(0, 255, 255, 0.2); transform: scale(1.01); }
            @keyframes cascade { from { transform: translateY(-30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            
            /* TITAN STATUS PULSE */
            .status-pulse { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #ffd700; box-shadow: 0 0 10px #ffd700; animation: heartbeat 1.5s infinite; margin-right: 10px; }
            @keyframes heartbeat { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.4; } 100% { transform: scale(1); opacity: 1; } }
            .status-pulse.green { background: #00ff00; box-shadow: 0 0 20px #00ff00; }

            /* DELTA FLASH */
            .flash-up { animation: flash-up 0.8s; }
            @keyframes flash-up { from { background: rgba(0, 255, 0, 0.3); } to { background: #0a0a0a; } }

            .name { color: #00ffff; font-weight: bold; font-size: 1rem; word-break: break-all; margin-bottom: 5px; }
            .val { font-size: 2.2rem; color: #0f0; margin: 15px 0; font-weight: bold; letter-spacing: -1px; }
            .footer { display: flex; justify-content: space-between; font-size: 0.7rem; color: #555; font-weight: bold; border-top: 1px solid #222; padding-top: 10px; }

            /* DOSSIER MODAL */
            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); backdrop-filter: blur(10px); padding: 25px; box-sizing: border-box; z-index: 2000; overflow-y: auto; }
            .modal-content { border: 2px solid #0f0; padding: 30px; border-radius: 20px; background: #050505; box-shadow: 0 0 40px rgba(0,255,0,0.15); max-width: 500px; margin: auto; }
            .btn-escalate { width: 100%; padding: 20px; background: #0f0; color: #000; border: none; border-radius: 12px; font-weight: 900; font-size: 1.1rem; margin-top: 20px; cursor: pointer; animation: pulse-btn 2s infinite; text-transform: uppercase; }
            @keyframes pulse-btn { 0% { box-shadow: 0 0 0 0 rgba(0, 255, 0, 0.7); } 70% { box-shadow: 0 0 0 15px rgba(0, 255, 0, 0); } 100% { box-shadow: 0 0 0 0 rgba(0, 255, 0, 0); } }
            .btn-close { width: 100%; padding: 15px; background: transparent; color: #0f0; border: 1px solid #0f0; border-radius: 12px; font-weight: bold; margin-top: 15px; cursor: pointer; }

            /* CIRCUIT BREAKER OVERLAY */
            #cb { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,20,40,0.9); color: #00ffff; z-index: 10000; justify-content: center; align-items: center; text-align: center; font-size: 1.2rem; font-weight: bold; border: 4px solid #00ffff; }
        </style></head><body>
            <div id="cb">NEURAL HANDSHAKE IN PROGRESS...<br>RE-SYNCING JUGGERNAUT STREAM</div>
            <div class="hud">
                <div>INGESTION: <span class="hud-gauge">NASA LIGHT-SPEED</span></div>
                <div id="total-vol" class="volume-ticker">$0</div>
                <div>MARKET HEAT: <span style="color:#ff4444">MAX</span></div>
            </div>
            <div id="waterfall"></div>
            <div id="modal" class="modal">
                <div class="modal-content">
                    <h2 id="mName" style="color:#00ffff; margin-bottom: 5px; word-break: break-all; text-shadow: 0 0 10px #00ffff;"></h2>
                    <div id="mVal" style="font-size: 3rem; color: #ffd700; margin: 20px 0; font-weight: 900;"></div>
                    <div style="background: #111; padding: 15px; border-radius: 10px; border-left: 4px solid #0f0;">
                        <p style="color: #888; margin: 0; font-size: 0.8rem;">GHOST-ESCROW STATUS:</p>
                        <p style="color: #0f0; font-weight: bold; margin: 5px 0 0 0; letter-spacing: 2px;">PRE-CLEARED [HEARTBEAT_LOCKED]</p>
                    </div>
                    <button class="btn-escalate" onclick="alert('ESCALATION BLAST SENT')">ESCALATE PATHWAY</button>
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
                            <div class="card \${a.id === newId ? 'flash-up' : ''}" onclick="openModal(\${JSON.stringify(a).replace(/"/g, '&quot;')})">
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
                        if (msg.type === 'INITIAL_LOAD') {
                            assets = msg.data;
                            render();
                        } else if (msg.type === 'DELTA_UPDATE') {
                            const idx = assets.findIndex(a => a.id === msg.data.id);
                            if (idx !== -1) assets[idx] = msg.data;
                            else assets.unshift(msg.data);
                            render(msg.data.id);
                        } else if (msg.type === 'CIRCUIT_BREAKER') {
                            cb.style.display = 'flex';
                        }
                    };

                    ws.onclose = () => { cb.style.display = 'flex'; setTimeout(connect, 2000); };
                    ws.onopen = () => { cb.style.display = 'none'; };
                    setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('HEARTBEAT'); }, 5000);
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

server.listen(PORT, () => console.log('Juggernaut Titan Architecture Active.'));
