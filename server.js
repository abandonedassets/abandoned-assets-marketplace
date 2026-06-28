const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the 'dist' directory (where your frontend is built)
app.use(express.static(path.join(__dirname, 'dist')));

// Handle all other routes by serving the index.html file
// This allows React Router to handle client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server successfully started on port ${PORT}`);
});
