import OpenAI from "openai";
import { env } from "../config/env.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export interface ExtractedPOData {
  isPurchaseOrder: boolean;
  confidence: number;
  reason?: string;
  customerName?: string;
  customerCode?: string;
  poNumber?: string;
  poDate?: string;
  deliveryDate?: string;
  offerSheetNumber?: string;
  items: Array<{
    itemCode?: string;
    description?: string;
    quantity: number;
    unitPrice?: number;
    uom?: string;
  }>;
  totalAmount?: number;
  currency?: string;
  shipToAddress?: string;
  billToAddress?: string;
  paymentTerms?: string;
  notes?: string;
  rawText?: string;
}

const SYSTEM_PROMPT = `You are an expert document analyzer specialized in Purchase Orders (PO).
Analyze the provided document content and determine if it is a Purchase Order.

If it IS a Purchase Order, extract the following fields in JSON format:
- isPurchaseOrder: boolean (true)
- confidence: number (0-1)
- customerName: string
- customerCode: string (if available)
- poNumber: string
- poDate: string (ISO format)
- deliveryDate: string (ISO format, if available)
- offerSheetNumber: string (if present, format like XXXX/ADPI/OS/MM/YYYY. This is a reference number to an Offer Sheet / Quotation)
- items: array of objects with itemCode, description, quantity, unitPrice, uom
- totalAmount: number
- currency: string
- shipToAddress: string
- billToAddress: string
- paymentTerms: string
- notes: string
- rawText: string (cleaned text content)

If it is NOT a Purchase Order:
- isPurchaseOrder: boolean (false)
- confidence: number (0-1)
- reason: string (brief explanation)

Respond ONLY with valid JSON. No markdown, no explanations outside JSON.`;

export interface AttachmentInput {
  filename: string;
  mimeType: string;
  data: Buffer;
}

// Skip attachments larger than this to avoid oversized API payloads (~32MB base64).
const MAX_ATTACHMENT_BYTES = 24 * 1024 * 1024;

