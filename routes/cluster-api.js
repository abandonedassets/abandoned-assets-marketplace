const express = require('express');
const router = express.Router();

// GET /api/clusters – list clusters with premium gate
router.get('/clusters', async (req, res) => {
  const db = req.app.get('db');
  try {
    const result = await db.query('SELECT * FROM clusters WHERE status = $1', ['active']);
    let clusters = result.rows;
    // Premium gate: show limited info unless user has premium flag (for MVP, we just show blurred)
    const isPremium = req.session.userId && (req.session.userRole === 'admin' || req.session.userPremium); // placeholder
    if (!isPremium) {
      clusters = clusters.map(c => ({
        ...c,
        total_price: '*****',
        description: 'Upgrade to Builder Pro to view price and details.'
      }));
    }
    res.json(clusters);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
