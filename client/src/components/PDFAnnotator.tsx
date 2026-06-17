import { useState, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { X, Square, Save } from "lucide-react";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Region {
  id: string;
  fieldName: string;
  pageNumber: number;
  x: number; // relative 0-1
  y: number;
  width: number;
  height: number;
  prompt?: string;
}

interface PDFAnnotatorProps {
  file: File | string;
  onSave?: (regions: Region[]) => void;
  onCancel: () => void;
  initialRegions?: Region[];
  readOnly?: boolean;
}

const FIELD_OPTIONS = [
  { value: "poNumber", label: "PO Number" },
  { value: "offerSheetNumber", label: "Offer Sheet Number" },
  { value: "customerName", label: "Customer Name" },
  { value: "customerCode", label: "Customer Code" },
  { value: "poDate", label: "PO Date" },
  { value: "deliveryDate", label: "Delivery Date" },
  { value: "items", label: "Line Items Table" },
  { value: "totalAmount", label: "Total Amount" },
  { value: "notes", label: "Notes/Comments" },
];

export default function PDFAnnotator({ file, onSave, onCancel, initialRegions = [], readOnly = false }: PDFAnnotatorProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [regions, setRegions] = useState<Region[]>(initialRegions);
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedField, setSelectedField] = useState<string>("poNumber");
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [pageWidth, setPageWidth] = useState<number>(0);
  const [pageHeight, setPageHeight] = useState<number>(0);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const onPageLoadSuccess = (page: any) => {
    const viewport = page.getViewport({ scale: 1 });
    setPageWidth(viewport.width);
    setPageHeight(viewport.height);
  };

  useEffect(() => {
    drawRegions();
  }, [regions, currentPage, pageWidth, pageHeight]);

  const drawRegions = () => {
    const canvas = canvasRef.current;
    if (!canvas || !pageWidth || !pageHeight) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pageRegions = regions.filter((r) => r.pageNumber === currentPage);
    
    pageRegions.forEach((region) => {
      const x = region.x * pageWidth;
      const y = region.y * pageHeight;
      const width = region.width * pageWidth;
      const height = region.height * pageHeight;

      ctx.strokeStyle = selectedRegion === region.id ? "#3b82f6" : "#10b981";
      ctx.lineWidth = selectedRegion === region.id ? 3 : 2;
      ctx.strokeRect(x, y, width, height);

      ctx.fillStyle = selectedRegion === region.id ? "rgba(59, 130, 246, 0.1)" : "rgba(16, 185, 129, 0.1)";
      ctx.fillRect(x, y, width, height);

      ctx.fillStyle = "#fff";
      ctx.fillRect(x, y - 24, width, 24);
      ctx.fillStyle = "#000";
      ctx.font = "12px sans-serif";
      ctx.fillText(
        FIELD_OPTIONS.find((f) => f.value === region.fieldName)?.label || region.fieldName,
        x + 4,
        y - 8
      );
    });

    if (currentRect) {
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(currentRect.x, currentRect.y, currentRect.width, currentRect.height);
      ctx.fillStyle = "rgba(59, 130, 246, 0.1)";
      ctx.fillRect(currentRect.x, currentRect.y, currentRect.width, currentRect.height);
      ctx.setLineDash([]);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const clickedRegion = regions.find((r) => {
      if (r.pageNumber !== currentPage) return false;
      const rx = r.x * pageWidth;
      const ry = r.y * pageHeight;
      const rw = r.width * pageWidth;
      const rh = r.height * pageHeight;
      return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
    });

    if (clickedRegion) {
      setSelectedRegion(clickedRegion.id);
      return;
    }

    if (readOnly) return;

    setIsDrawing(true);
    setDrawStart({ x, y });
    setSelectedRegion(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (readOnly || !isDrawing || !drawStart) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = x - drawStart.x;
    const height = y - drawStart.y;

    setCurrentRect({ x: drawStart.x, y: drawStart.y, width, height });
    drawRegions();
  };

  const handleMouseUp = () => {
    if (!isDrawing || !drawStart || !currentRect) {
      setIsDrawing(false);
      return;
    }

    const { x, y, width, height } = currentRect;
    
    if (Math.abs(width) < 10 || Math.abs(height) < 10) {
      setIsDrawing(false);
      setDrawStart(null);
      setCurrentRect(null);
      return;
    }

    const normalizedX = width < 0 ? x + width : x;
    const normalizedY = height < 0 ? y + height : y;
    const normalizedWidth = Math.abs(width);
    const normalizedHeight = Math.abs(height);

    const newRegion: Region = {
      id: `region-${Date.now()}`,
      fieldName: selectedField,
      pageNumber: currentPage,
      x: normalizedX / pageWidth,
      y: normalizedY / pageHeight,
      width: normalizedWidth / pageWidth,
      height: normalizedHeight / pageHeight,
    };

    setRegions([...regions, newRegion]);
    setIsDrawing(false);
    setDrawStart(null);
    setCurrentRect(null);
  };

  const deleteRegion = (id: string) => {
    setRegions(regions.filter((r) => r.id !== id));
    setSelectedRegion(null);
  };

  const handleSave = () => {
    onSave?.(regions);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-xl font-semibold">{readOnly ? "Review Template" : "PDF Template Annotation"}</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto bg-gray-100 p-4">
            <div className="flex justify-center">
              <div ref={containerRef} className="relative inline-block">
                <Document file={file} onLoadSuccess={onDocumentLoadSuccess}>
                  <Page
                    pageNumber={currentPage}
                    onLoadSuccess={onPageLoadSuccess}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                </Document>
                <canvas
                  ref={canvasRef}
                  width={pageWidth}
                  height={pageHeight}
                  className={`absolute top-0 left-0 ${readOnly ? "cursor-pointer" : "cursor-crosshair"}`}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  style={{ width: pageWidth, height: pageHeight }}
                />
              </div>
            </div>
          </div>

          <div className="w-80 border-l bg-white p-4 overflow-auto">
            <div className="space-y-4">
              {!readOnly && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-2">Field to Mark</label>
                    <select
                      value={selectedField}
                      onChange={(e) => setSelectedField(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      {FIELD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Square className="w-4 h-4" />
                    <span>Click and drag to mark region</span>
                  </div>
                </>
              )}

              {numPages > 1 && (
                <div>
                  <label className="block text-sm font-medium mb-2">Page</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 border rounded disabled:opacity-50"
                    >
                      Prev
                    </button>
                    <span className="text-sm">
                      {currentPage} / {numPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(Math.min(numPages, currentPage + 1))}
                      disabled={currentPage === numPages}
                      className="px-3 py-1 border rounded disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium mb-2">Marked Regions ({regions.length})</h3>
                <div className="space-y-2 max-h-96 overflow-auto">
                  {regions.map((region) => (
                    <div
                      key={region.id}
                      className={`p-2 border rounded cursor-pointer ${
                        selectedRegion === region.id ? "border-blue-500 bg-blue-50" : "border-gray-200"
                      }`}
                      onClick={() => {
                        setSelectedRegion(region.id);
                        setCurrentPage(region.pageNumber);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm">
                          <div className="font-medium">
                            {FIELD_OPTIONS.find((f) => f.value === region.fieldName)?.label}
                          </div>
                          <div className="text-xs text-gray-500">Page {region.pageNumber}</div>
                        </div>
                        {!readOnly && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRegion(region.id);
                            }}
                            className="text-red-500 hover:text-red-700"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
          >
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && (
            <button
              onClick={handleSave}
              disabled={regions.length === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save Template
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
