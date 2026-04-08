const express = require('express');
const router = express.Router();

// POST /api/interests – buyer expresses interest
router.post('/interests', async (req, res) => {
  if (!req.session.userId || req.session.userRole !== 'buyer') {
    return res.status(403).json({ error: 'Only buyers can express interest' });
  }
  const { propertyId } = req.body;
  const db = req.app.get('db');
  try {
    await db.query(
      'INSERT INTO interests (property_id, buyer_id, status) VALUES ($1, $2, $3)',
      [propertyId, req.session.userId, 'pending']
    );
    res.status(201).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/my-interests – buyer's own interests
router.get('/my-interests', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const db = req.app.get('db');
  try {
    const result = await db.query(
      `SELECT i.*, p.address, p.city, p.state, p.price 
       FROM interests i 
       JOIN properties p ON i.property_id = p.id 
       WHERE i.buyer_id = $1`,
      [req.session.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
