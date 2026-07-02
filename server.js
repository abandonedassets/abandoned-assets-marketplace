const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// JUGGERNAUT KINETIC: SUPABASE INITIALIZATION
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'public' }
});

const sanitizeAsset = (a) => ({
    ...a,
    gross_arbitrage_spread: Math.abs(parseFloat(a.gross_arbitrage_spread || 0)),
    address: a.address || 'Unknown Asset',
    status: (a.status || 'Pending').toUpperCase()
});

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('X-Juggernaut-UI', 'KINETIC-COCKPIT-V1');
    next();
});

// KINETIC STREAM: WebSocket Data Feed
wss.on('connection', (ws) => {
    const sendData = async () => {
        try {
            const { data: assets } = await supabase.from('deals_master').select('*').order('created_at', { ascending: false });
            ws.send(JSON.stringify({ type: 'INITIAL_LOAD', data: (assets || []).map(sanitizeAsset) }));
        } catch (e) { console.error('Stream Error'); }
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
            .hud { position: fixed; top: 0; left: 0; width: 100%; height: 50px; background: rgba(0,20,0,0.8); border-bottom: 1px solid #0f0; display: flex; justify-content: space-between; align-items: center; padding: 0 15px; z-index: 1000; box-sizing: border-box; font-size: 0.6rem; letter-spacing: 1px; }
            .hud-gauge { color: #00ffff; }
            .market-heat { background: linear-gradient(90deg, #00ff00, #ffff00, #ff0000); height: 4px; width: 100px; border-radius: 2px; margin-left: 5px; display: inline-block; }

            /* KINETIC WATERFALL */
            #waterfall { position: absolute; top: 50px; left: 0; width: 100%; height: calc(100vh - 50px); overflow-y: auto; padding: 15px; box-sizing: border-box; display: flex; flex-direction: column; gap: 15px; }
            .card { position: relative; background: #0a0a0a; border: 1px solid #222; padding: 15px; border-radius: 8px; animation: cascade 0.5s ease-out; cursor: pointer; transition: all 0.2s; }
            @keyframes cascade { from { transform: translateY(-50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            
            /* HEARTBEAT PULSE */
            .status-pulse { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ffd700; box-shadow: 0 0 10px #ffd700; animation: heartbeat 1.5s infinite; margin-right: 5px; }
            @keyframes heartbeat { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.5; } 100% { transform: scale(1); opacity: 1; } }
            .status-pulse.green { background: #00ff00; box-shadow: 0 0 15px #00ff00; }

            /* DELTA FLASH */
            .flash-gold { animation: flash-gold 0.5s; }
            @keyframes flash-gold { from { background: rgba(255, 215, 0, 0.4); } to { background: #0a0a0a; } }

            .name { color: #00ffff; font-weight: bold; font-size: 0.9rem; word-break: break-all; }
            .val { font-size: 1.8rem; color: #0f0; margin: 10px 0; font-weight: bold; }
            .footer { display: flex; justify-content: space-between; font-size: 0.6rem; color: #666; font-weight: bold; }

            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; padding: 20px; box-sizing: border-box; z-index: 2000; overflow-y: auto; }
            .btn { width: 100%; padding: 15px; background: #0f0; color: #000; border: none; border-radius: 8px; font-weight: bold; margin-top: 10px; cursor: pointer; }
        </style></head><body>
            <div class="hud">
                <div>VELOCITY: <span class="hud-gauge">NASA LIGHT-SPEED</span></div>
                <div id="total-vol" style="color:#ffd700; font-weight:bold; font-size:0.8rem;">$0</div>
                <div>MARKET HEAT: <div class="market-heat"></div></div>
            </div>
            <div id="waterfall"></div>
            <div id="modal" class="modal">
                <div style="border: 1px solid #333; padding: 20px; border-radius: 15px; background: #0a0a0a;">
                    <h2 id="mName" style="color:#0f0; border-bottom: 1px solid #333; padding-bottom: 10px; word-break: break-all;"></h2>
                    <div id="mVal" style="font-size: 2rem; color: #ffd700; margin: 15px 0;"></div>
                    <p style="color: #888;">GHOST-ESCROW: <span style="color: #0f0; animation: heartbeat 1s infinite;">PRE-CLEARED</span></p>
                    <button class="btn" onclick="alert('Escalation Sent')">ESCALATE PATHWAY</button>
                    <button class="btn" style="background:#222; color:#0f0; border:1px solid #0f0;" onclick="closeModal()">CLOSE</button>
                </div>
            </div>
            <script>
                const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws'));
                const waterfall = document.getElementById('waterfall');
                const totalVol = document.getElementById('total-vol');
                let assets = [];

                const render = (newId) => {
                    const vol = assets.reduce((sum, a) => sum + a.gross_arbitrage_spread, 0);
                    totalVol.innerText = '$' + vol.toLocaleString();
                    waterfall.innerHTML = assets.map(a => \`
                        <div class="card \${a.id === newId ? 'flash-gold' : ''}" onclick="openModal(\${JSON.stringify(a).replace(/"/g, '&quot;')})">
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
                    }
                };

                function openModal(data) {
                    document.getElementById('mName').innerText = data.address;
                    document.getElementById('mVal').innerText = '+$' + data.gross_arbitrage_spread.toLocaleString();
                    document.getElementById('modal').style.display = 'block';
                }
                function closeModal() { document.getElementById('modal').style.display = 'none'; }
            </script>
        </body></html>`);
});

server.listen(PORT, () => console.log('Juggernaut Kinetic Cockpit Active.'));
