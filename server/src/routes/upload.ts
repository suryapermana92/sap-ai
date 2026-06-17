import { Router } from "express";
import multer from "multer";
import { db } from "../db/index.js";
import { purchaseOrders, poAttachments } from "../db/schema.js";
import { analyzeDocument, ExtractedPOData } from "../services/openai.js";
import { extractTextFromBuffer } from "../services/documentExtractor.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post("/analyze", upload.array("files", 5), async (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: "No files uploaded" });
    return;
  }

  const combinedTexts: string[] = [];
  const savedAttachments: Array<{ filename: string; contentType: string; size: number; content: string | null }> = [];

  for (const file of files) {
    const text = await extractTextFromBuffer(file.buffer, file.mimetype);
    if (text) {
      combinedTexts.push(`--- File: ${file.originalname} ---\n${text}`);
    }
    // Persist bytes (base64) so the original file can be downloaded later
    // from the PO detail page — useful for template re-annotation and for
    // debugging why an extraction was wrong. Cap to avoid SQLite bloat.
    const MAX_PERSIST_BYTES = 25 * 1024 * 1024;
    const canPersist = file.buffer.length > 0 && file.buffer.length <= MAX_PERSIST_BYTES;
    if (!canPersist && file.buffer.length > MAX_PERSIST_BYTES) {
      console.warn(
        `[upload] not persisting "${file.originalname}" (${file.buffer.length} bytes, > ${MAX_PERSIST_BYTES})`
      );
    }
    savedAttachments.push({
      filename: file.originalname,
      contentType: file.mimetype,
      size: file.size,
      content: canPersist ? file.buffer.toString("base64") : null,
    });
  }

  const fullText = combinedTexts.join("\n\n");
  const analysis = await analyzeDocument(
    fullText,
    files[0]?.originalname,
    files.map((file) => ({
      filename: file.originalname,
      mimeType: file.mimetype,
      data: file.buffer,
    }))
  );

  // Mirror the email processor's logic so manual uploads land in the same
  // state as email-fetched POs: when AI finds an offer sheet we mark the row
  // ready for SAP (status='processing' so SAPProcessor picks it up); when it
  // doesn't, the row goes into 'needs_offer_sheet' so it appears on the
  // /needs-offer-sheet page for manual entry.
  let status: string;
  if (!analysis.isPurchaseOrder) {
    status = "detected";
  } else if (analysis.offerSheetNumber) {
    status = "processing";
  } else {
    status = "needs_offer_sheet";
  }

  const poResult = await db.insert(purchaseOrders).values({
    emailAccountId: 0, // manual upload
    emailMessageId: `manual-upload-${Date.now()}`,
    senderEmail: "manual@upload.com",
    subject: files.map((f) => f.originalname).join(", "),
    receivedAt: new Date(),
    status,
    confidence: analysis.confidence,
    offerSheetNumber: analysis.offerSheetNumber || null,
    aiAnalysis: JSON.stringify({ fullText: fullText.substring(0, 10000) }),
    extractedData: JSON.stringify(analysis),
  }).returning();

  const poId = poResult[0].id;

  for (const att of savedAttachments) {
    await db.insert(poAttachments).values({
      poId,
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      content: att.content,
    });
  }

  res.json({
    poId,
    isPurchaseOrder: analysis.isPurchaseOrder,
    confidence: analysis.confidence,
    data: analysis,
  });
});

export default router;
