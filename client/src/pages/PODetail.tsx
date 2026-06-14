import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Send, AlertCircle, CheckCircle2, XCircle, FileText, ChevronDown, ChevronRight } from "lucide-react";

interface POItem {
  itemCode?: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  uom?: string;
}

interface POData {
  id: number;
  senderEmail: string;
  senderName: string;
  subject: string;
  status: string;
  confidence: number;
  receivedAt: string;
  offerSheetNumber?: string | null;
  sqDocEntry?: number | null;
  sqDocNum?: number | null;
  extractedData: {
    isPurchaseOrder?: boolean;
    reason?: string;
    rawText?: string;
    customerName?: string;
    customerCode?: string;
    poNumber?: string;
    poDate?: string;
    deliveryDate?: string;
    offerSheetNumber?: string;
    items: POItem[];
    totalAmount?: number;
    currency?: string;
    shipToAddress?: string;
    billToAddress?: string;
    paymentTerms?: string;
    notes?: string;
  } | null;
  aiAnalysis: { fullText?: string; screening?: any; attachmentAnalyses?: any[] } | null;
  sapDocEntry?: number;
  sapDocNum?: number;
  sapError?: string;
  attachments: Array<{
    id: number;
    filename: string;
    contentType: string;
    size: number;
    isPoAttachment?: boolean | null;
    aiAnalysis?: string | null;
  }>;
}

