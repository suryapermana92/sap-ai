import { useEffect, useState } from "react";
import {
  CheckCircle,
  AlertCircle,
  Clock,
  FileText,
} from "lucide-react";

interface Stats {
  total: number;
  detected: number;
  analyzing: number;
  reviewed: number;
  needs_offer_sheet: number;
  processing: number;
  completed: number;
  error: number;
}

interface RecentPO {
  id: number;
  subject: string;
  status: string;
  offerSheetNumber?: string | null;
  sqDocNum?: number | null;
  sapDocNum?: number | null;
  sapError?: string | null;
  updatedAt: string;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<RecentPO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/stats").then((r) => r.json()),
      fetch("/api/purchase-orders")
        .then((r) => r.json())
        .then((data) => (data || []).slice(0, 10)),
    ])
      .then(([statsData, posData]) => {
        setStats(statsData);
        setRecent(posData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  const cards = [
    {
      title: "Total POs",
      value: stats?.total || 0,
      icon: FileText,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      title: "Completed",
      value: stats?.completed || 0,
      icon: CheckCircle,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      title: "Needs Offer Sheet",
      value: stats?.needs_offer_sheet || 0,
      icon: AlertCircle,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
    {
      title: "Errors",
      value: stats?.error || 0,
      icon: AlertCircle,
      color: "text-red-600",
      bg: "bg-red-50",
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {cards.map((card) => (
          <div key={card.title} className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{card.title}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{card.value}</p>
              </div>
              <div className={`p-3 rounded-lg ${card.bg}`}>
                <card.icon className={`w-6 h-6 ${card.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {recent.length === 0 ? (
              <p className="text-sm text-gray-500">No recent activity.</p>
            ) : (
              recent.map((po) => {
                let icon = FileText;
                let title = po.subject;
                let desc = `Status: ${po.status}`;
                let color = "text-gray-500";

                if (po.status === "completed") {
                  icon = CheckCircle;
                  desc = `SO #${po.sapDocNum} created`;
                  if (po.sqDocNum) {
                    desc += ` from SQ #${po.sqDocNum}`;
                  }
                  if (po.offerSheetNumber) {
                    desc += ` (Offer Sheet: ${po.offerSheetNumber})`;
                  }
                  color = "text-green-600";
                } else if (po.status === "needs_offer_sheet") {
                  icon = AlertCircle;
                  desc = "Waiting for Offer Sheet number";
                  color = "text-orange-600";
                } else if (po.status === "error") {
                  icon = AlertCircle;
                  desc = po.sapError || "Processing error";
                  color = "text-red-600";
                } else if (po.status === "processing") {
                  icon = Clock;
                  desc = "Processing in SAP...";
                  color = "text-yellow-600";
                }

                return (
                  <ActivityItem
                    key={po.id}
                    icon={icon}
                    title={title}
                    desc={desc}
                    time={po.updatedAt ? new Date(po.updatedAt).toLocaleString() : ""}
                    iconColor={color}
                  />
                );
              })
            )}
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">System Status</h3>
          <div className="space-y-4">
            <StatusRow label="Email Processor" status="running" />
            <StatusRow label="AI Analyzer" status="running" />
            <StatusRow label="SAP Connector" status="running" />
            <StatusRow label="Database" status="running" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityItem({
  icon: Icon,
  title,
  desc,
  time,
  iconColor = "text-primary-600",
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  time: string;
  iconColor?: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
      <div className="p-2 bg-primary-50 rounded-lg">
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="text-sm text-gray-500 truncate">{desc}</p>
      </div>
      <span className="text-xs text-gray-400 whitespace-nowrap">{time}</span>
    </div>
  );
}

function StatusRow({ label, status }: { label: string; status: "running" | "stopped" | "error" }) {
  const statusColors = {
    running: "bg-green-100 text-green-800",
    stopped: "bg-gray-100 text-gray-800",
    error: "bg-red-100 text-red-800",
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`status-badge ${statusColors[status]}`}>
        {status === "running" ? "Running" : status === "stopped" ? "Stopped" : "Error"}
      </span>
    </div>
  );
}
