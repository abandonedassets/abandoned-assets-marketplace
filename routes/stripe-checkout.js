/**
 * Stripe Checkout Routes
 * 
 * HOW TO GO LIVE:
 * 1. Create products in Stripe Dashboard (https://dashboard.stripe.com/products)
 *    - "Compliance Kit" → $5 one-time → copy Price ID
 *    - "Pro Subscription" → $49/mo recurring → copy Price ID
 * 2. Set these environment variables on Render:
 *    STRIPE_SECRET_KEY=sk_live_...
 *    STRIPE_COMPLIANCE_PRICE_ID=price_...
 *    STRIPE_PRO_PRICE_ID=price_...
 * 3. Redeploy — checkout will be fully live.
 *
 * Until then, the /checkout/* routes redirect to the pricing page
 * with a "coming soon" message so the UI still works.
 */

const express = require('express');
const router  = express.Router();

const STRIPE_KEY          = process.env.STRIPE_SECRET_KEY;
const COMPLIANCE_PRICE_ID = process.env.STRIPE_COMPLIANCE_PRICE_ID;
const PRO_PRICE_ID        = process.env.STRIPE_PRO_PRICE_ID;

const stripeReady = STRIPE_KEY && COMPLIANCE_PRICE_ID && PRO_PRICE_ID;
let stripe;
if (stripeReady) {
  stripe = require('stripe')(STRIPE_KEY);
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.get('host')}`;
}

// ── Compliance Kit ($5 one-time) ──────────────────────────────────────────
router.get('/compliance-kit', async (req, res) => {
  if (!stripeReady) {
    return res.redirect('/compliance-kit.html?msg=checkout_coming_soon');
  }
  try {
    const base = getBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: COMPLIANCE_PRICE_ID, quantity: 1 }],
      success_url: `${base}/purchase-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${base}/compliance-kit.html`,
      metadata: { product: 'compliance_kit' }
    });
    res.redirect(303, session.url);
  } catch (err) {
    console.error('Stripe compliance-kit error:', err.message);
    res.redirect('/pricing?error=checkout_failed');
  }
});

// ── Pro Subscription ($49/mo recurring) ──────────────────────────────────
router.get('/pro', async (req, res) => {
  if (!stripeReady) {
    return res.redirect('/pricing.html?msg=checkout_coming_soon');
  }
  try {
    const base   = getBaseUrl(req);
    const coupon = req.query.coupon || null;
    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
      success_url: `${base}/buyer/listings?upgraded=true`,
      cancel_url:  `${base}/pricing`,
      metadata: { product: 'pro_subscription' }
    };
    if (coupon) sessionParams.discounts = [{ coupon }];
    const session = await stripe.checkout.sessions.create(sessionParams);
    res.redirect(303, session.url);
  } catch (err) {
    console.error('Stripe pro error:', err.message);
    res.redirect('/pricing?error=checkout_failed');
  }
});

// ── /api/me — used by purchase-success page ───────────────────────────────
// (Registered in server.js; this is just a note)

module.exports = router;
