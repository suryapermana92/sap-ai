# PO to SAP - Purchase Order Automation Platform

A full-stack platform that connects to email accounts, detects incoming Purchase Orders (PO) from customers, analyzes documents using AI (OpenAI GPT-4o), and automatically creates Sales Orders (SO) in SAP Business One via the Service Layer REST API.

## Architecture

- **Backend**: Node.js + Express + TypeScript + Drizzle ORM + SQLite
- **Frontend**: React + Vite + TypeScript + TailwindCSS + React Router
- **AI**: OpenAI GPT-4o for document analysis and PO data extraction
- **Email**: Gmail OAuth2 + Generic IMAP support
- **ERP**: SAP Business One Service Layer REST API

## Features

1. **Email Integration**: Connect Gmail or any IMAP-enabled email account
2. **AI Document Analysis**: Automatically detect if an email attachment is a Purchase Order and extract structured data (customer, items, quantities, prices, dates)
3. **Review & Approve**: Human-in-the-loop review interface to validate AI-extracted data before sending to SAP
4. **SAP B1 Integration**: Create Sales Orders directly in SAP Business One with one click
5. **Manual Upload**: Upload PO documents directly via drag-and-drop for analysis

## How to Run the App

### Prerequisites

- Node.js 18+ and npm
- OpenAI API Key
- SAP Business One Service Layer URL (optional, for SAP integration)
- Gmail OAuth credentials (optional, for Gmail integration)

### 1. Install dependencies

This is a monorepo using npm workspaces. Installing from the root installs dependencies for the root, `server`, and `client`.

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your credentials:

```bash
cp server/.env.example server/.env
```

`server/.env` variables:

```env
NODE_ENV=development
PORT=3001
DATABASE_URL=./data/db.sqlite
OPENAI_API_KEY=your-openai-api-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/api/email/auth/google/callback
JWT_SECRET=your-jwt-secret
CORS_ORIGIN=http://localhost:5173
```

> Only `OPENAI_API_KEY` is required to start. Gmail (`GOOGLE_*`) and SAP settings are optional and can be configured later in the app's Settings page.

### 3. Set up the database

Create the SQLite schema (uses Drizzle ORM):

```bash
npm run db:push -w server
```

### 4. Start the app (development)

Runs the backend and frontend concurrently:

```bash
npm run dev
```

- **Backend (API)**: http://localhost:3001
- **Frontend (UI)**: http://localhost:5173

Open http://localhost:5173 in your browser.

### Production build

```bash
# Build both server and client
npm run build

# Start the server (serves the API)
npm start
```

## Usage

1. Go to **Settings** and connect your email account (IMAP or Gmail OAuth) and SAP B1 connection
2. The system will automatically poll emails every 2 minutes
3. Detected Purchase Orders appear in the **Purchase Orders** list
4. Click on a PO to review the AI-extracted data
5. Click **Create SAP SO** to push the order to SAP Business One

## API Endpoints

- `GET/POST /api/email/accounts` - Manage email accounts
- `GET/POST /api/purchase-orders` - Manage POs
- `GET/POST /api/sap/connections` - Manage SAP connections
- `POST /api/upload/analyze` - Upload and analyze documents
- `GET /api/stats` - Dashboard statistics

## License

MIT
