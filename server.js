const express = require('express');

const path = require('path');

const app = express();



const publicPath = path.resolve(__dirname, 'public');

app.use(express.static(publicPath));



// Redirect all traffic to the terminal view

app.get('*', (req, res) => {
    
    res.sendFile(path.join(publicPath, 'index.html'));
    
});



const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => console.log(`Juggernaut Engine Active on port ${PORT}`));





