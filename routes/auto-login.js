const express = require('express');
const router = express.Router();

router.get('/auto-login', async (req, res) => {
  const { email, name, state } = req.query;
  if (!email) return res.status(400).send('Missing email');

  const db = req.app.get('db');
  try {
    let user = await db.query('SELECT id, role FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) {
      const randomPassword = Math.random().toString(36).slice(-16);
      const insertResult = await db.query(
        'INSERT INTO users (email, name, preferred_state, role, password) VALUES ($1, $2, $3, $4, $5) RETURNING id, role',
        [email, name || email.split('@')[0], state || 'OH', 'buyer', randomPassword]
      );
      user = insertResult;
    }
    req.session.userId = user.rows[0].id;
    req.session.userRole = user.rows[0].role;

    // Redirect based on role
    if (user.rows[0].role === 'admin') return res.redirect('/admin/dashboard');
    if (user.rows[0].role === 'seller') return res.redirect('/seller/dashboard');
    return res.redirect('/buyer/listings');
  } catch (err) {
    console.error(err);
    res.status(500).send('Auto-login failed');
  }
});

module.exports = router;
