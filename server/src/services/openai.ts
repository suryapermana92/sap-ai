import OpenAI from "openai";
import { env } from "../config/env.js";
import { renderPdfToPngs } from "./pdfRenderer.js";
import { buildTemplateHints, getMatchedTemplateForCropping } from "./templateHints.js";
import { extractRegionsFromPdf } from "./pdfRegionExtractor.js";

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

const SYSTEM_PROMPT = `You are an expert document analyzer specialized in Purchase Orders (PO) from Indonesian manufacturing customers.
Analyze the provided document content and determine if it is a Purchase Order.

CRITICAL — DO NOT HALLUCINATE:
- Transcribe numbers and reference codes character-by-character from what you actually see in the document. Do not autocomplete, do not guess, do not "round" digits, do not infer values that look similar to ones you've seen before.
- If you are uncertain about a digit (e.g. scanned document, low resolution, smudged ink), return null for that field rather than guessing. A null is much better than a wrong number — wrong numbers cause real financial damage downstream when they hit SAP.
- Especially for the offer sheet / quotation reference: read each digit one at a time. Do NOT default to "0125" or any number you may have seen in another document — every PO has its own reference.

CRITICAL — offerSheetNumber rules:
- offerSheetNumber is OUR (ADPI / Alpha Delta Polimerz Indonesia) quotation reference that the customer cites in their PO.
- It ALWAYS matches the regex: ^\\d{3,4}/ADPI/OS/\\d{2}/\\d{4}$  (e.g. "0125/ADPI/OS/04/2026", "0130/ADPI/OS/04/2026").
- It can appear ANYWHERE in the document (any page, header, footer, body, notes/catatan section). Search the entire document, including the last page and any small print.
- It may be labelled as: "QUOTATION", "Quotation No", "Ref Quotation", "Reference", "OFFER SHEET", "No. Penawaran", "No Penawaran", "Catatan", or it may appear with no label at all.
- DO NOT confuse it with the customer's own PO number (poNumber). poNumber is whatever the customer calls their document (e.g. "PO2-2026/E/010/RMID", "260405070", "No. OP: 260405070"). poNumber and offerSheetNumber are different fields.
- If no string matching the ADPI offer-sheet regex exists in the document, return offerSheetNumber: null. Never substitute the customer's PO number, internal codes, or any other reference.
- If you can see that an offer sheet reference is present but cannot confidently read every digit (low scan quality), return null rather than guessing the digits.
- DO NOT default to "0125" or any specific prefix. The first 3-4 digits vary per quotation (e.g. 0125, 0130, 0247, 1023). Read what is actually printed; do not autocomplete based on a prior or "typical" value.

OFFER SHEET TRANSCRIPTION PROTOCOL:
When you find an offer sheet reference in the document, before writing it into offerSheetNumber:
1. Locate the literal text in the image/PDF.
2. Read each character in order, left to right: digit, digit, digit, [digit?], /, A, D, P, I, /, O, S, /, digit, digit, /, digit, digit, digit, digit.
3. Verify the prefix digits one at a time — do not assume them. If any digit is ambiguous (could be 0/8, 3/5/6/8, 1/7, etc.), return null for offerSheetNumber.
4. Only emit the value if you are confident every single digit is correctly transcribed.

If it IS a Purchase Order, extract the following fields in JSON format:
- isPurchaseOrder: boolean (true)
- confidence: number (0-1)
- customerName: string (the buyer issuing the PO, not ADPI)
- customerCode: string (if available)
- poNumber: string (the customer's own PO / OP / Order number)
- poDate: string (ISO format)
- deliveryDate: string (ISO format, if available)
- offerSheetNumber: string or null (see CRITICAL rules above)
- items: array of objects with itemCode, description, quantity, unitPrice, uom
- totalAmount: number
- currency: string
- shipToAddress: string
- billToAddress: string
- paymentTerms: string
- notes: string
- rawText: string (cleaned text content, include ALL pages so the offer sheet regex can be re-verified downstream)

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

// ADPI Offer Sheet reference always matches this shape, e.g. "0125/ADPI/OS/04/2026".
const OFFER_SHEET_REGEX = /\b\d{3,4}\/ADPI\/OS\/\d{2}\/\d{4}\b/i;

export function findOfferSheetInText(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const match = text.match(OFFER_SHEET_REGEX);
  return match ? match[0].toUpperCase() : undefined;
}

function isValidOfferSheet(value: string | undefined | null): boolean {
  return !!value && OFFER_SHEET_REGEX.test(value);
}

// gpt-4o vision misreads scanned PDFs at its internal low-DPI rasterization (it
// hallucinated 0125 for ZEBRA when the real value was 0130). Rendering to 300 DPI PNG
// before sending eliminates that class of error. If pdftoppm (poppler) is unavailable,
// we fall back to sending the raw PDF — degraded accuracy, but still functional.
//
// Returns the OpenAI `content` parts to append to a user message, plus a human-readable
// label list for logging.
async function buildVisionParts(attachments: AttachmentInput[]): Promise<{ parts: any[]; labels: string[] }> {
  const parts: any[] = [];
  const labels: string[] = [];

  for (const att of attachments) {
    if (!att.data || att.data.length === 0 || att.data.length > MAX_ATTACHMENT_BYTES) {
      console.warn(
        `[openai] skipped attachment "${att.filename}" (${att.data?.length || 0} bytes, ${att.mimeType})`
      );
      continue;
    }

    const mime = att.mimeType.toLowerCase();

    if (mime.includes("pdf")) {
      const pages = await renderPdfToPngs(att.data, 300);
      if (pages.length > 0) {
        for (const page of pages) {
          if (page.data.length > MAX_ATTACHMENT_BYTES) {
            console.warn(
              `[openai] skipped rendered page ${page.pageNumber} of "${att.filename}" (${page.data.length} bytes)`
            );
            continue;
          }
          parts.push({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${page.data.toString("base64")}` },
          });
          labels.push(`${att.filename} page ${page.pageNumber} (${(page.data.length / 1024).toFixed(0)} KB, png@300dpi)`);
        }
        continue;
      }
      // Fallback: pdftoppm unavailable or failed — send the raw PDF.
      parts.push({
        type: "file",
        file: {
          filename: att.filename || "document.pdf",
          file_data: `data:application/pdf;base64,${att.data.toString("base64")}`,
        },
      });
      labels.push(`${att.filename} (${(att.data.length / 1024).toFixed(0)} KB, raw pdf — RENDER FALLBACK)`);
    } else if (mime.startsWith("image/")) {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${att.mimeType};base64,${att.data.toString("base64")}` },
      });
      labels.push(`${att.filename} (${(att.data.length / 1024).toFixed(0)} KB, image)`);
    } else {
      console.warn(`[openai] attachment "${att.filename}" (${att.mimeType}) not sent to model (unsupported type)`);
    }
  }

  return { parts, labels };
}

// Skip attachments larger than this to avoid oversized API payloads (~32MB base64).
const MAX_ATTACHMENT_BYTES = 24 * 1024 * 1024;

const FIELD_DESCRIPTIONS: Record<string, string> = {
  poNumber: "the customer's PO / order number",
  offerSheetNumber: "the ADPI offer-sheet / quotation reference",
  customerName: "the customer (buyer) name",
  customerCode: "the customer code",
  poDate: "the PO date",
  deliveryDate: "the delivery date",
  items: "the line-items table — extract EVERY row's itemCode, description, quantity, unitPrice and uom from THIS crop only",
  totalAmount: "the grand total amount",
  notes: "notes / comments",
};

// Crop the marked template regions out of the PDF and append them as focused,
// high-DPI images so the model reads each field from the exact rectangle the
// user marked, instead of guessing across the whole page. Requires pdftoppm
// (poppler); if unavailable, extractRegionsFromPdf returns [] and we silently
// fall back to the full-page render + textual hints.
async function buildRegionCropParts(
  attachments: AttachmentInput[],
  senderEmail?: string
): Promise<{ parts: any[]; labels: string[] }> {
  const parts: any[] = [];
  const labels: string[] = [];

  const matched = await getMatchedTemplateForCropping(senderEmail);
  if (!matched) return { parts, labels };

  for (const att of attachments) {
    if (!att.mimeType.toLowerCase().includes("pdf")) continue;
    if (!att.data || att.data.length === 0) continue;

    const crops = await extractRegionsFromPdf(att.data, matched.regions);
    for (const crop of crops) {
      if (crop.imageData.length > MAX_ATTACHMENT_BYTES) continue;
      const desc = FIELD_DESCRIPTIONS[crop.fieldName] || crop.fieldName;
      const note = crop.prompt ? ` Additional note: ${crop.prompt}.` : "";
      parts.push({
        type: "text",
        text: `FOCUSED REGION (template "${matched.name}", field "${crop.fieldName}", page ${crop.pageNumber}): This cropped image contains ${desc}. Read this field primarily from this crop.${note}`,
      });
      parts.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${crop.imageData.toString("base64")}` },
      });
      labels.push(`${crop.fieldName} crop p${crop.pageNumber} (${(crop.imageData.length / 1024).toFixed(0)} KB)`);
    }
  }

  return { parts, labels };
}

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
      const userContent: any[] = [
        {
          type: "text",
          text: `Analyze the attached document and determine if it is a Purchase Order (PO) issued to ADPI (Alpha Delta Polimerz Indonesia).

CRITICAL — DO NOT HALLUCINATE digits. Transcribe reference codes character-by-character from what you actually see. If you cannot confidently read every digit (low-resolution scan, smudge, faint print), return null for that field rather than guessing. A wrong number causes real financial damage in SAP. Never default to "0125" or any number you may have seen in another document.

Then extract:
- poNumber: the CUSTOMER's own PO / OP / Order number (e.g. "PO2-2026/E/010/RMID", "260405070"). This is whatever the customer labels their document.
- offerSheetNumber: ADPI's quotation reference cited in the PO. It MUST match the regex ^\\d{3,4}/ADPI/OS/\\d{2}/\\d{4}$ (e.g. "0125/ADPI/OS/04/2026"). Search ALL pages, including footers, notes/catatan sections, and small print. It may appear under labels like "QUOTATION", "Ref Quotation", "OFFER SHEET", "No. Penawaran", "Catatan", or with no label. If no string matches the regex anywhere in the document, return null. NEVER substitute the customer's PO number. If the reference is visible but the digits are hard to read, return null — do not guess.
- customerName: the buyer (not ADPI).

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

      const { parts, labels } = await buildVisionParts([att]);
      if (parts.length === 0) {
        results.push({
          filename: att.filename,
          isPurchaseOrder: false,
          confidence: 0,
          reason: "Unsupported file type for vision analysis",
        });
        continue;
      }
      userContent.push(...parts);
      console.log(`[analyzeAttachmentsForPO] ${att.filename}: ${labels.join(", ")}`);

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

      const modelOfferSheet = isValidOfferSheet(parsed.offerSheetNumber)
        ? String(parsed.offerSheetNumber).toUpperCase()
        : undefined;
      // Safety net: if the model missed it, scan its own JSON for the ADPI pattern.
      const fallbackOfferSheet = modelOfferSheet
        ? undefined
        : findOfferSheetInText(JSON.stringify(parsed));

      results.push({
        filename: att.filename,
        isPurchaseOrder: !!parsed.isPurchaseOrder,
        confidence: Number(parsed.confidence) || 0,
        reason: parsed.reason || "",
        offerSheetNumber: modelOfferSheet || fallbackOfferSheet,
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
  attachments: AttachmentInput[] = [],
  senderEmail?: string
): Promise<ExtractedPOData> {
  try {
    const userContent: any[] = [
      {
        type: "text",
        text: `Document filename: ${filename || "unknown"}\n\nEmail body / extracted text:\n${content.substring(0, 12000)}`,
      },
    ];

    // PDFs are rendered to 300dpi PNG pages first; image attachments pass through.
    // See pdfRenderer.ts for the rationale (raw-PDF vision read hallucinates digits).
    const { parts, labels } = await buildVisionParts(attachments);
    userContent.push(...parts);

    console.log(
      labels.length > 0
        ? `[analyzeDocument] sent ${labels.length} vision part(s) to gpt-4o: ${labels.join(", ")}`
        : `[analyzeDocument] no attachments sent to gpt-4o (text-only analysis)`
    );

    // Crop the marked template regions and send them as focused images so the
    // model reads each field (especially the line-items table) from the exact
    // rectangle the user marked. Requires poppler; no-ops gracefully without it.
    const { parts: cropParts, labels: cropLabels } = await buildRegionCropParts(attachments, senderEmail);
    if (cropParts.length > 0) {
      userContent.push(...cropParts);
      console.log(`[analyzeDocument] sent ${cropLabels.length} focused region crop(s): ${cropLabels.join(", ")}`);
    }

    // Learn from ALL saved templates: inject layout hints so the model knows
    // where each field typically appears across known customer PO formats.
    const templateHints = await buildTemplateHints(senderEmail);
    if (templateHints) {
      console.log(`[analyzeDocument] applied learned template hints (${templateHints.length} chars)`);
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT + templateHints },
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

    const modelOfferSheet = isValidOfferSheet(parsed.offerSheetNumber)
      ? String(parsed.offerSheetNumber).toUpperCase()
      : undefined;
    // Safety net: re-scan the source text and the model's own output for the ADPI offer-sheet pattern.
    // Order: model answer (if valid) → upstream extracted text → notes/rawText/raw JSON.
    const fallbackOfferSheet = modelOfferSheet
      ? undefined
      : findOfferSheetInText(content) ||
        findOfferSheetInText(parsed.rawText) ||
        findOfferSheetInText(parsed.notes) ||
        findOfferSheetInText(JSON.stringify(parsed));

    return {
      isPurchaseOrder: true,
      confidence: parsed.confidence || 0.8,
      customerName: parsed.customerName,
      customerCode: parsed.customerCode,
      poNumber: parsed.poNumber,
      poDate: parsed.poDate,
      deliveryDate: parsed.deliveryDate,
      offerSheetNumber: modelOfferSheet || fallbackOfferSheet,
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
