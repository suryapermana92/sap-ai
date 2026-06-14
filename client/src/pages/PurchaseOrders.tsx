import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Trash2, RefreshCw } from "lucide-react";

interface PO {
  id: number;
  senderEmail: string;
  senderName: string;
  subject: string;
  status: string;
  confidence: number;
  receivedAt: string;
  offerSheetNumber?: string | null;
  sqDocNum?: number | null;
  sapDocNum?: number | null;
}

const statusColors: Record<string, string> = {
  detected: "bg-gray-100 text-gray-800",
  analyzing: "bg-blue-100 text-blue-800",
  reviewed: "bg-purple-100 text-purple-800",
  needs_offer_sheet: "bg-orange-100 text-orange-800",
  processing: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
};

interface PurchaseOrdersProps {
  detectedOnly?: boolean;
  title?: string;
}

export default function PurchaseOrders({ detectedOnly = false, title = "Purchase Orders" }: PurchaseOrdersProps) {
  const [pos, setPos] = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reanalyzing, setReanalyzing] = useState(false);

  const apiUrl = detectedOnly ? "/api/purchase-orders?detected=true" : "/api/purchase-orders";

  const fetchPOs = (showLoader = true) => {
    if (showLoader) setLoading(true);
    fetch(apiUrl)
      .then((r) => r.json())
      .then((data) => {
        setPos(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchPOs();
    // Silently auto-refresh so newly detected emails appear without manual refresh.
    const interval = setInterval(() => fetchPOs(false), 30000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this record?")) return;
    await fetch(`/api/purchase-orders/${id}`, { method: "DELETE" });
    fetchPOs();
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === pos.length ? new Set() : new Set(pos.map((p) => p.id))));
  };

  const handleReanalyze = async () => {
    if (selected.size === 0) return;
    setReanalyzing(true);
    await Promise.all(
      Array.from(selected).map((id) =>
        fetch(`/api/purchase-orders/${id}/reanalyze`, { method: "POST" }).catch(() => null)
      )
    );
    setSelected(new Set());
    setReanalyzing(false);
    fetchPOs(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button onClick={handleReanalyze} disabled={reanalyzing} className="btn-primary">
              <RefreshCw size={16} className={`mr-2 ${reanalyzing ? "animate-spin" : ""}`} />
              {reanalyzing ? "Re-analyzing..." : `Re-analyze (${selected.size})`}
            </button>
          )}
          <button onClick={() => fetchPOs()} className="btn-secondary">
            <RefreshCw size={16} className="mr-2" />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : pos.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">
            {detectedOnly ? "No detected purchase orders yet." : "No purchase orders found yet."}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            Connect an email account or upload a PO to get started.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left sticky left-0 z-20 bg-gray-50">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
                    checked={pos.length > 0 && selected.size === pos.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-16 z-20 bg-gray-50 border-r border-gray-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                  From
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Subject
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Confidence
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Offer Sheet
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  SAP SQ
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  SAP SO
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Received
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {pos.map((po) => (
                <tr key={po.id} className="hover:bg-gray-50 group">
                  <td className="px-6 py-4 whitespace-nowrap sticky left-0 z-10 bg-white group-hover:bg-gray-50">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={selected.has(po.id)}
                      onChange={() => toggleSelect(po.id)}
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap sticky left-16 z-10 bg-white group-hover:bg-gray-50 border-r border-gray-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                    <div className="text-sm font-medium text-gray-900">
                      {po.senderName || po.senderEmail}
                    </div>
                    <div className="text-sm text-gray-500">{po.senderEmail}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900 max-w-xs truncate">
                      {po.subject}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`status-badge ${statusColors[po.status] || "bg-gray-100 text-gray-800"}`}>
                      {po.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {po.confidence ? (
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-primary-500 h-2 rounded-full"
                            style={{ width: `${Math.round(po.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600">
                          {Math.round(po.confidence * 100)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {po.offerSheetNumber || "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {po.sqDocNum ? `#${po.sqDocNum}` : "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {po.sapDocNum ? `#${po.sapDocNum}` : "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(po.receivedAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Link
                      to={`/purchase-orders/${po.id}`}
                      className="text-primary-600 hover:text-primary-900 mr-3"
                    >
                      <Eye size={18} />
                    </Link>
                    <button
                      onClick={() => handleDelete(po.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
