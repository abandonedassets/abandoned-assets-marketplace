const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// JUGGERNAUT NASA-TITANIC: BLUEVINE CLOUD V3 (OBSESSIVE TELEMETRY)
let supabase;
if (process.env.SUPABASE_URL && process.env.SUPABASE_URL !== 'https://dummy.supabase.co') {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
      auth: { persistSession: false },
      db: { schema: 'public' }
    });
} else {
    supabase = {
        from: () => ({
            select: () => ({ order: () => Promise.resolve({ data: [
                { id: 'TX-57000-SETTLE', address: '57K Settlement Asset', gross_arbitrage_spread: 57000, status: 'AWAITING_TITLE_WIRE' },
                { id: 'IL-3100-COURT', address: 'Courtyard Cir., Aurora, IL', gross_arbitrage_spread: 3100, status: 'TITLE_OPENED' }
            ] }) }),
            update: () => ({ eq: () => Promise.resolve({ error: null }) })
        }),
        channel: () => ({ on: () => ({ subscribe: () => {} }) })
    };
}

const ESCROW_STATES = {
    SIGNATURES_PENDING: { color: '#ffffff', label: 'SIGNATURES PENDING', pulse: false },
    MATCH_CONFIRMED: { color: '#0047ff', label: 'MATCH CONFIRMED', pulse: true },
    TITLE_OPENED: { color: '#00ffff', label: 'TITLE OPENED (THE GRAB)', pulse: true },
    CLEAR_TO_CLOSE: { color: '#ffff00', label: 'CLEAR TO CLOSE', pulse: true },
    AWAITING_TITLE_WIRE: { color: '#ff8c00', label: 'AWAITING TITLE WIRE', pulse: true },
    FUNDS_SETTLED: { color: '#00ff00', label: 'FUNDS SETTLED', pulse: false }
};

const sanitizeAsset = (a) => {
    const status = (a.status || 'SIGNATURES_PENDING').toUpperCase().replace(/ /g, '_');
    const state = ESCROW_STATES[status] || ESCROW_STATES.SIGNATURES_PENDING;
    return {
        ...a,
        settlement_amount: Math.abs(parseFloat(a.gross_arbitrage_spread || 0)),
        address: a.address || 'Unknown Asset',
        status: status,
        state_label: state.label,
        state_color: state.color,
        state_pulse: state.pulse,
        id: a.id || '00000000'
    };
};

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('X-Juggernaut-Engine', 'NASA-TITANIC-V3');
    next();
});

// TITLE GRAB WEBHOOK (Simulated tracked link click)
app.get('/api/track-title-grab/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await supabase.from('deals_master').update({ status: 'TITLE_OPENED', updated_at: new Date() }).eq('id', id);
        res.send('<h1>TITLE_FILE_ACCESSED: TELEMETRY_LOGGED</h1>');
    } catch (e) { res.status(500).send('ERROR_LOGGING_GRAB'); }
});

app.post('/api/initiate-settlement', async (req, res) => {
    const { id } = req.body;
    try {
        await supabase.from('deals_master').update({ status: 'CLEAR_TO_CLOSE', updated_at: new Date() }).eq('id', id);
        res.json({ success: true, message: 'ALPHA GENERATED: BLUEVINE WIRE DISPATCHED' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

wss.on('connection', (ws) => {
    const sendData = async () => {
        try {
            const { data: assets } = await supabase.from('deals_master').select('*').order('created_at', { ascending: false });
            ws.send(JSON.stringify({ type: 'INITIAL_LOAD', data: (assets || []).map(sanitizeAsset) }));
        } catch (e) { ws.send(JSON.stringify({ type: 'CIRCUIT_BREAKER', error: 'Database Desync' })); }
    };
    sendData();
});

supabase.channel('public:deals_master').on('postgres_changes', { event: '*', schema: 'public', table: 'deals_master' }, p => {
    const sanitized = sanitizeAsset(p.new || p.old);
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'DELTA_UPDATE', data: sanitized })); });
}).subscribe();

