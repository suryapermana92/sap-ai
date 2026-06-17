import { Router } from "express";
import { db } from "../db/index.js";
import { purchaseOrders, poAttachments, emailAccounts } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { GmailService } from "../services/email/gmail.js";
import { ImapService } from "../services/email/imap.js";
import { analyzeDocument, AttachmentInput } from "../services/openai.js";
import { extractTextFromBuffer } from "../services/documentExtractor.js";

const router = Router();

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

  const attachments = await db.select().from(poAttachments).where(eq(poAttachments.poId, id)).all();

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

// Re-run AI analysis for an existing record by re-fetching the original email
// (including attachments) so PDFs/images are re-checked with vision support.
router.post("/:id/reanalyze", async (req, res) => {
  const id = Number(req.params.id);
  const po = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).get();
  if (!po) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  let messageText = "";
  let attachments: AttachmentInput[] = [];

  try {
    if (po.emailAccountId === 0) {
      // Manual upload: original files are not retained, re-analyze stored text.
      const ai = po.aiAnalysis ? JSON.parse(po.aiAnalysis) : null;
      messageText = ai?.fullText || "";
    } else {
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
    }

    const analysis = await analyzeDocument(messageText, po.subject, attachments);

    const result = await db
      .update(purchaseOrders)
      .set({
        status: analysis.isPurchaseOrder ? "reviewed" : "detected",
        confidence: analysis.confidence,
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

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(poAttachments).where(eq(poAttachments.poId, id));
  await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
  res.json({ success: true });
});

export default router;
