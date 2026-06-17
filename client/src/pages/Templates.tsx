import { useState, useEffect } from "react";
import { Plus, Trash2, FileText, Upload, Eye } from "lucide-react";
import PDFAnnotator from "../components/PDFAnnotator";

interface Template {
  id: number;
  name: string;
  description?: string;
  customerName?: string;
  senderEmail?: string;
  isActive: boolean;
  samplePdfPath?: string;
  createdAt: string;
  updatedAt: string;
}

interface Region {
  id: string;
  fieldName: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  prompt?: string;
}

interface Source {
  attachmentId: number;
  poId: number;
  filename: string;
  senderEmail?: string;
  senderName?: string;
  subject?: string;
  receivedAt?: string;
  customerName?: string;
  poNumber?: string;
}

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAnnotator, setShowAnnotator] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [reviewTemplate, setReviewTemplate] = useState<{ url: string; regions: Region[] } | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [sourceMode, setSourceMode] = useState<"upload" | "existing">("upload");
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);

  useEffect(() => {
    fetchTemplates();
    fetchSources();
  }, []);

  const fetchTemplates = async () => {
    try {
      const res = await fetch("http://localhost:3001/api/templates");
      const data = await res.json();
      setTemplates(data);
    } catch (error) {
      console.error("Failed to fetch templates:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSources = async () => {
    try {
      const res = await fetch("http://localhost:3001/api/templates/sources");
      const data = await res.json();
      setSources(data);
    } catch (error) {
      console.error("Failed to fetch sources:", error);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === "application/pdf") {
      setSelectedFile(file);
    }
  };

  const handleSelectSource = async (attachmentId: number) => {
    setSelectedSourceId(attachmentId);
    const source = sources.find((s) => s.attachmentId === attachmentId);
    if (!source) return;

    // Prepopulate fields from the upload's extracted data / metadata.
    setCustomerName(source.customerName || "");
    setSenderEmail(source.senderEmail && source.senderEmail !== "manual@upload.com" ? source.senderEmail : "");
    setTemplateName(
      source.customerName
        ? `${source.customerName} PO Template`
        : `Template - ${source.filename}`
    );
    setTemplateDescription(source.poNumber ? `Based on PO ${source.poNumber}` : "");

    // Fetch the stored PDF bytes and turn them into a File for the annotator.
    setLoadingSource(true);
    try {
      const res = await fetch(`http://localhost:3001/api/templates/sources/${attachmentId}/pdf`);
      const blob = await res.blob();
      const file = new File([blob], source.filename, { type: "application/pdf" });
      setSelectedFile(file);
    } catch (error) {
      console.error("Failed to load source PDF:", error);
      alert("Failed to load the selected PDF");
    } finally {
      setLoadingSource(false);
    }
  };

  const handleStartAnnotation = () => {
    if (!selectedFile || !templateName) {
      alert("Please select a PDF file and enter a template name");
      return;
    }
    setShowAnnotator(true);
  };

  const handleSaveTemplate = async (regions: Region[]) => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append("name", templateName);
    formData.append("description", templateDescription);
    formData.append("customerName", customerName);
    formData.append("senderEmail", senderEmail);
    formData.append("samplePdf", selectedFile);
    formData.append("regions", JSON.stringify(regions.map(r => ({
      fieldName: r.fieldName,
      pageNumber: r.pageNumber,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      prompt: r.prompt,
    }))));

    try {
      const res = await fetch("http://localhost:3001/api/templates", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        alert("Template saved successfully!");
        setShowAnnotator(false);
        setSelectedFile(null);
        setTemplateName("");
        setTemplateDescription("");
        setCustomerName("");
        setSenderEmail("");
        setSelectedSourceId(null);
        setSourceMode("upload");
        fetchTemplates();
      } else {
        alert("Failed to save template");
      }
    } catch (error) {
      console.error("Failed to save template:", error);
      alert("Failed to save template");
    }
  };

  const handleReview = async (template: Template) => {
    setReviewLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/api/templates/${template.id}`);
      const data = await res.json();
      const regions: Region[] = (data.regions || []).map((r: any) => ({
        id: `region-${r.id}`,
        fieldName: r.fieldName,
        pageNumber: r.pageNumber,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        prompt: r.prompt,
      }));
      setReviewTemplate({
        url: `http://localhost:3001/api/templates/${template.id}/pdf`,
        regions,
      });
    } catch (error) {
      console.error("Failed to load template for review:", error);
      alert("Failed to load template");
    } finally {
      setReviewLoading(false);
    }
  };

  const deleteTemplate = async (id: number) => {
    if (!confirm("Are you sure you want to delete this template?")) return;

    try {
      const res = await fetch(`http://localhost:3001/api/templates/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchTemplates();
      } else {
        alert("Failed to delete template");
      }
    } catch (error) {
      console.error("Failed to delete template:", error);
      alert("Failed to delete template");
    }
  };

  const toggleActive = async (template: Template) => {
    try {
      const res = await fetch(`http://localhost:3001/api/templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !template.isActive }),
      });

      if (res.ok) {
        fetchTemplates();
      }
    } catch (error) {
      console.error("Failed to update template:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading templates...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">PO Templates</h1>
          <p className="text-gray-600 mt-1">
            Create templates to improve PO extraction accuracy by marking specific regions
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Create New Template</h2>

        <div className="inline-flex rounded-lg border p-1 mb-4 bg-gray-50">
          <button
            onClick={() => setSourceMode("upload")}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              sourceMode === "upload" ? "bg-white shadow text-blue-700" : "text-gray-600"
            }`}
          >
            Upload new PDF
          </button>
          <button
            onClick={() => setSourceMode("existing")}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              sourceMode === "existing" ? "bg-white shadow text-blue-700" : "text-gray-600"
            }`}
          >
            Choose from uploaded POs
          </button>
        </div>

        {sourceMode === "existing" && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Select an uploaded PO</label>
            {sources.length === 0 ? (
              <div className="text-sm text-gray-500 border rounded-lg p-3">
                No uploaded PO PDFs found. Upload a PO from the Upload page first.
              </div>
            ) : (
              <select
                value={selectedSourceId ?? ""}
                onChange={(e) => handleSelectSource(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="" disabled>
                  -- Choose a PO PDF --
                </option>
                {sources.map((s) => (
                  <option key={s.attachmentId} value={s.attachmentId}>
                    {s.customerName ? `${s.customerName} — ` : ""}
                    {s.filename}
                    {s.poNumber ? ` (PO ${s.poNumber})` : ""}
                  </option>
                ))}
              </select>
            )}
            {loadingSource && (
              <div className="text-sm text-gray-500 mt-2">Loading PDF...</div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Template Name *</label>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="e.g., ADPI Standard PO"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Customer Name</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="e.g., ADPI"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <input
              type="text"
              value={templateDescription}
              onChange={(e) => setTemplateDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="Optional description"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Sender Email</label>
            <input
              type="email"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="e.g., orders@adpi.com"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-2">
              {sourceMode === "upload" ? "Sample PDF *" : "Selected PDF"}
            </label>
            <div className="flex items-center gap-4">
              {sourceMode === "upload" ? (
                <label className="flex-1 px-4 py-2 border-2 border-dashed rounded-lg cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors">
                  <div className="flex items-center justify-center gap-2 text-gray-600">
                    <Upload className="w-5 h-5" />
                    <span>{selectedFile ? selectedFile.name : "Choose PDF file"}</span>
                  </div>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="flex-1 px-4 py-2 border rounded-lg bg-gray-50 text-gray-600 flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  <span>{selectedFile ? selectedFile.name : "Select an uploaded PO above"}</span>
                </div>
              )}
              <button
                onClick={handleStartAnnotation}
                disabled={!selectedFile || !templateName || loadingSource}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Start Annotation
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold">Saved Templates ({templates.length})</h2>
        </div>
        <div className="divide-y">
          {templates.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No templates yet. Create your first template above.</p>
            </div>
          ) : (
            templates.map((template) => (
              <div key={template.id} className="p-6 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold">{template.name}</h3>
                      <span
                        className={`px-2 py-1 text-xs rounded-full ${
                          template.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {template.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                    {template.description && (
                      <p className="text-gray-600 mt-1">{template.description}</p>
                    )}
                    <div className="flex gap-4 mt-2 text-sm text-gray-500">
                      {template.customerName && (
                        <span>Customer: {template.customerName}</span>
                      )}
                      {template.senderEmail && (
                        <span>Email: {template.senderEmail}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-2">
                      Created: {new Date(template.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReview(template)}
                      disabled={reviewLoading}
                      className="px-3 py-1 text-sm rounded bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50 flex items-center gap-1"
                    >
                      <Eye className="w-4 h-4" />
                      Review
                    </button>
                    <button
                      onClick={() => toggleActive(template)}
                      className={`px-3 py-1 text-sm rounded ${
                        template.isActive
                          ? "bg-gray-100 hover:bg-gray-200"
                          : "bg-green-100 text-green-700 hover:bg-green-200"
                      }`}
                    >
                      {template.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => deleteTemplate(template.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showAnnotator && selectedFile && (
        <PDFAnnotator
          file={selectedFile}
          onSave={handleSaveTemplate}
          onCancel={() => setShowAnnotator(false)}
        />
      )}

      {reviewTemplate && (
        <PDFAnnotator
          file={reviewTemplate.url}
          initialRegions={reviewTemplate.regions}
          readOnly
          onCancel={() => setReviewTemplate(null)}
        />
      )}
    </div>
  );
}
