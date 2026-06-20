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
  const db = req.app.get('db');
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 1. Select 1 valid property (active, not in a deal, no active lock)
    const propertyResult = await client.query(`
      SELECT p.* FROM properties p
      LEFT JOIN deals d ON p.id = d.property_id
      LEFT JOIN deal_locks dl ON p.id = dl.property_id AND dl.expires_at > NOW()
      WHERE p.status = 'active' AND d.id IS NULL AND dl.id IS NULL
      LIMIT 1
      FOR UPDATE
    `);

    if (propertyResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No available properties.' });
    }

    const property = propertyResult.rows[0];

    // 2. Match >=3 buyers
    const buyersResult = await client.query(`
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
    const lockExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // 3. CREATE LOCK + DEAL ATOMICALLY
    for (const buyer of buyers) {
      try {
        // Attempt to lock property for this buyer
        await client.query(`
          INSERT INTO deal_locks (property_id, buyer_id, expires_at)
          VALUES ($1, $2, $3)
        `, [property.id, buyer.id, lockExpiry]);

        // If lock succeeds, create deal
        await client.query(`
          INSERT INTO deals (property_id, buyer_id, seller_id, status)
          VALUES ($1, $2, $3, $4)
        `, [property.id, buyer.id, property.seller_id, 'sent']);

      } catch (lockErr) {
        if (lockErr.code === '23505') { // UNIQUE constraint: lock already exists
          console.log(`Property already locked by another buyer`);
        } else {
          throw lockErr;
        }
      }
    }

    // 4. Send notification
    let emailStatus = 'skipped';
    if (resend) {
      try {
        const { error } = await resend.emails.send({
          from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
          to: process.env.ADMIN_EMAIL || 'info@abandonedassets.com',
          subject: `Deal Executed (First-Lock-Wins): ${property.address}`,
          html: `
            <h1>Deal Execution Successful</h1>
            <p><strong>Property:</strong> ${property.address}, ${property.city}</p>
            <p><strong>Deal ID:</strong> ${dealId}</p>
            <p><strong>Buyers Contacted:</strong> ${buyers.length}</p>
            <ul>${buyers.map(b => `<li>${b.name} (${b.email})</li>`).join('')}</ul>
          `
        });
        if (!error) emailStatus = 'sent';
      } catch (e) {
        console.error('Resend error:', e);
        emailStatus = 'failed';
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      dealId,
      buyersContacted: buyers.length,
      emailStatus,
      property: property.address
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Execution Cycle Error:', err);
    res.status(500).json({ error: 'Internal server error during execution cycle.' });
  } finally {
    client.release();
  }
});

module.exports = router;
