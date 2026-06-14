import pdf from "pdf-parse";

export async function extractTextFromBuffer(buffer: Buffer, contentType: string): Promise<string> {
  const type = contentType.toLowerCase();

  if (type.includes("pdf")) {
    try {
      const result = await pdf(buffer);
      return result.text || "";
    } catch {
      return "";
    }
  }

  if (type.includes("text/") || type.includes("csv") || type.includes("json")) {
    return buffer.toString("utf-8");
  }

  // For images or unsupported types, return empty - AI vision could be added here
  return "";
}
