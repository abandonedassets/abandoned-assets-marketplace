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
