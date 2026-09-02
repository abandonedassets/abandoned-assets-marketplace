/**
 * Health Check Endpoint
 * GET /api/public/health
 * 
 * Lightweight, zero-dependency health check for load balancers and monitoring.
 * Returns 200 OK with status confirmation.
 */

export default defineEventHandler(async (event) => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
  };
});