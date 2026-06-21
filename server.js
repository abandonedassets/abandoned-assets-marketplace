require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.set('db', pool);

const stripeRouter = require('./routes/stripe-checkout');

// Stripe webhook must be mounted before express.json() so signature verification receives the raw body.
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeRouter);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets (CSS/JS/images). Will not interfere with API routes.
// Dynamic path resolver: try several likely locations for the static files and pick the first that exists.
const staticCandidates = [
  path.join(__dirname, 'public'),
  path.join(__dirname, 'frontend', 'public'),
  path.join(__dirname, 'build', 'public'),
  path.join(__dirname, 'dist', 'public'),
  path.join(process.cwd(), 'public'),
  path.join(process.cwd(), 'frontend', 'public')
];

let publicPath = staticCandidates.find(p => {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
});

if (!publicPath) {
  // As a conservative fallback, use __dirname/public even if it doesn't exist yet
  publicPath = path.join(__dirname, 'public');
}

// Logging to help Render (or local) environment debugging
console.log('INFO: Static path candidates (in order):', JSON.stringify(staticCandidates));
console.log('INFO: Selected publicPath for express.static():', publicPath);
console.log('INFO: process.cwd():', process.cwd());
console.log('INFO: __dirname:', __dirname);

function listDirRecursive(dir, prefix = '') {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(e => {
      const full = path.join(dir, e.name);
      console.log(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}`);
      if (e.isDirectory()) listDirRecursive(full, prefix + '  ');
    });
  } catch (err) {
    console.log(`INFO: Error reading directory "${dir}":`, err && err.message ? err.message : err);
  }
}

listDirRecursive(publicPath);

app.use(express.static(publicPath, { extensions: ['html', 'htm'] }));

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
const autoLoginRouter    = require('./routes/auto-login');
const propertyApiRouter  = require('./routes/property-api');
const interestsApiRouter = require('./routes/interests-api');
const adminApiRouter     = require('./routes/admin-api');
const clusterApiRouter   = require('./routes/cluster-api');
const dealsApiRouter     = require('./routes/deals-api');

// Register API routes
app.use('/auth', autoLoginRouter);
app.use('/api', propertyApiRouter);
app.use('/api', interestsApiRouter);
app.use('/api', adminApiRouter);
app.use('/api', clusterApiRouter);
app.use('/checkout', stripeRouter);
app.use('/api', dealsApiRouter);

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

// Explicit UI routes
function sendIfExists(res, relPath) {
  const full = path.join(publicPath, relPath);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    return res.status(200).sendFile(full);
  }
  return null;
}

app.get(['/login', '/login.html'], (req, res, next) => {
  if (sendIfExists(res, 'login.html')) return;
  // fallback to index.html (SPA) if login isn't a standalone file
  if (sendIfExists(res, 'index.html')) return;
  next();
});

app.get(['/marketplace', '/marketplace.html'], (req, res, next) => {
  if (sendIfExists(res, 'marketplace.html')) return;
  if (sendIfExists(res, 'index.html')) return;
  next();
});

app.get('/pricing.html', (req, res, next) => {
  if (sendIfExists(res, 'pricing.html')) return;
  if (sendIfExists(res, 'index.html')) return;
  next();
});

// Monetization pages (public — no auth required to view pricing)
app.get('/pricing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pricing.html'));
});
app.get('/compliance-kit', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'compliance-kit.html'));
});
app.get('/purchase-success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'purchase-success.html'));
});

// Current user info (used by purchase-success page)
app.get('/api/me', (req, res) => {
  if (req.user) {
    res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role });
  } else {
    res.json({});
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful catch-all for non-API GET requests:
// - If the exact static file exists, serve it
// - If adding .html resolves, serve it
// - Otherwise fall back to index.html (SPA support)
// - Always forward /api/* to downstream API handlers
app.get('*', (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();

  // Normalize and prevent path traversal
  const safePath = path.normalize(req.path).replace(/^(\.{2}(\/|\\|$))+/, '');
  const candidate = path.join(publicPath, safePath);

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return res.status(200).sendFile(candidate);
  }

  // Try with .html extension
  const candidateHtml = candidate + '.html';
  if (fs.existsSync(candidateHtml) && fs.statSync(candidateHtml).isFile()) {
    return res.status(200).sendFile(candidateHtml);
  }

  // Fallback to index.html for SPA routes
  const indexFile = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
    return res.status(200).sendFile(indexFile);
  }

  // Nothing matched, continue to next middleware (likely 404 or API)
  next();
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
