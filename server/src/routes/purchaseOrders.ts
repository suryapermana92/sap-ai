import { Router } from "express";
import multer from "multer";
import { db } from "../db/index.js";
import { purchaseOrders, poAttachments, emailAccounts } from "../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import { GmailService } from "../services/email/gmail.js";
import { ImapService } from "../services/email/imap.js";
import { analyzeDocument, AttachmentInput } from "../services/openai.js";
import { extractTextFromBuffer } from "../services/documentExtractor.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const MAX_PERSIST_BYTES = 25 * 1024 * 1024;

// Convert raw bytes to the base64 string we store in po_attachments.content,
// returning null when the buffer is empty or too large to keep in SQLite.
function bytesForDb(filename: string, buf: Buffer | null | undefined): string | null {
  if (!buf || buf.length === 0) return null;
  if (buf.length > MAX_PERSIST_BYTES) {
    console.warn(`[purchaseOrders] not persisting "${filename}" (${buf.length} bytes, > ${MAX_PERSIST_BYTES})`);
    return null;
  }
  return buf.toString("base64");
}

router.get("/", async (req, res) => {
  const pos = await db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt)).all();

  const enriched = pos.map((po) => {
    let isPurchaseOrder = false;
    let extractedOfferSheet: string | null = null;
    try {
      if (po.extractedData) {
        const parsed = JSON.parse(po.extractedData);
        isPurchaseOrder = parsed.isPurchaseOrder === true;
        extractedOfferSheet = parsed.offerSheetNumber || null;
      }
    } catch {
      isPurchaseOrder = false;
    }
    // The offer sheet may have been extracted into the JSON but not persisted
    // to the dedicated column (older records / mismatch). Fall back to the JSON
    // so the list always shows it when available.
    return {
      ...po,
      isPurchaseOrder,
      offerSheetNumber: po.offerSheetNumber || extractedOfferSheet,
    };
  });

  // When ?detected=true, only return confirmed purchase orders.
  const result = req.query.detected === "true" ? enriched.filter((p) => p.isPurchaseOrder) : enriched;
  res.json(result);
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const po = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).get();
  if (!po) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Don't ship the raw `content` base64 to the client (multi-MB per row); the
  // UI only needs a hasContent flag to decide whether to show a download link.
  const rawAttachments = await db.select().from(poAttachments).where(eq(poAttachments.poId, id)).all();
  const attachments = rawAttachments.map(({ content, ...rest }) => ({
    ...rest,
    hasContent: !!content,
  }));

  res.json({
    ...po,
    aiAnalysis: po.aiAnalysis ? JSON.parse(po.aiAnalysis) : null,
    extractedData: po.extractedData ? JSON.parse(po.extractedData) : null,
    attachments,
  });
});

router.post("/:id/review", async (req, res) => {
  const id = Number(req.params.id);
  const { status, corrections } = req.body;

  const existing = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const extractedData = existing.extractedData ? JSON.parse(existing.extractedData) : {};

  if (corrections) {
    Object.assign(extractedData, corrections);
  }

  const result = await db.update(purchaseOrders)
    .set({
      status,
      extractedData: JSON.stringify(extractedData),
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, id))
    .returning();

  res.json(result[0]);
});

router.post("/:id/offer-sheet", async (req, res) => {
  const id = Number(req.params.id);
  const { offerSheetNumber } = req.body;

  if (!offerSheetNumber || typeof offerSheetNumber !== "string") {
    res.status(400).json({ error: "offerSheetNumber is required" });
    return;
  }

  const existing = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const result = await db.update(purchaseOrders)
    .set({
      offerSheetNumber,
      status: "processing",
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, id))
    .returning();

  res.json(result[0]);
});

router.post("/:id/process", async (req, res) => {
  const id = Number(req.params.id);

  const existing = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!existing.offerSheetNumber) {
    res.status(400).json({ error: "Offer Sheet number is required before processing" });
    return;
  }

  // Mark as processing so the SAP processor picks it up
  const result = await db.update(purchaseOrders)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(purchaseOrders.id, id))
    .returning();

  res.json(result[0]);
});

