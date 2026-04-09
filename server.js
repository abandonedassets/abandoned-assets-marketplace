require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.set('db', pool);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Make user data available in templates (optional)
app.use(async (req, res, next) => {
  if (req.session.userId) {
    try {
      const result = await pool.query('SELECT id, email, name, role FROM users WHERE id = $1', [req.session.userId]);
      req.user = result.rows[0];
    } catch (err) {
      console.error(err);
    }
  }
  next();
});

// Import route modules
const autoLoginRouter = require('./routes/auto-login');
const propertyApiRouter = require('./routes/property-api');
const interestsApiRouter = require('./routes/interests-api');
const adminApiRouter = require('./routes/admin-api');
const clusterApiRouter = require('./routes/cluster-api');

// Register API routes
app.use('/auth', autoLoginRouter);
app.use('/api', propertyApiRouter);
app.use('/api', interestsApiRouter);
app.use('/api', adminApiRouter);
app.use('/api', clusterApiRouter);

// HTML pages (simple static routes with role checks)
const isAuthenticated = (req, res, next) => {
  if (req.session.userId) return next();
  res.redirect('/login.html');
};

const isAdmin = (req, res, next) => {
  if (req.session.userId && req.user && req.user.role === 'admin') return next();
  res.status(403).send('Forbidden');
};

const isSeller = (req, res, next) => {
  if (req.session.userId && req.user && req.user.role === 'seller') return next();
  res.status(403).send('Forbidden');
};

const isBuyer = (req, res, next) => {
  if (req.session.userId && req.user && req.user.role === 'buyer') return next();
  res.status(403).send('Forbidden');
};

app.get('/seller/dashboard', isAuthenticated, isSeller, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'seller-dashboard.html'));
});
app.get('/buyer/listings', isAuthenticated, isBuyer, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'buyer-listings.html'));
});
app.get('/buyer/dashboard', isAuthenticated, isBuyer, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'buyer-dashboard.html'));
});
app.get('/admin/dashboard', isAuthenticated, isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});
app.get('/clusters', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'clusters.html'));
});

// Simple login page (for manual login if needed)
app.get('/login.html', (req, res) => {
  res.send(`
    <h2>Login</h2>
    <form method="post" action="/login">
      <input name="email" placeholder="Email" required /><br/>
      <input name="password" type="password" placeholder="Password" required /><br/>
      <button type="submit">Login</button>
    </form>
  `);
});
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query('SELECT id, role FROM users WHERE email = $1 AND password = $2', [email, password]);
  if (result.rows.length) {
    req.session.userId = result.rows[0].id;
    req.session.userRole = result.rows[0].role;
    res.redirect('/');
  } else {
    res.send('Invalid credentials');
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
