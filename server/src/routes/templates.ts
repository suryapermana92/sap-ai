import { Router } from "express";
import multer from "multer";
import { db } from "../db/index.js";
import { poTemplates, poTemplateRegions, purchaseOrders, poAttachments } from "../db/schema.js";
import { eq, desc, isNotNull } from "drizzle-orm";
import { writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Ensure uploads directory exists
const UPLOADS_DIR = join(process.cwd(), "uploads", "templates");
await mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});

// List all templates
router.get("/", async (_req, res) => {
  const templates = await db.select().from(poTemplates).all();
  res.json(templates);
});

// List uploaded PO attachments that have stored PDF bytes, so they can be
// selected as a source for annotation (fields prepopulated from extracted data).
router.get("/sources", async (_req, res) => {
  const rows = await db
    .select({
      attachmentId: poAttachments.id,
      poId: poAttachments.poId,
      filename: poAttachments.filename,
      contentType: poAttachments.contentType,
      senderEmail: purchaseOrders.senderEmail,
      senderName: purchaseOrders.senderName,
      subject: purchaseOrders.subject,
      receivedAt: purchaseOrders.receivedAt,
      extractedData: purchaseOrders.extractedData,
    })
    .from(poAttachments)
    .innerJoin(purchaseOrders, eq(poAttachments.poId, purchaseOrders.id))
    .where(isNotNull(poAttachments.content))
    .orderBy(desc(purchaseOrders.receivedAt))
    .all();

  const sources = rows
    .filter((r) => r.contentType?.toLowerCase().includes("pdf"))
    .map((r) => {
      let extracted: any = null;
      try {
        extracted = r.extractedData ? JSON.parse(r.extractedData) : null;
      } catch {
        extracted = null;
      }
      return {
        attachmentId: r.attachmentId,
        poId: r.poId,
        filename: r.filename,
        senderEmail: r.senderEmail,
        senderName: r.senderName,
        subject: r.subject,
        receivedAt: r.receivedAt,
        customerName: extracted?.customerName || null,
        poNumber: extracted?.poNumber || null,
      };
    });

  res.json(sources);
});

// Serve a stored uploaded attachment's PDF bytes for annotation
router.get("/sources/:attachmentId/pdf", async (req, res) => {
  const attachmentId = Number(req.params.attachmentId);
  const att = await db
    .select()
    .from(poAttachments)
    .where(eq(poAttachments.id, attachmentId))
    .get();

  if (!att || !att.content) {
    res.status(404).json({ error: "Attachment PDF not found" });
    return;
  }

  try {
    const data = Buffer.from(att.content, "base64");
    res.setHeader("Content-Type", "application/pdf");
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to decode attachment PDF" });
  }
});

// Serve a template's sample PDF for review/annotation display
router.get("/:id/pdf", async (req, res) => {
  const id = Number(req.params.id);
  const template = await db.select().from(poTemplates).where(eq(poTemplates.id, id)).get();

  if (!template || !template.samplePdfPath) {
    res.status(404).json({ error: "Sample PDF not found" });
    return;
  }

  try {
    const data = await readFile(template.samplePdfPath);
    res.setHeader("Content-Type", "application/pdf");
    res.send(data);
  } catch (error) {
    res.status(404).json({ error: "Sample PDF file missing on disk" });
  }
});

// Get template with regions
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const template = await db.select().from(poTemplates).where(eq(poTemplates.id, id)).get();
  
  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const regions = await db.select().from(poTemplateRegions).where(eq(poTemplateRegions.templateId, id)).all();
  
  res.json({ ...template, regions });
});

// Create template
router.post("/", upload.single("samplePdf"), async (req, res) => {
  const { name, description, customerName, senderEmail, regions } = req.body;
  const file = req.file;

  if (!name) {
    res.status(400).json({ error: "Template name is required" });
    return;
  }

  let samplePdfPath: string | null = null;
  if (file) {
    const filename = `${Date.now()}-${file.originalname}`;
    samplePdfPath = join(UPLOADS_DIR, filename);
    await writeFile(samplePdfPath, file.buffer);
  }

  const result = await db.insert(poTemplates).values({
    name,
    description: description || null,
    customerName: customerName || null,
    senderEmail: senderEmail || null,
    samplePdfPath,
  }).returning();

  const templateId = result[0].id;

  // Parse and insert regions if provided
  if (regions) {
    const parsedRegions = typeof regions === "string" ? JSON.parse(regions) : regions;
    if (Array.isArray(parsedRegions) && parsedRegions.length > 0) {
      for (const region of parsedRegions) {
        await db.insert(poTemplateRegions).values({
          templateId,
          fieldName: region.fieldName,
          pageNumber: region.pageNumber || 1,
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          prompt: region.prompt || null,
        });
      }
    }
  }

  res.json(result[0]);
});

// Update template
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, customerName, senderEmail, isActive, regions } = req.body;

  const existing = await db.select().from(poTemplates).where(eq(poTemplates.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const result = await db.update(poTemplates)
    .set({
      name: name || existing.name,
      description: description !== undefined ? description : existing.description,
      customerName: customerName !== undefined ? customerName : existing.customerName,
      senderEmail: senderEmail !== undefined ? senderEmail : existing.senderEmail,
      isActive: isActive !== undefined ? isActive : existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(poTemplates.id, id))
    .returning();

  // Update regions if provided
  if (regions !== undefined) {
    // Delete existing regions
    await db.delete(poTemplateRegions).where(eq(poTemplateRegions.templateId, id));
    
    // Insert new regions
    const parsedRegions = typeof regions === "string" ? JSON.parse(regions) : regions;
    if (Array.isArray(parsedRegions) && parsedRegions.length > 0) {
      for (const region of parsedRegions) {
        await db.insert(poTemplateRegions).values({
          templateId: id,
          fieldName: region.fieldName,
          pageNumber: region.pageNumber || 1,
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          prompt: region.prompt || null,
        });
      }
    }
  }

  res.json(result[0]);
});

// Delete template
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  
  await db.delete(poTemplateRegions).where(eq(poTemplateRegions.templateId, id));
  await db.delete(poTemplates).where(eq(poTemplates.id, id));
  
  res.json({ success: true });
});

export default router;
