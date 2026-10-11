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
    },
    '/api/public/hooks/mercury-webhook': {
      cors: true,
      headers: { 'Content-Type': 'application/json' }
    },
    '/api/public/b2b-intake-page': {
      cors: true,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      }
    },
    '/api/private/b2b-intake': {
      cors: false,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
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
