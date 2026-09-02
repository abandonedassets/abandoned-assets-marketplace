import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Include your existing plugins (e.g., VitePWA) here as needed
  ],
  ...(process.env.RENDER === 'true' || process.env.NITRO_PRESET === 'node-server' ? { nitro: { preset: 'node-server' } } : {}),
}));
