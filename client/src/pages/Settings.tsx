import { useEffect, useState } from "react";
import {
  Save,
  Trash2,
  Mail,
  Server,
  Link as LinkIcon,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";

interface EmailAccount {
  id: number;
  provider: string;
  email: string;
  isActive: boolean;
}

interface SAPConnection {
  id: number;
  name: string;
  serviceLayerUrl: string;
  companyDB: string;
  isActive: boolean;
  lastConnectedAt?: string | null;
}

type ConnectionTestState = {
  status: "idle" | "testing" | "ok" | "failed";
  message?: string;
  testedAt?: number;
};

export default function SettingsPage() {
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [sapConnections, setSapConnections] = useState<SAPConnection[]>([]);
  const [imapForm, setImapForm] = useState({
    email: "",
    imapHost: "",
    imapPort: "993",
    imapSecure: true,
    imapUsername: "",
    imapPassword: "",
  });
  const [sapForm, setSapForm] = useState({
    name: "",
    serviceLayerUrl: "",
    companyDB: "",
    username: "",
    password: "",
  });
  const [testStates, setTestStates] = useState<Record<number, ConnectionTestState>>({});
  const [sapSaveError, setSapSaveError] = useState<string | null>(null);
  const [sapSaving, setSapSaving] = useState(false);

  const fetchData = () => {
    fetch("/api/email/accounts")
      .then((r) => r.json())
      .then(setEmailAccounts);
    fetch("/api/sap/connections")
      .then((r) => r.json())
      .then(setSapConnections);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const addImapAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/email/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "imap",
        email: imapForm.email,
        imapHost: imapForm.imapHost,
        imapPort: Number(imapForm.imapPort),
        imapSecure: imapForm.imapSecure,
        imapUsername: imapForm.imapUsername,
        imapPassword: imapForm.imapPassword,
      }),
    });
    setImapForm({ email: "", imapHost: "", imapPort: "993", imapSecure: true, imapUsername: "", imapPassword: "" });
    fetchData();
  };

  const addSAPConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    setSapSaveError(null);
    setSapSaving(true);
    try {
      const res = await fetch("/api/sap/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sapForm),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || `Save failed (${res.status})`);
      }
      setSapForm({ name: "", serviceLayerUrl: "", companyDB: "", username: "", password: "" });
      fetchData();
    } catch (err: any) {
      setSapSaveError(err?.message || "Save failed");
    }
    setSapSaving(false);
  };

  const deleteEmail = async (id: number) => {
    await fetch(`/api/email/accounts/${id}`, { method: "DELETE" });
    fetchData();
  };

  const deleteSAP = async (id: number) => {
    await fetch(`/api/sap/connections/${id}`, { method: "DELETE" });
    fetchData();
  };

  const testSAP = async (id: number) => {
    setTestStates((prev) => ({ ...prev, [id]: { status: "testing" } }));
    try {
      const res = await fetch(`/api/sap/connections/${id}/test`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      const ok = res.ok && body?.success === true;
      setTestStates((prev) => ({
        ...prev,
        [id]: {
          status: ok ? "ok" : "failed",
          message: body?.message || (ok ? "Connected" : `HTTP ${res.status}`),
          testedAt: Date.now(),
        },
      }));
      if (ok) fetchData();
    } catch (e: any) {
      setTestStates((prev) => ({
        ...prev,
        [id]: { status: "failed", message: e?.message || "Network error", testedAt: Date.now() },
      }));
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Settings</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Email Accounts */}
        <div>
          <div className="card mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Mail size={20} className="text-primary-600" />
              <h3 className="text-lg font-semibold text-gray-900">Email Accounts</h3>
            </div>

            {emailAccounts.length > 0 && (
              <div className="mb-4 space-y-2">
                {emailAccounts.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{acc.email}</p>
                      <p className="text-xs text-gray-500 capitalize">{acc.provider}</p>
                    </div>
                    <button onClick={() => deleteEmail(acc.id)} className="text-red-600 hover:text-red-900">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <h4 className="text-sm font-medium text-gray-700 mb-3">Add IMAP Account</h4>
            <form onSubmit={addImapAccount} className="space-y-3">
              <div>
                <label className="label">Email Address</label>
                <input className="input" value={imapForm.email} onChange={(e) => setImapForm({ ...imapForm, email: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">IMAP Host</label>
                  <input className="input" value={imapForm.imapHost} onChange={(e) => setImapForm({ ...imapForm, imapHost: e.target.value })} placeholder="imap.gmail.com" required />
                </div>
                <div>
                  <label className="label">Port</label>
                  <input className="input" value={imapForm.imapPort} onChange={(e) => setImapForm({ ...imapForm, imapPort: e.target.value })} required />
                </div>
              </div>
              <div>
                <label className="label">Username</label>
                <input className="input" value={imapForm.imapUsername} onChange={(e) => setImapForm({ ...imapForm, imapUsername: e.target.value })} required />
              </div>
              <div>
                <label className="label">Password / App Password</label>
                <input type="password" className="input" value={imapForm.imapPassword} onChange={(e) => setImapForm({ ...imapForm, imapPassword: e.target.value })} required />
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={imapForm.imapSecure} onChange={(e) => setImapForm({ ...imapForm, imapSecure: e.target.checked })} />
                <span className="text-sm text-gray-600">Use SSL/TLS</span>
              </label>
              <button type="submit" className="btn-primary w-full">
                <Save size={16} className="mr-2" />
                Add IMAP Account
              </button>
            </form>

            <div className="mt-4 pt-4 border-t border-gray-200">
              <a href="/api/email/auth/google" className="btn-secondary w-full">
                <LinkIcon size={16} className="mr-2" />
                Connect Gmail Account
              </a>
            </div>
          </div>
        </div>

        {/* SAP Connections */}
        <div>
          <div className="card mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Server size={20} className="text-primary-600" />
              <h3 className="text-lg font-semibold text-gray-900">SAP B1 Connections</h3>
            </div>

            {sapConnections.length > 0 && (
              <div className="mb-4 space-y-2">
                {sapConnections.map((conn) => {
                  const ts = testStates[conn.id];
                  const lastConnected = conn.lastConnectedAt
                    ? new Date(conn.lastConnectedAt).toLocaleString()
                    : null;
                  return (
                    <div key={conn.id} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{conn.name}</p>
                          <p className="text-xs text-gray-500 truncate">{conn.serviceLayerUrl}</p>
                          <p className="text-xs text-gray-400">DB: {conn.companyDB}</p>
                          {lastConnected && (
                            <p className="text-xs text-gray-400 mt-1">
                              Last connected: {lastConnected}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => testSAP(conn.id)}
                            disabled={ts?.status === "testing"}
                            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1 disabled:opacity-50"
                            title="Run /Login against the SAP B1 Service Layer"
                          >
                            <RefreshCw
                              size={12}
                              className={ts?.status === "testing" ? "animate-spin" : ""}
                            />
                            {ts?.status === "testing" ? "Testing..." : "Test"}
                          </button>
                          <button
                            onClick={() => deleteSAP(conn.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      {ts && ts.status !== "idle" && ts.status !== "testing" && (
                        <div
                          className={`mt-2 flex items-start gap-2 text-xs px-2 py-1.5 rounded ${
                            ts.status === "ok"
                              ? "bg-green-50 text-green-700 border border-green-200"
                              : "bg-red-50 text-red-700 border border-red-200"
                          }`}
                        >
                          {ts.status === "ok" ? (
                            <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                          ) : (
                            <XCircle size={12} className="mt-0.5 shrink-0" />
                          )}
                          <span className="break-words">{ts.message}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <h4 className="text-sm font-medium text-gray-700 mb-3">Add SAP Connection</h4>
            <form onSubmit={addSAPConnection} className="space-y-3">
              <div>
                <label className="label">Connection Name</label>
                <input className="input" value={sapForm.name} onChange={(e) => setSapForm({ ...sapForm, name: e.target.value })} placeholder="Production SAP" required />
              </div>
              <div>
                <label className="label">Service Layer URL</label>
                <input className="input" value={sapForm.serviceLayerUrl} onChange={(e) => setSapForm({ ...sapForm, serviceLayerUrl: e.target.value })} placeholder="https://server:50000/b1s/v1" required />
              </div>
              <div>
                <label className="label">Company Database</label>
                <input className="input" value={sapForm.companyDB} onChange={(e) => setSapForm({ ...sapForm, companyDB: e.target.value })} placeholder="SBODemoUS" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Username</label>
                  <input className="input" value={sapForm.username} onChange={(e) => setSapForm({ ...sapForm, username: e.target.value })} required />
                </div>
                <div>
                  <label className="label">Password</label>
                  <input type="password" className="input" value={sapForm.password} onChange={(e) => setSapForm({ ...sapForm, password: e.target.value })} required />
                </div>
              </div>
              {sapSaveError && (
                <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 flex items-start gap-2">
                  <XCircle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Could not save</p>
                    <p className="break-words">{sapSaveError}</p>
                    <p className="text-xs text-red-600 mt-1">
                      The server tries to log in to SAP before saving. If the Service Layer
                      isn't reachable from this machine (firewall, VPN required, server down),
                      the save is rejected.
                    </p>
                  </div>
                </div>
              )}
              <button
                type="submit"
                disabled={sapSaving}
                className="btn-primary w-full disabled:opacity-50"
              >
                <Save size={16} className="mr-2" />
                {sapSaving ? "Testing & saving..." : "Add SAP Connection"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
