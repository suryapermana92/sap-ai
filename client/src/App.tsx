import { Routes, Route, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Mail,
  Settings,
  Upload,
  ClipboardCheck,
  FileQuestion,
  FileType,
} from "lucide-react";
import Dashboard from "./pages/Dashboard";
import PurchaseOrders from "./pages/PurchaseOrders";
import PODetail from "./pages/PODetail";
import SettingsPage from "./pages/Settings";
import UploadPage from "./pages/Upload";
import NeedsOfferSheet from "./pages/NeedsOfferSheet";
import Templates from "./pages/Templates";

function App() {
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex-shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900">PO to SAP</h1>
        </div>
        <nav className="p-4 space-y-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <LayoutDashboard size={18} />
            Dashboard
          </NavLink>
          <NavLink
            to="/purchase-orders"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <Mail size={18} />
            All Emails
          </NavLink>
          <NavLink
            to="/detected-pos"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <ClipboardCheck size={18} />
            Detected POs
          </NavLink>
          <NavLink
            to="/needs-offer-sheet"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <FileQuestion size={18} />
            Needs Offer Sheet
          </NavLink>
          <NavLink
            to="/upload"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <Upload size={18} />
            Upload PO
          </NavLink>
          <NavLink
            to="/templates"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <FileType size={18} />
            Templates
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <Settings size={18} />
            Settings
          </NavLink>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/purchase-orders" element={<PurchaseOrders title="All Emails" />} />
            <Route
              path="/detected-pos"
              element={<PurchaseOrders detectedOnly title="Detected POs" />}
            />
            <Route path="/needs-offer-sheet" element={<NeedsOfferSheet />} />
            <Route path="/purchase-orders/:id" element={<PODetail />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default App;
