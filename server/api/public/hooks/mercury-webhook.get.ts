/**
 * Non-mutating health probe for the Mercury webhook relay.
 * This confirms only that the route is reachable, not that funds settled.
 */
export default defineEventHandler(() => ({
  ok: true,
  service: 'mercury-webhook-relay',
  forwardsTo: 'supabase-listener',
}));
