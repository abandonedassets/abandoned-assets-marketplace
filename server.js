const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to serve all assets in the database
app.get('/api/assets', (req, res) => {
    // Replace this with your actual database call (e.g., Supabase)
    const mockData = [
        { id: "ASSET-77291", name: "Aurora Commercial Pad", state: "SETTLEMENT_READY", b: 1, s: 1, a: 1, val: 125000 },
        { id: "ASSET-99120", name: "Courtyard Cir.", state: "ESCROW_VELOCITY", b: 1, s: 0, a: 1, val: 45000 },
        { id: "ASSET-44102", name: "Institutional Portfolio X", state: "BUYER_MATCHED", b: 1, s: 1, a: 0, val: 85000 }
    ];
    res.json(mockData);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'settlement.html'));
});

app.get('/settlement.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'settlement.html'));
});

app.listen(PORT, () => console.log('Juggernaut Online'));