app.get(['/', '/settlement.html'], (req, res) => {
    res.send(`<!DOCTYPE html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>JUGGERNAUT | NASA-TITANIC TERMINAL</title>
        <style>
            :root { --bg: #020202; --panel: #0a0a0a; --border: #1a1a1a; --accent: #00ffff; --bluevine: #0047ff; --alpha: #00ff00; }
            body { background: var(--bg); color: #fff; font-family: 'Inter', sans-serif; margin: 0; overflow: hidden; height: 100vh; }
            .terminal-hud { height: 70px; border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 30px; justify-content: space-between; background: rgba(2,2,2,0.8); backdrop-filter: blur(20px); z-index: 100; position: relative; }
            .system-status { display: flex; align-items: center; gap: 15px; font-size: 0.7rem; font-weight: 800; letter-spacing: 2px; color: #444; }
            .status-indicator { width: 8px; height: 8px; border-radius: 50%; background: var(--alpha); box-shadow: 0 0 10px var(--alpha); }
            .total-liquidity { font-size: 1.5rem; font-weight: 900; color: var(--accent); }
            .velocity-meter { color: #ffd700; font-size: 0.8rem; font-weight: 900; border-left: 2px solid #222; padding-left: 15px; margin-left: 15px; }
            #telemetry-grid { height: calc(100vh - 70px); overflow-y: auto; padding: 30px; display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 20px; box-sizing: border-box; }
            .asset-card { background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 25px; position: relative; transition: all 0.4s; cursor: pointer; }
            .asset-card:hover { border-color: #333; background: #0f0f0f; transform: translateY(-5px); }
            .settlement-val { font-size: 2.2rem; font-weight: 900; color: #fff; margin: 10px 0; }
            .milestone-badge { display: inline-flex; align-items: center; padding: 6px 12px; border-radius: 100px; font-size: 0.6rem; font-weight: 900; letter-spacing: 1px; border: 1px solid currentColor; }
            .pulse { animation: pulse-kf 1.5s infinite; }
            @keyframes pulse-kf { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
            .modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.98); backdrop-filter: blur(40px); z-index: 2000; align-items: center; justify-content: center; padding: 20px; }
            .modal-content { background: #050505; border: 2px solid var(--accent); border-radius: 32px; padding: 50px; width: 100%; max-width: 500px; text-align: center; box-shadow: 0 0 100px rgba(0,255,255,0.1); position: relative; overflow: hidden; }
            .modal-content::before { content: "NASA-TITANIC TELEMETRY"; position: absolute; top: 20px; left: -30px; background: #ffd700; color: #000; font-size: 0.5rem; font-weight: 900; padding: 5px 40px; transform: rotate(-45deg); letter-spacing: 2px; }
            .btn-bluevine { width: 100%; padding: 25px; background: var(--bluevine); color: #fff; border: none; border-radius: 16px; font-weight: 900; font-size: 1.2rem; margin-top: 30px; cursor: pointer; text-transform: uppercase; letter-spacing: 3px; box-shadow: 0 0 40px rgba(0,71,255,0.4); }
            .alpha-cascade { position: fixed; inset: 0; background: rgba(0,255,0,0.2); display: none; pointer-events: none; z-index: 3000; animation: flash 0.8s ease-out; }
            @keyframes flash { 0% { opacity: 1; transform: scale(1.1); } 100% { opacity: 0; transform: scale(1); } }
            #cb { position: fixed; inset: 0; background: var(--bg); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        </style></head><body>
            <div id="cb" style="color:#555; font-size:0.7rem; font-weight:900; letter-spacing:3px;">NASA_TITANIC_RADAR_ACTIVE</div>
            <div id="alpha" class="alpha-cascade"></div>
            <div class="terminal-hud">
                <div class="system-status"><div class="status-indicator"></div> ENGINE: NASA-TITANIC-V3</div>
                <div style="display:flex; align-items:center;">
                    <div id="total-vol" class="total-liquidity">$0.00</div>
                    <div id="velocity" class="velocity-meter">VELOCITY: 0.00%</div>
                </div>
                <div class="system-status">NODE: REELEDGE_HQ</div>
            </div>
            <div id="telemetry-grid"></div>
            <div id="modal" class="modal">
                <div class="modal-content">
                    <p style="color:#444; font-size:0.6rem; font-weight:900; letter-spacing:2px; margin-bottom:10px;">MISSION OBJECTIVE:</p>
                    <h2 id="mName" style="color:#fff; margin:0 0 15px 0; font-size:1.5rem; letter-spacing:-1px;"></h2>
                    <div id="mVal" style="font-size: 4rem; font-weight: 900; margin-bottom: 35px; color:var(--accent); letter-spacing:-2px;"></div>
                    <div style="background: #0a0a0a; padding: 25px; border-radius: 20px; border: 1px solid #1a1a1a; text-align: left;">
                        <p style="color: #444; font-size: 0.6rem; margin: 0; font-weight:900; letter-spacing:1px;">SETTLEMENT DESTINATION:</p>
                        <p style="color: var(--bluevine); font-weight: 900; margin: 8px 0 0 0; font-size:1.1rem; letter-spacing:1px;">BLUEVINE_CLOUD_WIRE</p>
                        <div style="margin-top:15px; border-top:1px solid #222; padding-top:15px;">
                            <p style="color: #444; font-size: 0.5rem; margin: 0;">RADAR_TRACKING_LINK:</p>
                            <code id="trackLink" style="color:#00ffff; font-size:0.6rem; word-break:break-all;"></code>
                        </div>
                    </div>
                    <button class="btn-bluevine" onclick="initiateSettlement()">EXECUTE BLUEVINE WIRE</button>
                    <button style="width:100%; background:transparent; border:none; color:#333; font-weight:900; font-size:0.7rem; margin-top:30px; cursor:pointer; letter-spacing:2px;" onclick="closeModal()">ABORT MISSION</button>
                </div>
            </div>
            <audio id="roar" src="https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3"></audio>
            <script>
                let currentAsset = null;
                const connect = () => {
                    const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws'));
                    const grid = document.getElementById('telemetry-grid');
                    const totalVol = document.getElementById('total-vol');
                    const velMeter = document.getElementById('velocity');
                    const cb = document.getElementById('cb');
                    let assets = [];

                    const render = () => {
                        const vol = assets.reduce((sum, a) => sum + a.settlement_amount, 0);
                        totalVol.innerText = '$' + vol.toLocaleString(undefined, { minimumFractionDigits: 2 });
                        const velocity = (Math.random() * 0.5 + 1.2).toFixed(2);
                        velMeter.innerText = 'VELOCITY: ' + velocity + '%';

                        grid.innerHTML = assets.map(a => {
                            return \`
                            <div class="asset-card" onclick="openModal(\${JSON.stringify(a).replace(/"/g, '&quot;')})">
                                <div style="font-size:0.7rem; font-weight:800; color:#444; margin-bottom:10px;">\${a.address}</div>
                                <div class="settlement-val">$\${a.settlement_amount.toLocaleString()}</div>
                                <div class="milestone-badge \${a.state_pulse ? 'pulse' : ''}" style="color: \${a.state_color}">\${a.state_label}</div>
                            </div>\`;
                        }).join('');
                    };

                    ws.onmessage = (e) => {
                        const msg = JSON.parse(e.data);
                        if (msg.type === 'INITIAL_LOAD') { assets = msg.data; render(); cb.style.display = 'none'; }
                        else if (msg.type === 'DELTA_UPDATE') {
                            const idx = assets.findIndex(a => a.id === msg.data.id);
                            if (idx !== -1) assets[idx] = msg.data; else assets.unshift(msg.data);
                            render();
                        }
                    };
                };
                connect();

                function openModal(data) {
                    currentAsset = data;
                    document.getElementById('mName').innerText = data.address;
                    document.getElementById('mVal').innerText = '$' + data.settlement_amount.toLocaleString();
                    document.getElementById('trackLink').innerText = window.location.origin + '/api/track-title-grab/' + data.id;
                    document.getElementById('modal').style.display = 'flex';
                }
                function closeModal() { document.getElementById('modal').style.display = 'none'; }

                async function initiateSettlement() {
                    if (!currentAsset) return;
                    const res = await fetch('/api/initiate-settlement', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: currentAsset.id })
                    });
                    if (res.ok) {
                        document.getElementById('alpha').style.display = 'block';
                        document.getElementById('roar').play();
                        setTimeout(() => { 
                            document.getElementById('alpha').style.display = 'none';
                            closeModal();
                        }, 800);
                    }
                }
            </script>
        </body></html>`);
});

server.listen(PORT, () => console.log('Juggernaut NASA-Titanic V3 Active.'));
