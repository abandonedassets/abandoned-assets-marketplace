import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// Serve built static assets from the dist/client directory (TanStack Start output)
app.use(express.static(path.join(__dirname, 'dist', 'client')));

// SPA Catch-All: Route all incoming requests to dist/client/index.html to allow client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'client', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
