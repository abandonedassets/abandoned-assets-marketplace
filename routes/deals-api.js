const express = require('express');
const router = express.Router();
const { Resend } = require('resend');

// Initialize Resend if API key is present
let resend = null;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
}

// POST /api/v1/deals/execute-cycle
router.post('/v1/deals/execute-cycle', async (req, res) => {
  if (!req.session.userId || req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const db = req.app.get('db');

  try {
    const propertyResult = await db.query(`
      SELECT p.* FROM properties p
      LEFT JOIN deals d ON p.id = d.property_id
      WHERE p.status = 'active' AND d.id IS NULL
      LIMIT 1
    `);

    if (propertyResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active properties available for execution.' });
    }

    const property = propertyResult.rows[0];

    const buyersResult = await db.query(`
      SELECT id, email, name FROM users
      WHERE role = 'buyer'
      ORDER BY RANDOM()
      LIMIT 3
    `);

    if (buyersResult.rows.length < 3) {
      console.warn('Fewer than 3 buyers found.');
    }

    const buyers = buyersResult.rows;
    const dealId = `DEAL-${Date.now()}-${property.id}`;

    for (const buyer of buyers) {
      await db.query(`
        INSERT INTO deals (property_id, buyer_id, seller_id, status)
        VALUES ($1, $2, $3, $4)
      `, [property.id, buyer.id, property.seller_id, 'sent']);
    }

    let emailStatus = 'skipped';
    if (resend) {
      try {
        const { error } = await resend.emails.send({
          from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
          to: process.env.ADMIN_EMAIL || 'info@abandonedassets.com',
          subject: `New Deal Executed: ${property.address}`,
          html: `
            <h1>Deal Execution Successful</h1>
            <p><strong>Property:</strong> ${property.address}, ${property.city}</p>
            <p><strong>Deal ID:</strong> ${dealId}</p>
            <p><strong>Buyers Contacted:</strong> ${buyers.length}</p>
            <ul>
              ${buyers.map(b => `<li>${b.name} (${b.email})</li>`).join('')}
            </ul>
          `
        });
        if (!error) emailStatus = 'sent';
      } catch (e) {
        console.error('Resend error:', e);
        emailStatus = 'failed';
      }
    }

    const smsStatus = 'skipped (no twilio)';

    res.json({
      success: true,
      dealId: dealId,
      buyersContacted: buyers.length,
      sendStatus: `Email: ${emailStatus}, SMS: ${smsStatus}`,
      property: property.address
    });
  } catch (err) {
    console.error('Execution Cycle Error:', err);
    res.status(500).json({ error: 'Internal server error during execution cycle.' });
  }
});

// GET /api/v1/deals/locks/mine
router.get('/v1/deals/locks/mine', async (req, res) => {
  if (!req.session.userId || req.session.userRole !== 'buyer') {
    return res.status(403).json({ error: 'Buyer only' });
  }

  const db = req.app.get('db');

  try {
    const result = await db.query(
      `SELECT dl.id, dl.property_id, dl.status, dl.expires_at, dl.paid_at,
              p.address, p.city, p.state, p.price
       FROM deal_locks dl
       JOIN properties p ON p.id = dl.property_id
       WHERE dl.buyer_id = $1
       ORDER BY dl.created_at DESC
       LIMIT 25`,
      [req.session.userId]
    );

    res.json({ success: true, locks: result.rows });
  } catch (err) {
    console.error('Lock list error:', err);
    res.status(500).json({ error: 'Failed to load deal locks' });
  }
});

module.exports = router;
