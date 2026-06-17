import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Render a PDF buffer to one PNG per page at the requested DPI using pdftoppm (poppler).
// We render at 300 DPI by default — gpt-4o vision misreads digits at the lower DPI it
// uses internally for raw PDF inputs (see docs/offer-sheet-extraction.md). 300 DPI fixed
// the Zebra 0130/ADPI/OS/04/2026 misread in our test harness.
//
// Production requirement: the `pdftoppm` binary must be on PATH (apt: poppler-utils,
// brew: poppler). If missing, renderPdfToPngs returns [] and callers MUST fall back to
// sending the raw PDF to the model (degraded accuracy on scanned docs, but functional).

export interface RenderedPage {
  pageNumber: number;
  data: Buffer;
  mimeType: "image/png";
}

let pdftoppmAvailableCache: boolean | null = null;

export async function isPdftoppmAvailable(): Promise<boolean> {
  if (pdftoppmAvailableCache !== null) return pdftoppmAvailableCache;
  try {
    pdftoppmAvailableCache = await new Promise<boolean>((resolve) => {
      const child = spawn("pdftoppm", ["-v"], { stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("exit", () => resolve(true));
    });
  } catch {
    pdftoppmAvailableCache = false;
  }
  return pdftoppmAvailableCache;
}

export async function renderPdfToPngs(pdfBuffer: Buffer, dpi = 300): Promise<RenderedPage[]> {
  if (!(await isPdftoppmAvailable())) {
    console.warn("[pdfRenderer] pdftoppm not found on PATH — install poppler-utils for accurate scanned-PDF reads");
    return [];
  }

  const workDir = await mkdtemp(join(tmpdir(), "sap-ai-pdfrender-"));
  const inputPath = join(workDir, "input.pdf");
  const outputPrefix = join(workDir, "page");

  try {
    await writeFile(inputPath, pdfBuffer);

    await new Promise<void>((resolve, reject) => {
      const child = spawn("pdftoppm", ["-r", String(dpi), "-png", inputPath, outputPrefix], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pdftoppm exited ${code}: ${stderr}`));
      });
    });

    const files = (await readdir(workDir)).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort();
    const pages: RenderedPage[] = [];
    for (const file of files) {
      const match = file.match(/page-?(\d+)\.png$/);
      const pageNumber = match ? Number(match[1]) : pages.length + 1;
      const data = await readFile(join(workDir, file));
      pages.push({ pageNumber, data, mimeType: "image/png" });
    }
    return pages;
  } catch (error) {
    console.error("[pdfRenderer] failed to render PDF:", error);
    return [];
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
