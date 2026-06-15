import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Send, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";

interface PO {
  id: number;
  senderEmail: string;
  senderName: string;
  subject: string;
  status: string;
  receivedAt: string;
  offerSheetNumber?: string | null;
}

interface Attachment {
  id: number;
  filename: string;
  contentType: string;
}

interface PoDetail extends PO {
  attachments: Attachment[];
}

// Same shape the AI extractor and SAP lookup expect.
const OFFER_SHEET_REGEX = /^\d{3,4}\/ADPI\/OS\/\d{2}\/\d{4}$/;
const OFFER_SHEET_PLACEHOLDER = "e.g. 0130/ADPI/OS/04/2026";

type RowState = {
  value: string;
  submitting: boolean;
  error: string | null;
  success: boolean;
};

export default function NeedsOfferSheet() {
  const [rows, setRows] = useState<PoDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowState, setRowState] = useState<Record<number, RowState>>({});

  const fetchRows = async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const listRes = await fetch("/api/purchase-orders");
      const list: PO[] = await listRes.json();
      const pending = list.filter((p) => p.status === "needs_offer_sheet");

      // Fetch each PO's detail so we can show attachment filenames — the bulk list
      // endpoint doesn't include them. Done in parallel; the queue is small in
      // practice (only POs awaiting manual offer-sheet entry).
      const details = await Promise.all(
        pending.map((p) =>
          fetch(`/api/purchase-orders/${p.id}`)
            .then((r) => r.json())
            .then((d): PoDetail => ({ ...p, attachments: d.attachments || [] }))
            .catch((): PoDetail => ({ ...p, attachments: [] }))
        )
      );

      setRows(details);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
    // Auto-refresh so newly-detected POs needing input appear without manual reload.
    const interval = setInterval(() => fetchRows(false), 30000);
    return () => clearInterval(interval);
  }, []);

  const defaultRow = (): RowState => ({ value: "", submitting: false, error: null, success: false });

  const updateRow = (id: number, patch: Partial<RowState>) => {
    setRowState((prev) => ({
      ...prev,
      [id]: { ...defaultRow(), ...prev[id], ...patch },
    }));
  };

  const validate = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return "Required";
    if (!OFFER_SHEET_REGEX.test(trimmed)) return "Format: XXXX/ADPI/OS/MM/YYYY";
    return null;
  };

  const submit = async (id: number) => {
    const state = rowState[id];
    const value = state?.value?.trim() ?? "";
    const error = validate(value);
    if (error) {
      updateRow(id, { error });
      return;
    }

    updateRow(id, { submitting: true, error: null });
    try {
      const res = await fetch(`/api/purchase-orders/${id}/offer-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerSheetNumber: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Save failed (${res.status})`);
      }
      updateRow(id, { submitting: false, success: true });
      // The row is now in 'processing' status — drop it from the local list
      // immediately so the operator sees progress; auto-refresh will reconcile.
      setTimeout(() => {
        setRows((prev) => prev.filter((r) => r.id !== id));
      }, 600);
    } catch (e: any) {
      updateRow(id, { submitting: false, error: e?.message || "Save failed" });
    }
  };

  const remainingCount = useMemo(() => rows.length, [rows]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Needs Offer Sheet</h2>
          <p className="text-sm text-gray-500 mt-1">
            POs that were detected but the AI could not find an Offer Sheet reference.
            Enter the value from the source document and the SAP SO will be created automatically.
          </p>
        </div>
        <button onClick={() => fetchRows()} className="btn-secondary">
          <RefreshCw size={16} className="mr-2" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : remainingCount === 0 ? (
        <div className="card text-center py-12">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">All caught up.</p>
          <p className="text-sm text-gray-500 mt-1">
            No POs are waiting for a manual Offer Sheet number.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-200">
          {rows.map((row) => {
            const state = rowState[row.id] ?? { value: "", submitting: false, error: null, success: false };
            const poFiles = row.attachments.length
              ? row.attachments.map((a) => a.filename).join(", ")
              : "(no attachment)";

            return (
              <div key={row.id} className="p-4 hover:bg-gray-50">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                  <div className="md:col-span-5 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate" title={row.subject}>
                      {row.subject || "(no subject)"}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate" title={row.senderEmail}>
                      {row.senderName || row.senderEmail}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate" title={poFiles}>
                      {poFiles}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {new Date(row.receivedAt).toLocaleString()}
                    </div>
                    <Link
                      to={`/purchase-orders/${row.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 mt-1"
                    >
                      Open detail <ExternalLink size={11} />
                    </Link>
                  </div>

                  <div className="md:col-span-5">
                    <input
                      type="text"
                      value={state.value}
                      onChange={(e) => updateRow(row.id, { value: e.target.value, error: null })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submit(row.id);
                      }}
                      placeholder={OFFER_SHEET_PLACEHOLDER}
                      disabled={state.submitting || state.success}
                      className={`w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 ${
                        state.error
                          ? "border-red-300 focus:ring-red-500"
                          : state.success
                          ? "border-green-300 bg-green-50"
                          : "border-gray-300 focus:ring-primary-500"
                      }`}
                    />
                    {state.error && (
                      <div className="flex items-center gap-1 text-xs text-red-600 mt-1">
                        <AlertCircle size={12} />
                        {state.error}
                      </div>
                    )}
                    {state.success && (
                      <div className="flex items-center gap-1 text-xs text-green-600 mt-1">
                        <CheckCircle2 size={12} />
                        Saved — sending to SAP
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-2 flex md:justify-end">
                    <button
                      onClick={() => submit(row.id)}
                      disabled={state.submitting || state.success || !state.value.trim()}
                      className="btn-primary w-full md:w-auto"
                    >
                      <Send size={14} className="mr-2" />
                      {state.submitting ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
