import { renderPdfToPngs } from "./pdfRenderer.js";
import sharp from "sharp";

export interface Region {
  fieldName: string;
  pageNumber: number;
  x: number; // 0-1 relative
  y: number;
  width: number;
  height: number;
  prompt?: string;
}

export interface ExtractedRegion {
  fieldName: string;
  pageNumber: number;
  imageData: Buffer;
  mimeType: "image/png";
  prompt?: string;
}

/**
 * Extract specific regions from a PDF based on template coordinates.
 * Regions use relative coordinates (0-1) so they work across different PDF sizes.
 */
export async function extractRegionsFromPdf(
  pdfBuffer: Buffer,
  regions: Region[]
): Promise<ExtractedRegion[]> {
  // Render PDF to PNG pages at 300 DPI for accurate region extraction
  const pages = await renderPdfToPngs(pdfBuffer, 300);
  
  if (pages.length === 0) {
    console.warn("[pdfRegionExtractor] Could not render PDF pages - falling back to full document");
    return [];
  }

  const extracted: ExtractedRegion[] = [];

  for (const region of regions) {
    const page = pages.find((p) => p.pageNumber === region.pageNumber);
    if (!page) {
      console.warn(`[pdfRegionExtractor] Page ${region.pageNumber} not found for region ${region.fieldName}`);
      continue;
    }

    try {
      // Get page dimensions
      const metadata = await sharp(page.data).metadata();
      if (!metadata.width || !metadata.height) {
        console.warn(`[pdfRegionExtractor] Could not get dimensions for page ${region.pageNumber}`);
        continue;
      }

      // Convert relative coordinates to absolute pixels
      const left = Math.round(region.x * metadata.width);
      const top = Math.round(region.y * metadata.height);
      const width = Math.round(region.width * metadata.width);
      const height = Math.round(region.height * metadata.height);

      // Extract region
      const croppedImage = await sharp(page.data)
        .extract({ left, top, width, height })
        .png()
        .toBuffer();

      extracted.push({
        fieldName: region.fieldName,
        pageNumber: region.pageNumber,
        imageData: croppedImage,
        mimeType: "image/png",
        prompt: region.prompt,
      });

      console.log(
        `[pdfRegionExtractor] Extracted ${region.fieldName} from page ${region.pageNumber} (${width}x${height}px)`
      );
    } catch (error) {
      console.error(`[pdfRegionExtractor] Failed to extract region ${region.fieldName}:`, error);
    }
  }

  return extracted;
}
