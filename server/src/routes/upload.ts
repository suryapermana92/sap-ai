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
  const savedAttachments: Array<{ filename: string; contentType: string; size: number }> = [];

  for (const file of files) {
    const text = await extractTextFromBuffer(file.buffer, file.mimetype);
    if (text) {
      combinedTexts.push(`--- File: ${file.originalname} ---\n${text}`);
    }
    savedAttachments.push({
      filename: file.originalname,
      contentType: file.mimetype,
      size: file.size,
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

  // Save to DB as manual upload
  const poResult = await db.insert(purchaseOrders).values({
    emailAccountId: 0, // manual upload
    emailMessageId: "manual-upload",
    senderEmail: "manual@upload.com",
    subject: files.map((f) => f.originalname).join(", "),
    receivedAt: new Date(),
    status: analysis.isPurchaseOrder ? "reviewed" : "detected",
    confidence: analysis.confidence,
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
