import { defineNitroConfig } from 'nitropack/config';

export default defineNitroConfig({
  // 1. FORCE THE PATH MAPPING TO BYPASS STATIC FILE SERVING
  routes: {
    '/api/public/health': { 
      cors: true,
      headers: { 'Content-Type': 'application/json' }
    },
    '/api/public/hooks/stripe-settlement': { 
      cors: true,
      headers: { 'Content-Type': 'application/json' }
    }
  },

  // 2. DISABLE STATIC CLIENT COMPILATION LOOKUPS
  serveStatic: false,

  // 3. SECURE CONTAINER RUNTIME SETTINGS
  devServer: {
    host: '0.0.0.0',
    port: 10000
  },

  // 4. RUNTIME CONFIG FOR SECRETS
  runtimeConfig: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET
  },

  // 5. PRODUCTION HARDENING
  preset: 'node-server',
  noAnalyze: true,
});