export async function screenEmailForPO(
  subject: string,
  body: string,
  attachmentNames: string[]
): Promise<{ isLikelyPO: boolean; confidence: number; reason: string }> {
  try {
    const prompt = `You are an email screener. Determine if this email is likely to contain a Purchase Order (PO) based on the subject, body, and attachment names.

Subject: ${subject}
Attachment names: ${attachmentNames.join(", ") || "none"}
Body:\n${body.substring(0, 3000)}

Respond ONLY with JSON:
{ "isLikelyPO": boolean, "confidence": number (0-1), "reason": string }
No markdown.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an email screening assistant." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const raw = response.choices[0].message.content || "{}";
    const jsonStr = raw.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(jsonStr);
    return {
      isLikelyPO: !!parsed.isLikelyPO,
      confidence: Number(parsed.confidence) || 0,
      reason: parsed.reason || "",
    };
  } catch (error) {
    console.error("screenEmailForPO error:", error);
    return { isLikelyPO: false, confidence: 0, reason: "Screening failed" };
  }
}

export interface AttachmentAnalysis {
  filename: string;
  isPurchaseOrder: boolean;
  confidence: number;
  reason?: string;
  offerSheetNumber?: string;
  poNumber?: string;
  customerName?: string;
}

export async function analyzeAttachmentsForPO(
  attachments: AttachmentInput[]
): Promise<AttachmentAnalysis[]> {
  const results: AttachmentAnalysis[] = [];

  for (const att of attachments) {
    if (!att.data || att.data.length === 0 || att.data.length > MAX_ATTACHMENT_BYTES) {
      results.push({
        filename: att.filename,
        isPurchaseOrder: false,
        confidence: 0,
        reason: "Attachment too large or empty",
      });
      continue;
    }

    try {
      const mime = att.mimeType.toLowerCase();
      const userContent: any[] = [
        {
          type: "text",
          text: `Analyze the attached document and determine if it is a Purchase Order (PO). If it is a PO, also look for an "Offer Sheet" reference number (format: XXXX/ADPI/OS/MM/YYYY).

Respond ONLY with JSON:
{
  "isPurchaseOrder": boolean,
  "confidence": number (0-1),
  "reason": string,
  "offerSheetNumber": string or null,
  "poNumber": string or null,
  "customerName": string or null
}
No markdown.`,
        },
      ];

      const base64 = att.data.toString("base64");
      if (mime.includes("pdf")) {
        userContent.push({
          type: "file",
          file: {
            filename: att.filename || "document.pdf",
            file_data: `data:application/pdf;base64,${base64}`,
          },
        });
      } else if (mime.startsWith("image/")) {
        userContent.push({
          type: "image_url",
          image_url: { url: `data:${att.mimeType};base64,${base64}` },
        });
      } else {
        results.push({
          filename: att.filename,
          isPurchaseOrder: false,
          confidence: 0,
          reason: "Unsupported file type for vision analysis",
        });
        continue;
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are an expert document analyzer specialized in Purchase Orders." },
          { role: "user", content: userContent as any },
        ],
        temperature: 0.1,
        max_tokens: 1500,
      });

      const raw = response.choices[0].message.content || "{}";
      const jsonStr = raw.replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(jsonStr);

      results.push({
        filename: att.filename,
        isPurchaseOrder: !!parsed.isPurchaseOrder,
        confidence: Number(parsed.confidence) || 0,
        reason: parsed.reason || "",
        offerSheetNumber: parsed.offerSheetNumber || undefined,
        poNumber: parsed.poNumber || undefined,
        customerName: parsed.customerName || undefined,
      });
    } catch (error) {
      console.error(`Attachment analysis error for ${att.filename}:`, error);
      results.push({
        filename: att.filename,
        isPurchaseOrder: false,
        confidence: 0,
        reason: "Analysis failed",
      });
    }
  }

  return results;
}

export async function analyzeDocument(
  content: string,
  filename?: string,
  attachments: AttachmentInput[] = []
): Promise<ExtractedPOData> {
  try {
    const userContent: any[] = [
      {
        type: "text",
        text: `Document filename: ${filename || "unknown"}\n\nEmail body / extracted text:\n${content.substring(0, 12000)}`,
      },
    ];

    // Attach the original files so the model can read the actual document
    // content (gpt-4o extracts both text and page images, handling scanned PDFs).
    const sentToModel: string[] = [];
    for (const att of attachments) {
      if (!att.data || att.data.length === 0 || att.data.length > MAX_ATTACHMENT_BYTES) {
        console.warn(
          `[analyzeDocument] skipped attachment "${att.filename}" (${att.data?.length || 0} bytes, ${att.mimeType})`
        );
        continue;
      }
      const mime = att.mimeType.toLowerCase();
      const base64 = att.data.toString("base64");

      if (mime.includes("pdf")) {
        userContent.push({
          type: "file",
          file: {
            filename: att.filename || "document.pdf",
            file_data: `data:application/pdf;base64,${base64}`,
          },
        });
        sentToModel.push(`${att.filename} (${(att.data.length / 1024).toFixed(0)} KB, pdf)`);
      } else if (mime.startsWith("image/")) {
        userContent.push({
          type: "image_url",
          image_url: { url: `data:${att.mimeType};base64,${base64}` },
        });
        sentToModel.push(`${att.filename} (${(att.data.length / 1024).toFixed(0)} KB, image)`);
      } else {
        console.warn(
          `[analyzeDocument] attachment "${att.filename}" (${att.mimeType}) not sent to model (unsupported type)`
        );
      }
    }

    console.log(
      sentToModel.length > 0
        ? `[analyzeDocument] sent ${sentToModel.length} attachment(s) to gpt-4o: ${sentToModel.join(", ")}`
        : `[analyzeDocument] no attachments sent to gpt-4o (text-only analysis)`
    );

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent as any },
      ],
      temperature: 0.1,
      max_tokens: 4000,
    });

    const rawContent = response.choices[0].message.content || "{}";
    const jsonStr = rawContent.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    if (!parsed.isPurchaseOrder) {
      return {
        isPurchaseOrder: false,
        confidence: parsed.confidence || 0,
        reason: parsed.reason || "The document was not recognized as a Purchase Order.",
        items: [],
        rawText: parsed.rawText || content,
      };
    }

    return {
      isPurchaseOrder: true,
      confidence: parsed.confidence || 0.8,
      customerName: parsed.customerName,
      customerCode: parsed.customerCode,
      poNumber: parsed.poNumber,
      poDate: parsed.poDate,
      deliveryDate: parsed.deliveryDate,
      offerSheetNumber: parsed.offerSheetNumber,
      items: Array.isArray(parsed.items) ? parsed.items.map((item: any) => ({
        itemCode: item.itemCode,
        description: item.description,
        quantity: Number(item.quantity) || 0,
        unitPrice: item.unitPrice ? Number(item.unitPrice) : undefined,
        uom: item.uom,
      })) : [],
      totalAmount: parsed.totalAmount ? Number(parsed.totalAmount) : undefined,
      currency: parsed.currency,
      shipToAddress: parsed.shipToAddress,
      billToAddress: parsed.billToAddress,
      paymentTerms: parsed.paymentTerms,
      notes: parsed.notes,
      rawText: parsed.rawText || content,
    };
  } catch (error) {
    console.error("OpenAI analysis error:", error);
    return {
      isPurchaseOrder: false,
      confidence: 0,
      items: [],
    };
  }
}

export async function validatePOData(data: ExtractedPOData): Promise<{ valid: boolean; issues: string[] }> {
  const issues: string[] = [];

  if (!data.customerName && !data.customerCode) {
    issues.push("Customer name or code is required");
  }
  if (!data.items || data.items.length === 0) {
    issues.push("At least one item is required");
  }
  if (data.items.some((item) => item.quantity <= 0)) {
    issues.push("All items must have a valid quantity");
  }

  return { valid: issues.length === 0, issues };
}
