const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase Connection
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Middleware: Titanic Cache-Busting (Prevents infrastructure drift)
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    next();
});

app.get(['/', '/settlement.html'], async (req, res) => {
    try {
        // Data Fetch: Aggregating all records from deals_master
        const { data: assets, error } = await supabase.from('deals_master').select('*');
        
        if (error) throw error;

        // Liquidity Calc: Titanic Precision
        const totalLiquidity = (assets || []).reduce((sum, a) => sum + (Number(a.gross_arbitrage_spread) || 0), 0).toLocaleString();
        
        // UI Render: High-Density Card Injection
        const cards = (assets || []).map(a => `
            <div class="card" onclick="openModal('${a.address || 'Unknown'}', '${a.status || 'N/A'}', '${a.gross_arbitrage_spread || 0}', '${a.id || 'N/A'}', '${a.title_company || 'Pending'}', '${a.target_closing_date || 'N/A'}', '${a.arb_spread_pct || '0'}')">
                <div class="header">
                    <span class="name">${a.address || 'Unknown Asset'}</span>
                    <span class="state">${(a.status || 'PENDING').toUpperCase()}</span>
                </div>
                <div class="val">+$${(Number(a.gross_arbitrage_spread) || 0).toLocaleString()}</div>
                <div class="footer"><div class="id">#${a.id ? a.id.substring(0,8) : '000'}</div></div>
            </div>
        `).join('');

        res.send(`<!DOCTYPE html><html><head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { background: #000; color: #0f0; font-family: 'Courier New', monospace; margin: 0; padding: 10px; width: 100vw; box-sizing: border-box; overflow-x: hidden; }
                .total { color: #ffd700; font-size: 1.5rem; text-align: center; margin-bottom: 20px; border-bottom: 1px solid #333; padding-bottom: 10px; }
                .card { background: #111; padding: 15px; margin-bottom: 10px; border-radius: 8px; border: 1px solid #222; cursor: pointer; width: 100%; box-sizing: border-box; }
                .header { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.9rem; align-items: flex-start; gap: 10px; }
                .name { color: #00ffff; font-weight: bold; word-break: break-all; }
                .state { font-size: 0.6rem; background: #222; padding: 2px 6px; border-radius: 4px; color: #fff; white-space: nowrap; }
                .val { font-size: 1.8rem; color: #0f0; margin-bottom: 10px; font-weight: bold; }
                .footer { font-size: 0.7rem; color: #666; }
                .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; padding: 20px; box-sizing: border-box; z-index: 1000; overflow-y: auto; }
                .stat-box { border: 1px solid #0f0; padding: 15px; margin-top: 20px; border-radius: 8px; }
                .close-btn { width: 100%; padding: 15px; background: #0f0; color: #000; border: none; border-radius: 5px; font-weight: bold; margin-top: 20px; }
            </style></head><body>
                <div class="total">VOLUME: $${totalLiquidity}</div>
                ${cards}
                <div id="modal" class="modal">
                    <h2 id="mName" style="color:#0f0; border-bottom: 1px solid #333; padding-bottom: 10px; word-break: break-all;"></h2>
                    <div class="stat-box">
                        <div style="font-size: 0.8rem; color: #aaa;">LIQUIDITY</div>
                        <div id="mVal" style="font-size: 2rem; color: #ffd700; margin-bottom: 15px;"></div>
                        <p>Status: <span id="mStatus" style="color: #fff;"></span></p>
                        <p>ID: <span id="mId" style="color: #fff;"></span></p>
                        <p>Closing Date: <span id="mDays" style="color: #fff;"></span></p>
                        <p>Profit Spread: <span id="mSpread" style="color: #fff;"></span></p>
                    </div>
                    <button class="close-btn" onclick="closeModal()">CLOSE CONNECTION</button>
                </div>
                <script>
                    function openModal(name, state, val, id, title, days, spread) {
                        document.getElementById('mName').innerText = name;
                        document.getElementById('mVal').innerText = '+$' + parseInt(val).toLocaleString();
                        document.getElementById('mStatus').innerText = state.toUpperCase();
                        document.getElementById('mId').innerText = id;
                        document.getElementById('mDays').innerText = days;
                        document.getElementById('mSpread').innerText = spread + '%';
                        document.getElementById('modal').style.display = 'block';
                    }
                    function closeModal() { document.getElementById('modal').style.display = 'none'; }
                </script>
            </body></html>`);
    } catch (err) {
        res.status(500).send("Juggernaut Error: " + err.message);
    }
});

app.listen(PORT, () => console.log('Juggernaut Stabilized.'));
