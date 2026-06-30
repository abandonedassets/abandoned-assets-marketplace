const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    next();
});

app.get(['/', '/settlement.html'], async (req, res) => {
    try {
        const { data: assets, error } = await supabase.from('deals_master').select('*');
        if (error) throw error;

        // Ultimate Hybrid Logic: Velocity and Health calculation
        const totalLiquidity = (assets || []).reduce((sum, a) => sum + (Number(a.gross_arbitrage_spread) || 0), 0).toLocaleString();
        
        const cards = (assets || []).map(a => {
            // Visual Intelligence: Flow health calculation
            const resistance = a.flow_resistance || 2; 
            const healthColor = resistance > 7 ? '#ff4444' : resistance > 4 ? '#ffbb33' : '#00c851';
            
            // Progress toward 30 day close (simulation based on created_at)
            const createdDate = new Date(a.created_at);
            const now = new Date();
            const daysActive = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
            const progress = Math.min(daysActive / 30 * 100, 100);

            const assetData = {
                name: a.address || 'Unknown Asset',
                val: a.gross_arbitrage_spread || 0,
                state: (a.status || 'PENDING').toUpperCase(),
                id: a.id
            };

            return `
            <div class="card" onclick="openModal(${JSON.stringify(assetData).replace(/"/g, '&quot;')})">
                <div class="header">
                    <span class="name">${assetData.name}</span>
                    <span class="status" style="color: ${healthColor}">●</span>
                </div>
                <div class="val">+$${(Number(assetData.val) || 0).toLocaleString()}</div>
                <div class="progress-container"><div class="progress-bar" style="width: ${progress}%"></div></div>
                <div class="footer">
                    <span>${a.arb_spread_pct || '0'}% SPREAD</span>
                    <span>${a.target_closing_date || 'N/A'}</span>
                </div>
            </div>`;
        }).join('');

        res.send(`<!DOCTYPE html><html><head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { background: #000; color: #0f0; font-family: 'Courier New', monospace; margin: 0; padding: 10px; width: 100vw; box-sizing: border-box; overflow-x: hidden; }
                .total { color: #ffd700; font-size: 1.8rem; text-align: center; margin-bottom: 5px; font-weight: bold; }
                .trend { color: #00c851; font-size: 0.8rem; text-align: center; margin-bottom: 20px; letter-spacing: 2px; }
                .card { background: #111; padding: 15px; margin-bottom: 12px; border-radius: 12px; border: 1px solid #222; cursor: pointer; width: 100%; box-sizing: border-box; }
                .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
                .name { color: #00ffff; font-weight: bold; font-size: 0.9rem; word-break: break-all; }
                .status { font-size: 1.2rem; line-height: 1; }
                .val { font-size: 1.6rem; color: #0f0; margin: 5px 0; font-weight: bold; }
                .progress-container { height: 4px; background: #333; border-radius: 2px; margin: 10px 0; position: relative; overflow: hidden; }
                .progress-bar { height: 100%; background: #0f0; border-radius: 2px; box-shadow: 0 0 10px #0f0; }
                .footer { display: flex; justify-content: space-between; font-size: 0.7rem; color: #666; font-weight: bold; }
                .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; padding: 20px; box-sizing: border-box; z-index: 1000; overflow-y: auto; }
                .modal-content { border: 1px solid #333; padding: 20px; border-radius: 15px; background: #0a0a0a; box-shadow: 0 0 30px rgba(0,255,0,0.1); }
                .btn { width: 100%; padding: 15px; background: #0f0; color: #000; border: none; border-radius: 8px; font-weight: bold; margin-top: 10px; cursor: pointer; }
            </style></head><body>
                <div class="total">VOLUME: $${totalLiquidity}</div>
                <div class="trend">▲ MOMENTUM POSITIVE</div>
                ${cards}
                <div id="modal" class="modal">
                    <div class="modal-content">
                        <h2 id="mName" style="color:#0f0; border-bottom: 1px solid #333; padding-bottom: 10px; word-break: break-all;"></h2>
                        <div id="mVal" style="font-size: 2rem; color: #ffd700; margin: 15px 0;"></div>
                        <p style="color: #888;">STATUS: <span id="mState" style="color: #fff; font-weight: bold;"></span></p>
                        <button class="btn" onclick="alert('Signal Path Cleared')">CLEAR PATHWAY</button>
                        <button class="btn" style="background:#222; color:#0f0; border:1px solid #0f0;" onclick="closeModal()">CLOSE</button>
                    </div>
                </div>
                <script>
                    function openModal(data) {
                        document.getElementById('mName').innerText = data.name;
                        document.getElementById('mVal').innerText = '+$' + parseInt(data.val).toLocaleString();
                        document.getElementById('mState').innerText = data.state;
                        document.getElementById('modal').style.display = 'block';
                    }
                    function closeModal() { document.getElementById('modal').style.display = 'none'; }
                </script>
            </body></html>`);
    } catch (err) {
        res.status(500).send("System Error: Flow Interrupted.");
    }
});

app.listen(PORT, () => console.log('Juggernaut Hybrid Active.'));
