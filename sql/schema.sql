-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT,
    role TEXT DEFAULT 'buyer',
    is_verified BOOLEAN DEFAULT FALSE,
    preferred_state TEXT,
    proof_of_funds_amount NUMERIC,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Properties table
CREATE TABLE properties (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER REFERENCES users(id),
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    price NUMERIC,
    property_type TEXT,
    status TEXT DEFAULT 'pending',
    is_cluster BOOLEAN DEFAULT FALSE,
    cluster_size INTEGER,
    total_acres NUMERIC,
    estimated_equity NUMERIC,
    distress_type TEXT,
    days_on_market INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Buyer profiles
CREATE TABLE buyer_profiles (
    id SERIAL PRIMARY KEY,
    buyer_id INTEGER REFERENCES users(id),
    min_price NUMERIC,
    max_price NUMERIC,
    preferred_state TEXT,
    preferred_property_type TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Interests
CREATE TABLE interests (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id),
    buyer_id INTEGER REFERENCES users(id),
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Clusters (premium)
CREATE TABLE clusters (
    id SERIAL PRIMARY KEY,
    name TEXT,
    description TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    property_count INTEGER,
    total_acres NUMERIC,
    total_price NUMERIC,
    cluster_type TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Activity log (social proof)
CREATE TABLE activity_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    first_name TEXT,
    street_name TEXT,
    action TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Deals table
CREATE TABLE deals (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id),
    buyer_id INTEGER REFERENCES users(id),
    seller_id INTEGER REFERENCES users(id),
    status TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- NCA agreements
CREATE TABLE nca_agreements (
    id SERIAL PRIMARY KEY,
    buyer_id INTEGER REFERENCES users(id),
    property_id INTEGER REFERENCES properties(id),
    agreed_at TIMESTAMP DEFAULT NOW(),
    ip_address TEXT
);

-- Email logs
CREATE TABLE email_logs (
    id SERIAL PRIMARY KEY,
    recipient TEXT,
    subject TEXT,
    sent_at TIMESTAMP DEFAULT NOW()
);

-- Execution venue support: first-lock-wins deal execution and Stripe clearing.
CREATE TABLE IF NOT EXISTS deal_locks (
    id SERIAL PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    buyer_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'locked',
    stripe_session_id TEXT UNIQUE,
    amount_cents INTEGER NOT NULL DEFAULT 100,
    currency TEXT NOT NULL DEFAULT 'usd',
    locked_at TIMESTAMP NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
    released_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT deal_locks_status_check CHECK (status IN ('locked', 'paid', 'released', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS deal_locks_one_active_per_property
ON deal_locks (property_id)
WHERE status = 'locked';

CREATE INDEX IF NOT EXISTS deal_locks_buyer_idx ON deal_locks (buyer_id);
CREATE INDEX IF NOT EXISTS deal_locks_property_idx ON deal_locks (property_id);
CREATE INDEX IF NOT EXISTS deal_locks_stripe_session_idx ON deal_locks (stripe_session_id);

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS assigned_buyer_id INTEGER,
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS algorithm_broadcast_log (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
    endpoint_url TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    http_status INTEGER,
    response_body TEXT,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
