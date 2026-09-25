# Logistiqo Backend

Express.js + PostgreSQL backend API for the Logistiqo logistics platform.

## Setup

1. Copy `.env.example` to `.env` and fill in your values
2. Run `npm install`
3. Run `node migrate.js` to create database tables
4. Seed the admin account:
   ```
   POST /api/admin/seed
   Body: { "username": "admin", "password": "yourpassword", "secret": "your_SEED_SECRET" }
   ```
5. Run `npm run dev` for development or `npm start` for production

## Deploy to Render

1. Connect your GitHub repo in Render dashboard
2. Set **Build Command**: `npm install`
3. Set **Start Command**: `npm start`
4. Add environment variables:
   - `DATABASE_URL` = your Neon PostgreSQL connection string
   - `JWT_SECRET` = a long random string
   - `SEED_SECRET` = a secret for admin seeding
   - `PORT` = 5000 (Render sets this automatically)

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/admin/login | None | Login as admin |
| POST | /api/admin/seed | Secret | Create admin account |
| GET | /api/shipments | Admin JWT | List all shipments |
| POST | /api/shipments | Admin JWT | Create shipment |
| PUT | /api/shipments/:tracking | Admin JWT | Update shipment |
| DELETE | /api/shipments/:tracking | Admin JWT | Delete shipment |
| GET | /api/track/:tracking | None | Public tracking |
| POST | /api/contact | None | Submit contact form |
| GET | /api/contact | Admin JWT | List messages |
