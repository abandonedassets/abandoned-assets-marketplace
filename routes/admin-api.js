const express = require('express');
const router = express.Router();
const { sendDealReadyEmail } = require('../mailer');

// POST /api/admin/approve-seller/:propertyId
router.post('/admin/approve-seller/:propertyId', async (req, res) => {
  if (!req.session.userId || req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const propertyId = req.params.propertyId;
  const db = req.app.get('db');
  try {
    await db.query('UPDATE properties SET status = $1 WHERE id = $2', ['active', propertyId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/admin/approve-interest/:interestId
router.post('/admin/approve-interest/:interestId', async (req, res) => {
  if (!req.session.userId || req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const interestId = req.params.interestId;
  const db = req.app.get('db');
  try {
    // Update interest status
    await db.query('UPDATE interests SET status = $1 WHERE id = $2', ['approved', interestId]);

    // Get property and buyer details
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
    // Create deal record
    await db.query(
      `INSERT INTO deals (property_id, buyer_id, seller_id, status)
       VALUES ($1, $2, $3, $4)`,
      [deal.property_id, deal.buyer_id, deal.seller_id, 'ready_for_closing']
    );

    // Send email alert
    await sendDealReadyEmail(deal, deal.buyer_email, deal.seller_email);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
