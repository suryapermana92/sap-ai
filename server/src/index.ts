import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { db } from "./db/index.js";
import { purchaseOrders } from "./db/schema.js";
import { sql } from "drizzle-orm";
import emailRoutes from "./routes/email.js";
import poRoutes from "./routes/purchaseOrders.js";
import sapRoutes from "./routes/sap.js";
import settingsRoutes from "./routes/settings.js";
import uploadRoutes from "./routes/upload.js";
import { EmailProcessor, SAPProcessor } from "./services/processor.js";

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: "50mb" }));

// Initialize DB tables (simple migration)
try {
  db.run(sql`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS email_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    email TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    imap_host TEXT,
    imap_port INTEGER,
    imap_secure INTEGER,
    imap_username TEXT,
    imap_password TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_checked_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_account_id INTEGER NOT NULL,
    email_message_id TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    sender_name TEXT,
    subject TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'detected',
    confidence REAL,
    ai_analysis TEXT,
    extracted_data TEXT,
    offer_sheet_number TEXT,
    sq_doc_entry INTEGER,
    sq_doc_num INTEGER,
    sap_doc_entry INTEGER,
    sap_doc_num INTEGER,
    sap_error TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS po_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content TEXT,
    extracted_text TEXT,
    is_po_attachment INTEGER,
    ai_analysis TEXT,
    size INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  // ---- Schema migration: add columns if missing ----
  try { db.run(sql`ALTER TABLE purchase_orders ADD COLUMN offer_sheet_number TEXT`); } catch { /* exists */ }
  try { db.run(sql`ALTER TABLE purchase_orders ADD COLUMN sq_doc_entry INTEGER`); } catch { /* exists */ }
  try { db.run(sql`ALTER TABLE purchase_orders ADD COLUMN sq_doc_num INTEGER`); } catch { /* exists */ }
  try { db.run(sql`ALTER TABLE po_attachments ADD COLUMN is_po_attachment INTEGER`); } catch { /* exists */ }
  try { db.run(sql`ALTER TABLE po_attachments ADD COLUMN ai_analysis TEXT`); } catch { /* exists */ }

  db.run(sql`CREATE TABLE IF NOT EXISTS sap_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    service_layer_url TEXT NOT NULL,
    company_db TEXT NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_connected_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);
} catch (error) {
  console.error("DB initialization error:", error);
}

// Routes
app.use("/api/email", emailRoutes);
app.use("/api/purchase-orders", poRoutes);
app.use("/api/sap", sapRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/upload", uploadRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Stats endpoint
app.get("/api/stats", async (_req, res) => {
  const pos = await db.select().from(purchaseOrders).all();
  res.json({
    total: pos.length,
    detected: pos.filter((p: any) => p.status === "detected").length,
    analyzing: pos.filter((p: any) => p.status === "analyzing").length,
    reviewed: pos.filter((p: any) => p.status === "reviewed").length,
    needs_offer_sheet: pos.filter((p: any) => p.status === "needs_offer_sheet").length,
    processing: pos.filter((p: any) => p.status === "processing").length,
    completed: pos.filter((p: any) => p.status === "completed").length,
    error: pos.filter((p: any) => p.status === "error").length,
  });
});

// Trigger manual processing
app.post("/api/process", async (_req, res) => {
  const sapProcessor = new SAPProcessor();
  await sapProcessor.processPendingOrders();
  res.json({ success: true });
});

const PORT = env.PORT;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Start background processors
const emailProcessor = new EmailProcessor();
emailProcessor.start(60000); // Check every 1 minute

const sapProcessor = new SAPProcessor();
setInterval(() => sapProcessor.processPendingOrders(), 30000); // Process SAP orders every 30s