export default function PODetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [po, setPo] = useState<POData | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  const [showExtractedJson, setShowExtractedJson] = useState(false);
  const [offerSheetInput, setOfferSheetInput] = useState("");
  const [submittingOfferSheet, setSubmittingOfferSheet] = useState(false);

  useEffect(() => {
    fetch(`/api/purchase-orders/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setPo(data);
        setOfferSheetInput(data.offerSheetNumber || "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const handleSendToSAP = async () => {
    if (!po) return;
    setProcessing(true);
    await fetch(`/api/purchase-orders/${po.id}/process`, { method: "POST" });
    // Refresh
    const r = await fetch(`/api/purchase-orders/${po.id}`);
    const data = await r.json();
    setPo(data);
    setProcessing(false);
  };

  const handleSubmitOfferSheet = async () => {
    if (!po || !offerSheetInput.trim()) return;
    setSubmittingOfferSheet(true);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}/offer-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerSheetNumber: offerSheetInput.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setPo((prev) => (prev ? { ...prev, ...data } : null));
      }
    } catch (e) {
      console.error(e);
    }
    setSubmittingOfferSheet(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!po) {
    return (
      <div className="card text-center py-12">
        <p className="text-gray-500">Purchase order not found.</p>
      </div>
    );
  }

  const data = po.extractedData;
  const isPO = data?.isPurchaseOrder ?? false;
  const rawText = data?.rawText || po.aiAnalysis?.fullText || "";

  return (
    <div>
      <button
        onClick={() => navigate("/purchase-orders")}
        className="flex items-center text-sm text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft size={16} className="mr-1" />
        Back to Purchase Orders
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">PO Detail</h2>
          <p className="text-sm text-gray-500 mt-1">{po.subject}</p>
        </div>
        {po.status === "reviewed" && (
          <button
            onClick={handleSendToSAP}
            disabled={processing}
            className="btn-primary"
          >
            <Send size={16} className="mr-2" />
            {processing ? "Processing..." : "Create SAP SO"}
          </button>
        )}
        {po.status === "needs_offer_sheet" && (
          <span className="status-badge bg-orange-100 text-orange-800">Needs Offer Sheet</span>
        )}
      </div>

      <div className={`mb-6 p-4 rounded-lg border flex items-start gap-3 ${isPO ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
        {isPO ? (
          <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
        ) : (
          <XCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        )}
        <div className="flex-1">
          <p className={`text-sm font-medium ${isPO ? "text-green-800" : "text-amber-800"}`}>
            {isPO ? "Detected as a Purchase Order" : "Not recognized as a Purchase Order"}
          </p>
          <p className={`text-sm ${isPO ? "text-green-700" : "text-amber-700"}`}>
            Confidence: {Math.round((po.confidence || 0) * 100)}%
            {data?.reason ? ` — ${data.reason}` : ""}
          </p>
        </div>
      </div>

      {/* Offer Sheet Section */}
      <div className="card mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Offer Sheet Reference</h3>
        {po.status === "needs_offer_sheet" ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              No Offer Sheet reference number was detected in the PO document. Please enter it manually.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={offerSheetInput}
                onChange={(e) => setOfferSheetInput(e.target.value)}
                placeholder="e.g. 0130/ADPI/OS/04/2026"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                onClick={handleSubmitOfferSheet}
                disabled={submittingOfferSheet || !offerSheetInput.trim()}
                className="btn-primary"
              >
                {submittingOfferSheet ? "Submitting..." : "Submit & Process SO"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Offer Sheet Number</dt>
              <dd className="text-sm font-medium text-gray-900">{po.offerSheetNumber || "-"}</dd>
            </div>
            {po.sqDocNum && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">SAP SQ Reference</dt>
                <dd className="text-sm font-medium text-gray-900">
                  #{po.sqDocNum} (DocEntry: {po.sqDocEntry})
                </dd>
              </div>
            )}
            {po.sapDocNum && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">SAP SO Created</dt>
                <dd className="text-sm font-medium text-green-700">
                  #{po.sapDocNum} (DocEntry: {po.sapDocEntry})
                </dd>
              </div>
            )}
          </div>
        )}
      </div>

      {po.sapError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">SAP Error</p>
            <p className="text-sm text-red-600">{po.sapError}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Info</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">From</dt>
              <dd className="text-sm font-medium text-gray-900">
                {po.senderName || po.senderEmail}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Email</dt>
              <dd className="text-sm font-medium text-gray-900">{po.senderEmail}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Subject</dt>
              <dd className="text-sm font-medium text-gray-900">{po.subject}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Received</dt>
              <dd className="text-sm font-medium text-gray-900">
                {new Date(po.receivedAt).toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Status</dt>
              <dd className="text-sm font-medium text-gray-900 capitalize">{po.status}</dd>
            </div>
          </dl>
        </div>

        {data && isPO && (
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Extracted Data</h3>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Customer</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {data.customerName || "-"} ({data.customerCode || "no code"})
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">PO Number</dt>
                <dd className="text-sm font-medium text-gray-900">{data.poNumber || "-"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">PO Date</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {data.poDate ? new Date(data.poDate).toLocaleDateString() : "-"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Delivery Date</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {data.deliveryDate ? new Date(data.deliveryDate).toLocaleDateString() : "-"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Total</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {data.totalAmount ? `${data.currency || "$"}${data.totalAmount.toLocaleString()}` : "-"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Payment Terms</dt>
                <dd className="text-sm font-medium text-gray-900">{data.paymentTerms || "-"}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {data && data.items.length > 0 && (
        <div className="card mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Items</h3>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item Code</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">UOM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.items.map((item, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-2 text-sm text-gray-900">{item.itemCode || "-"}</td>
                  <td className="px-4 py-2 text-sm text-gray-900">{item.description || "-"}</td>
                  <td className="px-4 py-2 text-sm text-gray-900 text-right">{item.quantity}</td>
                  <td className="px-4 py-2 text-sm text-gray-900 text-right">
                    {item.unitPrice ? item.unitPrice.toLocaleString() : "-"}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-900">{item.uom || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="card mt-6">
          <button
            onClick={() => setShowExtractedJson((v) => !v)}
            className="flex items-center gap-2 text-lg font-semibold text-gray-900 w-full"
          >
            {showExtractedJson ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            <FileText size={18} className="text-gray-500" />
            Extracted JSON (SAP Payload)
          </button>
          {showExtractedJson && (
            <pre className="mt-4 p-4 bg-gray-50 rounded-lg text-xs text-gray-700 whitespace-pre-wrap break-words max-h-96 overflow-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>
      )}

      {rawText && (
        <div className="card mt-6">
          <button
            onClick={() => setShowRawText((v) => !v)}
            className="flex items-center gap-2 text-lg font-semibold text-gray-900 w-full"
          >
            {showRawText ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            <FileText size={18} className="text-gray-500" />
            Parsed Document Text
          </button>
          {showRawText && (
            <pre className="mt-4 p-4 bg-gray-50 rounded-lg text-xs text-gray-700 whitespace-pre-wrap break-words max-h-96 overflow-auto">
              {rawText}
            </pre>
          )}
        </div>
      )}

      {po.attachments.length > 0 && (
        <div className="card mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Attachments</h3>
          <div className="space-y-2">
            {po.attachments.map((att) => (
              <div key={att.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white rounded">
                    <span className="text-xs font-medium text-gray-600">
                      {att.contentType.split("/")[1]?.toUpperCase() || "FILE"}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">{att.filename}</p>
                      {att.isPoAttachment === true && (
                        <span className="status-badge bg-green-100 text-green-800 text-xs">PO</span>
                      )}
                      {att.isPoAttachment === false && (
                        <span className="status-badge bg-gray-100 text-gray-600 text-xs">Not PO</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{att.contentType}</p>
                  </div>
                </div>
                {att.size && (
                  <span className="text-xs text-gray-500">{(att.size / 1024).toFixed(1)} KB</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
