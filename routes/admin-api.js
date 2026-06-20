const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { sendDealReadyEmail } = require('../mailer');

const isAuthenticated = (req, res, next) => {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
};

const isAdmin = (req, res, next) => {
  if (req.session.userId && req.user && req.user.role === 'admin') return next();
  res.status(403).json({ error: 'Admin role required' });
};

// GET /api/admin/stats — simple metrics
router.get('/admin/stats', isAuthenticated, isAdmin, async (req, res) => {
  const db = req.app.get('db');

  try {
    const properties = await db.query('SELECT COUNT(*) as count FROM properties');
    const buyers = await db.query('SELECT COUNT(*) as count FROM users WHERE role = \'buyer\'');
    const deals = await db.query('SELECT COUNT(*) as count FROM deals');

    res.json({
      totalProperties: parseInt(properties.rows[0].count),
      totalBuyers: parseInt(buyers.rows[0].count),
      totalDeals: parseInt(deals.rows[0].count)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Stats retrieval failed' });
  }
});

// POST /api/admin/approve-interest/:interestId
router.post('/admin/approve-interest/:interestId', isAuthenticated, isAdmin, async (req, res) => {
  const interestId = req.params.interestId;
  const db = req.app.get('db');
  try {
    await db.query('UPDATE interests SET status = $1 WHERE id = $2', ['approved', interestId]);

    const interest = await db.query(
      `SELECT i.property_id, i.buyer_id, p.seller_id, p.address, p.city, p.state, p.price, u_buyer.email as buyer_email, u_seller.email as seller_email
       FROM interests i
       JOIN properties p ON i.property_id = p.id
       JOIN users u_buyer ON i.buyer_id = u_buyer.id
       JOIN users u_seller ON p.seller_id = u_seller.id
       WHERE i.id = $1`,
      [interestId]
    );
    if (interest.rows.length === 0) throw new Error('Interest not found');

    const deal = interest.rows[0];
    await db.query(
      `INSERT INTO deals (property_id, buyer_id, seller_id, status)
       VALUES ($1, $2, $3, $4)`,
      [deal.property_id, deal.buyer_id, deal.seller_id, 'ready_for_closing']
    );

    await sendDealReadyEmail(deal, deal.buyer_email, deal.seller_email);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to approve interest' });
  }
});

// POST /api/admin/broadcast-algorithms/:propertyId
router.post('/admin/broadcast-algorithms/:propertyId', isAuthenticated, isAdmin, async (req, res) => {
  const endpoints = (process.env.ALGORITHM_WEBHOOK_URLS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

  if (endpoints.length === 0) {
    return res.status(400).json({ error: 'No algorithm webhook URLs configured' });
  }

  const db = req.app.get('db');
  const propertyId = Number(req.params.propertyId);

  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    return res.status(400).json({ error: 'Invalid property id' });
  }

  try {
    const property = await db.query(
      `SELECT id, address, city, state, price, property_type, status
       FROM properties
       WHERE id = $1`,
      [propertyId]
    );

    if (property.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const payload = {
      event: 'property.market_ready',
      property: property.rows[0],
      sent_at: new Date().toISOString()
    };
    const body = JSON.stringify(payload);
    const secret = process.env.ALGORITHM_WEBHOOK_SECRET || '';
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const payloadHash = crypto.createHash('sha256').update(body).digest('hex');

    const results = [];
    for (const url of endpoints) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      let status = null;
      let text = '';
      let success = false;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-algorithm-signature': signature
          },
          body,
          signal: controller.signal
        });
        status = response.status;
        text = (await response.text()).slice(0, 1000);
        success = response.ok;
      } catch (err) {
        text = err.message;
      } finally {
        clearTimeout(timeout);
      }

      await db.query(
        `INSERT INTO algorithm_broadcast_log
         (property_id, endpoint_url, payload_hash, http_status, response_body, success )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [propertyId, url, payloadHash, status, text, success]
      );

      results.push({ url, status, success });
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error('Algorithm broadcast error:', err);
    res.status(500).json({ error: 'Broadcast failed' });
  }
});

module.exports = router;
