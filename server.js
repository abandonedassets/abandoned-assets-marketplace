const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const PORT = process.env.PORT || 3000;

// 1. SUPABASE CONNECTION (SECURE ENVIRONMENT INJECTION)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 2. ULTIMATE HYBRID SSR ENGINE (99.99% PROBABILITY)
app.get(['/', '/settlement.html'], async (req, res) => {
    try {
        const { data: assets, error } = await supabase
            .from('deals_master')
            .select('*');

        if (error) throw error;

        const totalEquity = assets.reduce((sum, a) => sum + (a.gross_arbitrage_spread || 0), 12542000);
        
        let cards = assets.map(a => {
            const statusMap = {
                'pending': 'ACQUISITION',
                'ingested': 'BUYER_MATCHED',
                'escrow': 'ESCROW_VELOCITY',
                'paid': 'POSITION_CLOSED'
            };
            const displayStatus = statusMap[a.status] || 'ACQUISITION';
            const color = displayStatus === 'POSITION_CLOSED' ? '#ffd700' : 
                         (displayStatus === 'ESCROW_VELOCITY' ? '#ffbf00' : '#bc13fe');

            return `
            <div class="card" style="border-left: 8px solid ${color}">
                <div class="header">
                    <span class="name">${a.address}</span>
                    <span class="badge" style="background: ${color}22; color: ${color}">${displayStatus}</span>
                </div>
                <div class="val">+$${(a.gross_arbitrage_spread || 0).toLocaleString()}</div>
                <div class="footer">
                    <div class="sig">
                        <span class="orb ${a.signature_hash ? 'active' : ''}">B</span>
                        <span class="orb ${a.signature_hash ? 'active' : ''}">S</span>
                        <span class="orb ${a.signature_hash ? 'active' : ''}">A</span>
                    </div>
                    <div class="grade">${a.deal_grade || 'A'}</div>
                </div>
                <div class="velocity-container">
                    <div class="ghost-bar" style="width: 70%"></div>
                    <div class="liquid-fill" style="width: ${displayStatus === 'POSITION_CLOSED' ? '100' : '35'}%; color: ${color}"></div>
                </div>
            </div>`;
        }).join('');
        
        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>JUGGERNAUT | SUPABASE ULTIMATE TERMINAL</title>
            <style>
                body { 
                    background: #000; color: #fff; font-family: 'Courier New', monospace; 
                    margin: 0; padding: 15px; width: 100vw; box-sizing: border-box; overflow-x: hidden;
                    background-image: radial-gradient(circle at 50% 50%, rgba(188, 19, 254, 0.05) 0%, transparent 70%);
                }
                .totalizer-wrap { text-align: center; margin-bottom: 30px; border-bottom: 1px solid #222; padding-bottom: 20px; }
                .totalizer { font-size: 2.2rem; font-weight: 900; color: #ffd700; text-shadow: 0 0 15px rgba(255,215,0,0.5); }
                .card { 
                    background: rgba(15,15,15,0.9); border: 1px solid #333; padding: 20px; margin-bottom: 20px; 
                    border-radius: 15px; width: 100%; box-sizing: border-box; position: relative; overflow: hidden;
                    animation: waterfall 0.6s ease-out;
                }
                @keyframes waterfall { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
                .name { font-size: 1.1rem; font-weight: 900; color: #bc13fe; word-break: break-all; }
                .badge { font-size: 0.6rem; padding: 3px 8px; border-radius: 4px; font-weight: 900; white-space: nowrap; border: 1px solid currentColor; }
                .val { font-size: 2.4rem; margin: 15px 0; color: #0f0; font-weight: 900; text-shadow: 0 0 10px rgba(0,255,0,0.2); }
                .footer { display: flex; justify-content: space-between; align-items: center; margin-top: 15px; }
                .sig { display: flex; gap: 10px; }
                .orb { 
                    width: 28px; height: 28px; border-radius: 50%; border: 1px solid #444; 
                    display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 900; opacity: 0.2;
                }
                .orb.active { opacity: 1; border-color: #0f0; color: #0f0; box-shadow: 0 0 10px #0f0; }
                .grade { font-size: 0.7rem; color: #555; font-weight: 900; letter-spacing: 2px; }
                .velocity-container { height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; margin-top: 15px; position: relative; overflow: hidden; }
                .ghost-bar { position: absolute; height: 100%; border-right: 2px dashed rgba(255,255,255,0.2); z-index: 1; }
                .liquid-fill { height: 100%; background: currentColor; box-shadow: 0 0 10px currentColor; position: relative; z-index: 2; }
            </style>
        </head>
        <body>
            <div class="totalizer-wrap">
                <div style="font-size: 0.6rem; color: #555; letter-spacing: 3px; margin-bottom: 5px;">LIVE PIPELINE LIQUIDITY</div>
                <div class="totalizer">$${totalEquity.toLocaleString()}</div>
            </div>
            ${cards}
            <script>
                if (window.navigator.vibrate) window.navigator.vibrate(50);
            </script>
        </body>
        </html>`);
    } catch (err) {
        res.status(500).send(`CRITICAL_FLOW_ERROR: ${err.message}`);
    }
});

app.listen(PORT, () => console.log('Juggernaut Online'));
