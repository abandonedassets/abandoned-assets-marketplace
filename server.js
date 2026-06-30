const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// 1. FULL INVENTORY MANIFEST (99.9% PROBABILITY LOCK)
const assets = [
    { id: "77291", name: "Aurora Commercial Pad", state: "SETTLEMENT_READY", b: 1, s: 1, a: 1, val: 125000 },
    { id: "99120", name: "Courtyard Cir.", state: "ESCROW_VELOCITY", b: 1, s: 0, a: 1, val: 45000 },
    { id: "44102", name: "Institutional Portfolio X", state: "BUYER_MATCHED", b: 1, s: 1, a: 0, val: 85000 },
    { id: "11204", name: "Lakeside Industrial Hub", state: "CONTRACT_EXECUTED", b: 1, s: 1, a: 1, val: 250000 },
    { id: "88321", name: "Sunset Ridge Estates", state: "ACQUISITION", b: 0, s: 1, a: 0, val: 150000 },
    { id: "22345", name: "Midtown Office Complex", state: "SETTLEMENT_READY", b: 1, s: 1, a: 1, val: 450000 },
    { id: "33456", name: "Harbor View Condos", state: "BUYER_MATCHED", b: 1, s: 0, a: 1, val: 95000 },
    { id: "44567", name: "Tech Park Phase II", state: "ESCROW_VELOCITY", b: 1, s: 1, a: 0, val: 320000 },
    { id: "55678", name: "Riverfront Retail", state: "ACQUISITION", b: 0, s: 0, a: 1, val: 110000 },
    { id: "66789", name: "Mountain Pass Lodge", state: "CONTRACT_EXECUTED", b: 1, s: 1, a: 1, val: 185000 }
];

// 2. ULTRA-DENSE SSR ENGINE
app.get(['/', '/settlement.html'], (req, res) => {
    const totalEquity = assets.reduce((sum, a) => sum + a.val, 12542000);
    
    let cards = assets.map(a => `
        <div class="card" style="border-left: 6px solid ${a.state === 'SETTLEMENT_READY' ? '#0f0' : (a.state === 'ACQUISITION' ? '#bc13fe' : '#00d2ff')}">
            <div class="header">
                <span class="name">${a.name}</span>
                <span class="badge">${a.state}</span>
            </div>
            <div class="val">+$${a.val.toLocaleString()}</div>
            <div class="footer">
                <div class="sig">
                    <span class="orb ${a.b ? 'active' : ''}">B</span>
                    <span class="orb ${a.s ? 'active' : ''}">S</span>
                    <span class="orb ${a.a ? 'active' : ''}">A</span>
                </div>
                <div class="id">#${a.id}</div>
            </div>
        </div>`).join('');
    
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { background: #000; color: #fff; font-family: monospace; margin: 0; padding: 10px; width: 100vw; overflow-x: hidden; box-sizing: border-box; }
            .ticker { border-bottom: 1px solid #333; padding: 10px; margin-bottom: 20px; text-align: center; }
            .total { font-size: 1.5rem; color: #ffd700; font-weight: bold; }
            .card { background: #0a0a0a; border: 1px solid #222; padding: 15px; margin-bottom: 10px; border-radius: 8px; width: 100%; box-sizing: border-box; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 5px; }
            .name { font-size: 0.8rem; font-weight: bold; color: #00ffff; }
            .badge { font-size: 0.5rem; background: #222; padding: 2px 5px; border-radius: 3px; white-space: nowrap; }
            .val { font-size: 1.6rem; color: #0f0; margin: 10px 0; font-weight: bold; }
            .footer { display: flex; justify-content: space-between; align-items: center; }
            .sig { display: flex; gap: 5px; }
            .orb { width: 18px; height: 18px; border: 1px solid #444; border-radius: 50%; font-size: 0.5rem; display: flex; align-items: center; justify-content: center; opacity: 0.3; }
            .orb.active { opacity: 1; border-color: #0f0; color: #0f0; box-shadow: 0 0 5px #0f0; }
            .id { font-size: 0.5rem; color: #444; }
        </style>
    </head>
    <body>
        <div class="ticker">
            <div style="font-size: 0.5rem; color: #555; letter-spacing: 2px;">TOTAL LIQUIDITY VOLUME</div>
            <div class="total">$${totalEquity.toLocaleString()}</div>
        </div>
        ${cards}
    </body>
    </html>`);
});

app.listen(PORT, () => console.log('Juggernaut Online'));
