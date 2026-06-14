import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const emailAccounts = sqliteTable("email_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(), // gmail, imap
  email: text("email").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  imapHost: text("imap_host"),
  imapPort: integer("imap_port"),
  imapSecure: integer("imap_secure", { mode: "boolean" }),
  imapUsername: text("imap_username"),
  imapPassword: text("imap_password"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const purchaseOrders = sqliteTable("purchase_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  emailAccountId: integer("email_account_id").notNull(),
  emailMessageId: text("email_message_id").notNull(),
  senderEmail: text("sender_email").notNull(),
  senderName: text("sender_name"),
  subject: text("subject").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
  status: text("status").notNull().default("detected"), // detected, analyzing, reviewed, processing, completed, error
  confidence: real("confidence"),
  aiAnalysis: text("ai_analysis"), // JSON string
  extractedData: text("extracted_data"), // JSON string
  offerSheetNumber: text("offer_sheet_number"),
  sqDocEntry: integer("sq_doc_entry"),
  sqDocNum: integer("sq_doc_num"),
  sapDocEntry: integer("sap_doc_entry"),
  sapDocNum: integer("sap_doc_num"),
  sapError: text("sap_error"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const poAttachments = sqliteTable("po_attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  poId: integer("po_id").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  content: text("content"), // base64 or extracted text
  extractedText: text("extracted_text"),
  isPoAttachment: integer("is_po_attachment", { mode: "boolean" }),
  aiAnalysis: text("ai_analysis"), // JSON string
  size: integer("size"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const sapConnections = sqliteTable("sap_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  serviceLayerUrl: text("service_layer_url").notNull(),
  companyDB: text("company_db").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastConnectedAt: integer("last_connected_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const activityLogs = sqliteTable("activity_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  level: text("level").notNull(), // info, warn, error
  message: text("message").notNull(),
  details: text("details"), // JSON string
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
