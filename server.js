const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// --- 🌊 JUGGERNAUT INTAKE DETECTED ---
app.post('/webhook/deal-intake', (req, res) => {
    console.log('--- 🌊 JUGGERNAUT INTAKE DETECTED ---');
    console.log('Telemetry Data:', JSON.stringify(req.body, null, 2));
    res.status(200).send('Intake received');
});

// Serve static files from the 'dist' directory
app.use(express.static(path.join(__dirname, 'dist')));

// Handle all other routes by serving the index.html file
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server successfully started on port ${PORT}`);
  console.log('Juggernaut Engine Online');
});
