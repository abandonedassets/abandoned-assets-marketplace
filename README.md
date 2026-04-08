# Abandoned Assets Marketplace

A wholesale real estate marketplace with two-click owner flow, auto-login, and deal protection.

## Features

- **Auto-Login**: Seamless login via email, name, and state parameters
- **Seller Dashboard**: Submit properties for approval
- **Buyer Listings**: Browse properties with address blurring and one free teaser
- **Express Interest**: Buyers can express interest in properties
- **Admin Two-Click Flow**: Approve sellers and interests, automatically create deals and send emails
- **Premium Clusters**: Land deal bundles with gated access
- **Email Alerts**: Real emails sent to admin when deals are ready for closing

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: PostgreSQL
- **Frontend**: HTML + JavaScript
- **Email**: Nodemailer

## Setup

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/yourusername/abandoned-assets-marketplace.git
cd abandoned-assets-marketplace
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

4. Update `.env` with your database URL and email credentials.

5. Run schema and seed data:
```bash
psql -U postgres -d abandoned_assets -f sql/schema.sql
psql -U postgres -d abandoned_assets -f sql/seed-data.sql
```

6. Start the server:
```bash
npm start
```

7. Access the app at `http://localhost:3000`

### Deployment to Render

1. Push code to GitHub
2. Create a new Web Service on Render
3. Connect your GitHub repository
4. Set environment variables in Render dashboard
5. Add PostgreSQL database on Render
6. Deploy

## API Endpoints

### Authentication
- `GET /auth/auto-login?email=...&name=...&state=...` - Auto-login endpoint

### Properties
- `POST /api/properties` - Create property (seller)
- `GET /api/properties` - List active properties

### Interests
- `POST /api/interests` - Express interest (buyer)
- `GET /api/my-interests` - Get buyer's interests

### Admin
- `POST /api/admin/approve-seller/:propertyId` - Approve property
- `POST /api/admin/approve-interest/:interestId` - Approve interest and create deal

### Clusters
- `GET /api/clusters` - List premium clusters

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Session encryption key
- `EMAIL_HOST` - SMTP host
- `EMAIL_USER` - SMTP username
- `EMAIL_PASS` - SMTP password
- `EMAIL_PORT` - SMTP port (default: 587)
- `EMAIL_FROM` - From email address
- `ADMIN_EMAIL` - Admin email for deal alerts
- `NODE_ENV` - Environment (development/production)
- `PORT` - Server port (default: 3000)

## License

MIT
