const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// 1. HARDCODED DATA FOR MAXIMUM RELIABILITY (JUGGERNAUT CORE)
const assets = [
    { id: "77291", name: "Aurora Commercial Pad", state: "SETTLEMENT_READY", b: 1, s: 1, a: 1, val: 125000 },
    { id: "99120", name: "Courtyard Cir.", state: "ESCROW_VELOCITY", b: 1, s: 0, a: 1, val: 45000 },
    { id: "44102", name: "Institutional Portfolio X", state: "BUYER_MATCHED", b: 1, s: 1, a: 0, val: 85000 }
];

// 2. SERVER-SIDE INJECTION ENGINE (ZERO LATENCY)
app.get(['/', '/settlement.html'], (req, res) => {
    const totalEquity = assets.reduce((sum, a) => sum + a.val, 12542000);
    
    let cards = assets.map(a => `
        <div class="card" style="border-left: 8px solid ${a.state === 'SETTLEMENT_READY' ? '#ffd700' : (a.state === 'ESCROW_VELOCITY' ? '#ffbf00' : '#bc13fe')}">
            <div class="header">
                <span class="name">${a.name}</span>
                <span class="badge" style="background: ${a.state === 'SETTLEMENT_READY' ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.1)'}; color: ${a.state === 'SETTLEMENT_READY' ? '#ffd700' : '#fff'}">${a.state}</span>
            </div>
            <div class="val">+$${a.val.toLocaleString()}</div>
            <div class="footer">
                <div class="sig">
                    <span class="orb ${a.b ? 'active' : ''}">B</span>
                    <span class="orb ${a.s ? 'active' : ''}">S</span>
                    <span class="orb ${a.a ? 'active' : ''}">A</span>
                </div>
                <div class="velo-tag">${a.state === 'SETTLEMENT_READY' ? 'OPTIMAL' : 'MONITORING'}</div>
            </div>
        </div>`).join('');
    
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>JUGGERNAUT | ULTIMATE HYBRID TERMINAL</title>
        <style>
            body { 
                background: #000; 
                color: #fff; 
                font-family: 'Courier New', monospace; 
                margin: 0; 
                padding: 15px; 
                width: 100vw; 
                box-sizing: border-box;
                overflow-x: hidden;
            }
            .ticker { 
                text-align: center; 
                margin-bottom: 20px; 
                border-bottom: 1px solid #333; 
                padding-bottom: 10px; 
            }
            .totalizer { 
                font-size: 1.8rem; 
                font-weight: bold; 
                color: #ffd700; 
                text-shadow: 0 0 10px rgba(255,215,0,0.5);
            }
            .card { 
                border: 1px solid #333; 
                padding: 20px; 
                margin-bottom: 15px; 
                border-radius: 12px; 
                background: #0a0a0a; 
                width: 100%; 
                box-sizing: border-box;
                word-wrap: break-word;
            }
            .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
            .name { font-size: 1rem; font-weight: bold; color: #bc13fe; }
            .badge { font-size: 0.6rem; padding: 3px 8px; border-radius: 4px; font-weight: bold; white-space: nowrap; }
            .val { font-size: 2rem; margin: 15px 0; color: #0f0; font-weight: bold; }
            .footer { display: flex; justify-content: space-between; align-items: center; }
            .sig { display: flex; gap: 8px; }
            .orb { 
                width: 25px; height: 25px; border-radius: 50%; border: 1px solid #444; 
                display: flex; align-items: center; justify-content: center; 
                font-size: 0.7rem; opacity: 0.3; font-weight: bold;
            }
            .orb.active { opacity: 1; border-color: #0f0; color: #0f0; box-shadow: 0 0 10px rgba(0,255,0,0.3); }
            .velo-tag { font-size: 0.6rem; color: #555; letter-spacing: 1px; }
        </style>
    </head>
    <body>
        <div class="ticker">
            <div style="font-size: 0.6rem; color: #555; text-transform: uppercase; letter-spacing: 2px;">Total Pipeline Equity</div>
            <div class="totalizer">$${totalEquity.toLocaleString()}</div>
        </div>
        ${cards}
    </body>
    </html>`);
});

app.listen(PORT, () => console.log('Juggernaut Online'));
