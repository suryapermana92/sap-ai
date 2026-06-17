import { db } from "../db/index.js";
import { poTemplates, poTemplateRegions } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Region } from "./pdfRegionExtractor.js";

const FIELD_LABELS: Record<string, string> = {
  poNumber: "PO Number",
  offerSheetNumber: "Offer Sheet Number (ADPI quotation reference)",
  customerName: "Customer Name",
  customerCode: "Customer Code",
  poDate: "PO Date",
  deliveryDate: "Delivery Date",
  items: "Line Items Table",
  totalAmount: "Total Amount",
  notes: "Notes/Comments",
};

// Describe the marked box as a precise bounding region in page-percentage terms.
// A coarse 3x3 grid label ("middle-center") is too vague to steer the model to a
// specific table; exact percentages let it focus on the correct rectangle.
function describePosition(x: number, y: number, width: number, height: number): string {
  const left = Math.round(x * 100);
  const top = Math.round(y * 100);
  const right = Math.round((x + width) * 100);
  const bottom = Math.round((y + height) * 100);
  return `the rectangle spanning ${left}%-${right}% horizontally and ${top}%-${bottom}% vertically (measured from the top-left of the page)`;
}

export interface MatchedTemplate {
  id: number;
  name: string;
  regions: Region[];
}

/**
 * Pick the single template whose layout best matches the incoming document, so
 * its marked regions can be CROPPED from the PDF for focused analysis.
 * Matching order: (1) template whose senderEmail matches the sender, else
 * (2) if there is exactly one active template, use it. We deliberately do NOT
 * crop using a non-matching template — applying one customer's coordinates to a
 * different layout would crop the wrong area and hurt accuracy.
 */
export async function getMatchedTemplateForCropping(senderEmail?: string): Promise<MatchedTemplate | null> {
  const templates = await db
    .select()
    .from(poTemplates)
    .where(eq(poTemplates.isActive, true))
    .all();

  if (templates.length === 0) return null;

  const realSender = senderEmail && senderEmail !== "manual@upload.com" ? senderEmail.toLowerCase() : null;

  let chosen = realSender
    ? templates.find((t) => t.senderEmail && realSender.includes(t.senderEmail.toLowerCase()))
    : undefined;

  if (!chosen && templates.length === 1) chosen = templates[0];
  if (!chosen) return null;

  const regions = await db
    .select()
    .from(poTemplateRegions)
    .where(eq(poTemplateRegions.templateId, chosen.id))
    .all();

  if (regions.length === 0) return null;

  return {
    id: chosen.id,
    name: chosen.name,
    regions: regions.map((r) => ({
      fieldName: r.fieldName,
      pageNumber: r.pageNumber,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      prompt: r.prompt || undefined,
    })),
  };
}

export async function buildTemplateHints(senderEmail?: string): Promise<string> {
  const templates = await db
    .select()
    .from(poTemplates)
    .where(eq(poTemplates.isActive, true))
    .all();

  if (templates.length === 0) return "";

  const blocks: string[] = [];

  for (const template of templates) {
    const regions = await db
      .select()
      .from(poTemplateRegions)
      .where(eq(poTemplateRegions.templateId, template.id))
      .all();

    if (regions.length === 0) continue;

    const isMatch =
      senderEmail &&
      template.senderEmail &&
      senderEmail.toLowerCase().includes(template.senderEmail.toLowerCase());

    const header = `Template "${template.name}"${
      template.customerName ? ` (customer: ${template.customerName})` : ""
    }${isMatch ? " [BEST MATCH for this sender]" : ""}:`;

    const lines = regions.map((r) => {
      const label = FIELD_LABELS[r.fieldName] || r.fieldName;
      const pos = describePosition(r.x, r.y, r.width, r.height);
      const pageInfo = `page ${r.pageNumber}`;
      const custom = r.prompt ? ` Note: ${r.prompt}` : "";
      const itemsHint =
        r.fieldName === "items"
          ? " Extract line items ONLY from this rectangle; ignore any other tables (e.g. tax summaries, terms, totals blocks) outside it."
          : "";
      return `  - ${label}: located in ${pos} on ${pageInfo}.${itemsHint}${custom}`;
    });

    blocks.push(`${header}\n${lines.join("\n")}`);
  }

  if (blocks.length === 0) return "";

  return `\n\nLEARNED LAYOUT HINTS FROM SAVED TEMPLATES:
Use these as guidance for WHERE to look for each field in similar documents. These are hints, not absolute rules — always verify against what is actually printed. If a [BEST MATCH] template is indicated, prioritize its layout.

${blocks.join("\n\n")}`;
}
