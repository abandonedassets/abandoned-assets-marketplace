/**
 * Stripe Checkout Routes
 *
 * Existing product checkout remains disabled unless its Stripe price IDs are configured.
 * Assignment checkout uses STRIPE_SECRET_KEY plus the execution-venue database tables.
 */

const express = require('express');
const router = express.Router();

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const COMPLIANCE_PRICE_ID = process.env.STRIPE_COMPLIANCE_PRICE_ID;
const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID;
const ASSIGNMENT_FEE_CENTS = Number(process.env.ASSIGNMENT_FEE_CENTS || 100);
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;

const stripeReady = Boolean(STRIPE_KEY);
const productCheckoutReady = Boolean(STRIPE_KEY && COMPLIANCE_PRICE_ID && PRO_PRICE_ID);
const stripe = stripeReady ? require('stripe')(STRIPE_KEY) : null;

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.get('host')}`;
}

// ── Compliance Kit ($5 one-time) ──────────────────────────────────────────
router.get('/compliance-kit', async (req, res) => {
  if (!productCheckoutReady) {
    return res.redirect('/compliance-kit.html?msg=checkout_coming_soon');
  }
  try {
    const base = getBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: COMPLIANCE_PRICE_ID, quantity: 1 }],
      success_url: `${base}/purchase-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/compliance-kit.html`,
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
  if (!productCheckoutReady) {
    return res.redirect('/pricing.html?msg=checkout_coming_soon');
  }
  try {
    const base = getBaseUrl(req);
    const coupon = req.query.coupon || null;
    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
      success_url: `${base}/buyer/listings?upgraded=true`,
      cancel_url: `${base}/pricing`,
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

// ── Assignment checkout: first-lock-wins execution venue ──────────────────
router.post('/assignment/:propertyId', async (req, res) => {
  if (!req.session.userId || req.session.userRole !== 'buyer') {
    return res.status(403).json({ error: 'Buyer only' });
  }
  if (!stripeReady) {
    return res.status(503).json({ error: 'Stripe is not configured' });
  }

  const db = req.app.get('db');
  const buyerId = req.session.userId;
  const propertyId = Number(req.params.propertyId);

  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    return res.status(400).json({ error: 'Invalid property id' });
  }

  const base = PUBLIC_BASE_URL || getBaseUrl(req);
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const property = await client.query(
      `SELECT id, seller_id, address, city, state, price, status
       FROM properties
       WHERE id = $1 AND status = 'active'
       FOR UPDATE`,
      [propertyId]
    );

    if (property.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Property is not available' });
    }

    const lock = await client.query(
      `INSERT INTO deal_locks (property_id, buyer_id, status, amount_cents, currency, expires_at)
       SELECT $1, $2, 'locked', $3, 'usd', NOW() + INTERVAL '30 minutes'
       WHERE NOT EXISTS (
         SELECT 1 FROM deal_locks WHERE property_id = $1 AND status = 'locked'
       )
       RETURNING id`,
      [propertyId, buyerId, ASSIGNMENT_FEE_CENTS]
    );

    if (lock.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Property is already locked' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Assignment fee: ${property.rows[0].address || 'Property'}` },
          unit_amount: ASSIGNMENT_FEE_CENTS
        },
        quantity: 1
      }],
      success_url: `${base}/purchase-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/buyer-listings.html?execution_cancelled=1`,
      metadata: {
        product: 'assignment_fee',
        property_id: String(propertyId),
        buyer_id: String(buyerId),
        deal_lock_id: String(lock.rows[0].id)
      }
    });

    await client.query(
      `UPDATE deal_locks
       SET stripe_session_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [session.id, lock.rows[0].id]
    );

    await client.query('COMMIT');
    return res.json({ success: true, checkout_url: session.url, session_id: session.id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Assignment checkout error:', err);
    return res.status(500).json({ error: 'Failed to start assignment checkout' });
  } finally {
    client.release();
  }
});

// ── Stripe webhook: payment confirmation and lock release ─────────────────
router.post('/', async (req, res) => {
  if (!stripeReady || !STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Stripe webhook is not configured' });
  }

  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const session = event.data.object;
  const metadata = session.metadata || {};

  if (metadata.product !== 'assignment_fee') {
    return res.json({ received: true, ignored: true });
  }

  const propertyId = Number(metadata.property_id);
  const buyerId = Number(metadata.buyer_id);
  const lockId = Number(metadata.deal_lock_id);

  if (!Number.isInteger(propertyId) || !Number.isInteger(buyerId) || !Number.isInteger(lockId)) {
    return res.status(400).json({ error: 'Invalid webhook metadata' });
  }

  const db = req.app.get('db');
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    if (event.type === 'checkout.session.completed') {
      const paid = await client.query(
        `UPDATE deal_locks
         SET status = 'paid', paid_at = NOW(), updated_at = NOW()
         WHERE id = $1
           AND property_id = $2
           AND buyer_id = $3
           AND stripe_session_id = $4
           AND status = 'locked'
         RETURNING id`,
        [lockId, propertyId, buyerId, session.id]
      );

      if (paid.rows.length > 0) {
        await client.query(
          `UPDATE properties
           SET status = 'assigned_funded', assigned_buyer_id = $1, assigned_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          [buyerId, propertyId]
        );

        await client.query(
          `INSERT INTO deals (property_id, buyer_id, seller_id, status)
           SELECT id, $1, seller_id, 'assigned_funded'
           FROM properties
           WHERE id = $2
             AND NOT EXISTS (
               SELECT 1 FROM deals
               WHERE property_id = $2 AND buyer_id = $1 AND status = 'assigned_funded'
             )`,
          [buyerId, propertyId]
        );
      }
    } else if (event.type === 'checkout.session.expired') {
      await client.query(
        `UPDATE deal_locks
         SET status = 'expired', released_at = NOW(), updated_at = NOW()
         WHERE id = $1
           AND property_id = $2
           AND buyer_id = $3
           AND stripe_session_id = $4
           AND status = 'locked'`,
        [lockId, propertyId, buyerId, session.id]
      );
    }

    await client.query('COMMIT');
    return res.json({ received: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Stripe webhook database error:', err);
    return res.status(500).json({ error: 'Webhook database failure' });
  } finally {
    client.release();
  }
});

module.exports = router;
