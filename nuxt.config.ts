export default defineNuxtConfig({
  nitro: {
    preset: 'node-server',
    serveStatic: true,
    storage: {
      cache: {
        driver: 'memory',
      },
    },
  },
  
  runtimeConfig: {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    
    public: {
      supabaseUrl: process.env.VITE_SUPABASE_URL || '',
      supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || '',
    },
  },

  modules: [
    '@nuxtjs/tailwindcss',
  ],

  typescript: {
    strict: true,
  },

  ssr: true,
  
  devServer: {
    port: parseInt(process.env.PORT || '3000'),
  },
});