// Re-run AI analysis for an existing record.
//
// Priority order for the source of bytes:
//   1. Stored attachment bytes (poAttachments.content) — preferred, because
//      it tests the AI on the EXACT bytes that produced the original result.
//      This is the diagnostic path: if a re-analyze of the same bytes now
//      produces the correct extraction, we know the AI was wrong (prompt /
//      DPI issue). If it still gives the wrong result, the bytes themselves
//      are the problem and we need to look at the email fetch pipeline.
//   2. Re-fetch from the original email account — only when no bytes are
//      stored (legacy rows from before content was persisted).
//   3. Stored text only — only for manual uploads with no bytes (very old
//      rows). Will degrade to a text-only analysis.
router.post("/:id/reanalyze", async (req, res) => {
  const id = Number(req.params.id);
  const po = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).get();
  if (!po) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  let messageText = "";
  let attachments: AttachmentInput[] = [];
  let source: "stored" | "email" | "text-only" = "text-only";

  try {
    const storedAtts = await db
      .select()
      .from(poAttachments)
      .where(eq(poAttachments.poId, id))
      .all();
    const storedWithBytes = storedAtts.filter((a) => !!a.content);

    if (storedWithBytes.length > 0) {
      source = "stored";
      attachments = storedWithBytes.map((a) => ({
        filename: a.filename,
        mimeType: a.contentType,
        data: Buffer.from(a.content!, "base64"),
      }));
      const combinedTexts: string[] = [];
      for (const att of attachments) {
        const text = await extractTextFromBuffer(att.data, att.mimeType);
        if (text) combinedTexts.push(`--- Attachment: ${att.filename} ---\n${text}`);
      }
      messageText = combinedTexts.join("\n\n");
    } else if (po.emailAccountId === 0) {
      // Manual upload with no bytes — only stored text is available.
      const ai = po.aiAnalysis ? JSON.parse(po.aiAnalysis) : null;
      messageText = ai?.fullText || "";
      source = "text-only";
    } else {
      // Email row with no stored bytes — re-fetch from the inbox.
      source = "email";
      const account = await db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, po.emailAccountId))
        .get();
      if (!account) {
        res.status(400).json({ error: "Email account no longer exists" });
        return;
      }

      let msg = null;
      if (account.provider === "gmail" && account.accessToken) {
        const service = new GmailService(account.accessToken, account.refreshToken || undefined);
        msg = await service.getMessage(po.emailMessageId);
      } else if (account.provider === "imap") {
        const service = new ImapService({
          host: account.imapHost!,
          port: account.imapPort!,
          secure: account.imapSecure!,
          user: account.imapUsername!,
          password: account.imapPassword!,
        });
        msg = await service.fetchByUid(po.emailMessageId);
      }

      if (!msg) {
        res.status(404).json({ error: "Could not re-fetch the original email" });
        return;
      }

      const combinedTexts: string[] = [msg.body];
      for (const att of msg.attachments) {
        const text = await extractTextFromBuffer(att.data, att.mimeType);
        if (text) {
          combinedTexts.push(`--- Attachment: ${att.filename} ---\n${text}`);
        }
      }
      messageText = combinedTexts.join("\n\n");
      attachments = msg.attachments.map((att) => ({
        filename: att.filename,
        mimeType: att.mimeType,
        data: att.data,
      }));

      // Backfill po_attachments for this legacy row so the next visit can
      // download the file and re-analyses use the stored bytes path. Match
      // by filename; if a row already exists with empty content, update it.
      // Otherwise insert a fresh row so the attachment appears in the UI.
      const existingRows = await db
        .select()
        .from(poAttachments)
        .where(eq(poAttachments.poId, id))
        .all();
      for (const att of msg.attachments) {
        const content = bytesForDb(att.filename, att.data);
        if (!content) continue;
        const existing = existingRows.find((r) => r.filename === att.filename);
        if (existing) {
          if (!existing.content) {
            await db
              .update(poAttachments)
              .set({ content, size: att.size, contentType: att.mimeType })
              .where(eq(poAttachments.id, existing.id));
          }
        } else {
          await db.insert(poAttachments).values({
            poId: id,
            filename: att.filename,
            contentType: att.mimeType,
            size: att.size,
            content,
          });
        }
      }
    }

    console.log(
      `[reanalyze] PO #${id} source=${source} attachments=${attachments.length}`
    );
    const analysis = await analyzeDocument(messageText, po.subject, attachments);

    // Same status logic as upload route and email processor: promote the
    // offer sheet into the top-level column and route the row to the right
    // queue based on whether the AI found one.
    let nextStatus: string;
    if (!analysis.isPurchaseOrder) {
      nextStatus = "detected";
    } else if (analysis.offerSheetNumber) {
      nextStatus = "processing";
    } else {
      nextStatus = "needs_offer_sheet";
    }

    const result = await db
      .update(purchaseOrders)
      .set({
        status: nextStatus,
        confidence: analysis.confidence,
        offerSheetNumber: analysis.offerSheetNumber || null,
        aiAnalysis: JSON.stringify({ fullText: messageText.substring(0, 10000) }),
        extractedData: JSON.stringify(analysis),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id))
      .returning();

    res.json(result[0]);
  } catch (error: any) {
    console.error(`Re-analyze failed for PO ${id}:`, error);
    res.status(500).json({ error: error?.message || "Re-analysis failed" });
  }
});

