const express = require('express');
const router = express.Router();

// POST /api/properties – create new property (seller)
router.post('/properties', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const { address, city, state, zip, price, property_type } = req.body;
  const db = req.app.get('db');
  try {
    const result = await db.query(
      `INSERT INTO properties (seller_id, address, city, state, zip, price, property_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING id`,
      [req.session.userId, address, city, state, zip, price, property_type || 'house']
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/properties – get all active properties (with blurring logic)
router.get('/properties', async (req, res) => {
  const db = req.app.get('db');
  const { sellerId } = req.query;
  let query = 'SELECT * FROM properties WHERE status = $1';
  const params = ['active'];
  if (sellerId) {
    query += ' AND seller_id = $2';
    params.push(sellerId);
  }
  try {
    let result = await db.query(query, params);
    let properties = result.rows;

    // Blurring logic for unauthenticated or non‑buyer roles
    const isBuyer = req.session.userId && req.session.userRole === 'buyer';
    if (!isBuyer) {
      properties = properties.map(p => ({
        ...p,
        address_blurred: true,
        address: `${p.address.split(' ')[0]} **** ${p.address.split(' ').slice(2).join(' ')}` // simple blur
      }));
    } else {
      // One free teaser: first property gets full address, others blurred
      properties = properties.map((p, idx) => ({
        ...p,
        address_blurred: idx !== 0,
        address: idx === 0 ? p.address : `${p.address.split(' ')[0]} **** ${p.address.split(' ').slice(2).join(' ')}`
      }));
    }
    res.json(properties);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
