const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// The Hardened Asset Dataset
const assets = [
    { name: "Aurora Commercial Pad", id: "#77291", state: "SETTLEMENT_READY", val: 125000, b: 1, s: 1, a: 1, color: "#0f0" },
    { name: "Courtyard Cir.", id: "#99120", state: "ESCROW_VELOCITY", val: 45000, b: 1, s: 0, a: 1, color: "#00ffff" },
    { name: "Institutional Portfolio X", id: "#44102", state: "BUYER_MATCHED", val: 85000, b: 1, s: 1, a: 0, color: "#00ffff" },
    { name: "Lakeside Industrial Hub", id: "#11204", state: "CONTRACT_EXECUTED", val: 250000, b: 1, s: 1, a: 1, color: "#00ffff" },
    { name: "Sunset Ridge Estates", id: "#88321", state: "ACQUISITION", val: 150000, b: 0, s: 1, a: 0, color: "#bf00ff" }
];

app.get(['/', '/settlement.html'], (req, res) => {
    const totalLiquidity = assets.reduce((sum, a) => sum + a.val, 0).toLocaleString();
    
    const cards = assets.map(a => `
        <div class="card" style="border-left: 4px solid ${a.color}">
            <div class="header">
                <span class="name">${a.name}</span>
                <span class="state">${a.state}</span>
            </div>
            <div class="val">+$${a.val.toLocaleString()}</div>
            <div class="footer">
                <div class="sigs">
                    <span class="${a.b ? 'active' : ''}">B</span>
                    <span class="${a.s ? 'active' : ''}">S</span>
                    <span class="${a.a ? 'active' : ''}">A</span>
                </div>
                <div class="id">${a.id}</div>
            </div>
        </div>
    `).join('');

    res.send(`<!DOCTYPE html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { background: #000; color: #fff; font-family: 'Courier New', monospace; margin: 0; padding: 10px; width: 100vw; overflow-x: hidden; box-sizing: border-box; }
            .total { color: #ffd700; font-size: 1.5rem; text-align: center; margin-bottom: 20px; font-weight: bold; }
            .card { background: #111; padding: 15px; margin-bottom: 12px; border-radius: 8px; width: 100%; box-sizing: border-box; }
            .header { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 8px; align-items: flex-start; gap: 5px; }
            .name { color: #00ffff; font-weight: bold; }
            .state { font-size: 0.6rem; background: #222; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
            .val { font-size: 1.8rem; color: #0f0; margin-bottom: 10px; font-weight: bold; }
            .footer { display: flex; justify-content: space-between; align-items: center; }
            .sigs { display: flex; gap: 6px; }
            .sigs span { border: 1px solid #333; padding: 2px 6px; border-radius: 50%; color: #333; font-size: 0.7rem; font-weight: bold; }
            .sigs .active { border-color: #0f0; color: #0f0; box-shadow: 0 0 5px #0f0; }
            .id { font-size: 0.7rem; color: #666; }
        </style></head><body>
            <div class="total">TOTAL LIQUIDITY VOLUME<br>$${totalLiquidity}</div>
            ${cards}
        </body></html>`);
});

app.listen(PORT, () => console.log('Juggernaut Locked'));