// Download the original bytes of an attachment. Returns 404 when the row is
// from before we started persisting `content` (legacy email rows pre-this
// commit), so the UI can show a "not stored" state instead of a broken file.
router.get("/:id/attachments/:attId/download", async (req, res) => {
  const id = Number(req.params.id);
  const attId = Number(req.params.attId);

  const att = await db
    .select()
    .from(poAttachments)
    .where(and(eq(poAttachments.id, attId), eq(poAttachments.poId, id)))
    .get();

  if (!att) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  if (!att.content) {
    res.status(404).json({ error: "Attachment bytes were not stored for this record" });
    return;
  }

  const buffer = Buffer.from(att.content, "base64");
  // RFC 5987 filename* handles non-ASCII filenames safely; the plain filename
  // is a fallback for older browsers.
  const safeFallback = (att.filename || "attachment").replace(/[^\w.\-]+/g, "_");
  res.setHeader("Content-Type", att.contentType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeFallback}"; filename*=UTF-8''${encodeURIComponent(att.filename || "attachment")}`
  );
  res.setHeader("Content-Length", String(buffer.length));
  res.send(buffer);
});

// Upload a fresh copy of an attachment file for legacy rows whose bytes were
// never persisted (manual-upload rows from before content was stored, or email
// rows whose source mailbox no longer has the message). Replaces the bytes
// in-place on the matching po_attachments row, so the existing Download and
// Re-analyze flows work without changing the rest of the schema.
router.post(
  "/:id/attachments/:attId/replace",
  upload.single("file"),
  async (req, res) => {
    const id = Number(req.params.id);
    const attId = Number(req.params.attId);
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const att = await db
      .select()
      .from(poAttachments)
      .where(and(eq(poAttachments.id, attId), eq(poAttachments.poId, id)))
      .get();
    if (!att) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    const content = bytesForDb(file.originalname, file.buffer);
    if (!content) {
      res.status(400).json({ error: "File too large or empty" });
      return;
    }

    const result = await db
      .update(poAttachments)
      .set({
        filename: file.originalname,
        contentType: file.mimetype,
        size: file.size,
        content,
      })
      .where(eq(poAttachments.id, attId))
      .returning();

    const { content: _omit, ...sanitized } = result[0];
    res.json({ ...sanitized, hasContent: true });
  }
);

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(poAttachments).where(eq(poAttachments.poId, id));
  await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
  res.json({ success: true });
});

export default router;
