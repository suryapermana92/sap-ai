import { useState } from "react";
import { Upload, FileText, AlertCircle, CheckCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function UploadPage() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    isPurchaseOrder: boolean;
    confidence: number;
    poId: number;
    data: any;
  } | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files || files.length === 0) return;

    setUploading(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i]);
    }

    try {
      const res = await fetch("/api/upload/analyze", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Upload Purchase Order</h2>

      <div className="max-w-2xl">
        <form onSubmit={handleSubmit}>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragging
                ? "border-primary-500 bg-primary-50"
                : "border-gray-300 hover:border-gray-400"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              setFiles(e.dataTransfer.files);
            }}
          >
            <Upload className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-4 text-sm text-gray-600">
              Drag and drop your PO files here, or{" "}
              <label className="text-primary-600 font-medium cursor-pointer hover:text-primary-500">
                browse
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
                  className="sr-only"
                  onChange={(e) => setFiles(e.target.files)}
                />
              </label>
            </p>
            <p className="mt-1 text-xs text-gray-400">
              PDF, Word, Images up to 20MB each
            </p>

            {files && files.length > 0 && (
              <div className="mt-4 text-left">
                <p className="text-sm font-medium text-gray-700 mb-2">Selected files:</p>
                <div className="space-y-2">
                  {Array.from(files).map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-white rounded border">
                      <FileText size={16} className="text-gray-400" />
                      <span className="text-sm text-gray-700">{file.name}</span>
                      <span className="text-xs text-gray-400 ml-auto">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-6">
            <button
              type="submit"
              disabled={!files || files.length === 0 || uploading}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Analyzing with AI...
                </>
              ) : (
                <>
                  <Upload size={16} className="mr-2" />
                  Analyze Document
                </>
              )}
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {result && (
          <div className="mt-6">
            {result.isPurchaseOrder ? (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-green-800">
                      Purchase Order Detected
                    </p>
                    <p className="text-sm text-green-600">
                      Confidence: {Math.round(result.confidence * 100)}%
                    </p>
                  </div>
                </div>
                {result.data?.customerName && (
                  <p className="text-sm text-gray-700 mb-1">
                    Customer: <strong>{result.data.customerName}</strong>
                  </p>
                )}
                {result.data?.poNumber && (
                  <p className="text-sm text-gray-700 mb-1">
                    PO Number: <strong>{result.data.poNumber}</strong>
                  </p>
                )}
                {result.data?.items && (
                  <p className="text-sm text-gray-700 mb-3">
                    Items: <strong>{result.data.items.length}</strong>
                  </p>
                )}
                <button
                  onClick={() => navigate(`/purchase-orders/${result.poId}`)}
                  className="btn-primary mt-2"
                >
                  Review & Send to SAP
                </button>
              </div>
            ) : (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-6 h-6 text-yellow-600" />
                  <div>
                    <p className="text-sm font-medium text-yellow-800">
                      Not a Purchase Order
                    </p>
                    <p className="text-sm text-yellow-600">
                      The uploaded document does not appear to be a purchase order.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
