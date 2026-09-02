import { defineNitroConfig } from 'nitropack/config';

export default defineNitroConfig({
  // 1. FORCE THE PATH MAPPING TO BYPASS ROUTING COLLISIONS
  routeRules: {
    '/api/public/health': { 
      cors: true,
      headers: { 'X-Engine': 'NITRO_APEX_M2M_CORE' }
    },
    '/api/public/hooks/stripe-settlement': { 
      cors: true,
      methods: ['POST']
    }
  },

  // 2. HARD PORT AND HOST BINDING NATIVE TO THE COMPILATION
  devServer: {
    host: '0.0.0.0',
    port: 10000
  },

  // 3. ENSURE SERVER VARIABLES ROUTE NATIVELY WITHOUT STRUCTURAL DROPS
  runtimeConfig: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET
  },

  // 4. PRODUCTION HARDENING
  preset: 'node-server',
  serveStatic: true,
  noAnalyze: true,
});
