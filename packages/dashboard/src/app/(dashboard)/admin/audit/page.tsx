"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAdmin } from "@/components/AdminProvider";

interface AuditLogEntry {
  id: string;
  admin_user_id: string;
  admin_email?: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export default function AuditLogPage() {
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdmin();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [targetFilter, setTargetFilter] = useState<string>("all");

  // Pagination
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 50;

  useEffect(() => {
    if (adminLoading) return;

    if (!isAdmin) {
      router.push("/");
      return;
    }

    loadLogs();
  }, [isAdmin, adminLoading, router, page, actionFilter, targetFilter]);

  async function loadLogs() {
    setLoading(true);
    try {
      const supabase = createClient();

      let query = supabase
        .from("admin_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }

      if (targetFilter !== "all") {
        query = query.eq("target_type", targetFilter);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error loading audit logs:", error);
        setLogs([]);
        return;
      }

      setLogs(data || []);
      setHasMore((data?.length || 0) === pageSize);
    } catch (err) {
      console.error("Error loading audit logs:", err);
    } finally {
      setLoading(false);
    }
  }

  const filteredLogs = logs.filter((log) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      log.action.toLowerCase().includes(searchLower) ||
      log.target_type.toLowerCase().includes(searchLower) ||
      log.target_id?.toLowerCase().includes(searchLower) ||
      log.admin_user_id.toLowerCase().includes(searchLower) ||
      JSON.stringify(log.details).toLowerCase().includes(searchLower)
    );
  });

  const uniqueActions = Array.from(new Set(logs.map((l) => l.action)));
  const uniqueTargets = Array.from(new Set(logs.map((l) => l.target_type)));

  const getActionColor = (action: string) => {
    if (action.includes("revoke") || action.includes("delete") || action.includes("remove")) {
      return "text-red-400";
    }
    if (action.includes("pause") || action.includes("suspend")) {
      return "text-yellow-400";
    }
    if (action.includes("create") || action.includes("add") || action.includes("resume")) {
      return "text-green-400";
    }
    if (action.includes("change") || action.includes("update")) {
      return "text-blue-400";
    }
    return "text-gray-300";
  };

  const formatAction = (action: string) => {
    return action.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  if (adminLoading || loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-48 mb-8"></div>
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-gray-800 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">Audit Log</h1>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <input
          type="text"
          placeholder="Search logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-md px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
        />
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(0);
          }}
          className="px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
        >
          <option value="all">All Actions</option>
          {uniqueActions.map((action) => (
            <option key={action} value={action}>
              {formatAction(action)}
            </option>
          ))}
        </select>
        <select
          value={targetFilter}
          onChange={(e) => {
            setTargetFilter(e.target.value);
            setPage(0);
          }}
          className="px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
        >
          <option value="all">All Targets</option>
          {uniqueTargets.map((target) => (
            <option key={target} value={target}>
              {target.charAt(0).toUpperCase() + target.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Logs list */}
      <div className="space-y-2">
        {filteredLogs.length === 0 ? (
          <div className="bg-gray-900 rounded-lg p-8 text-center text-gray-400">
            No audit logs found
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="bg-gray-900 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className={`font-medium ${getActionColor(log.action)}`}>
                      {formatAction(log.action)}
                    </span>
                    <span className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded text-xs">
                      {log.target_type}
                    </span>
                  </div>
                  <div className="text-sm text-gray-400 mt-1">
                    <span className="font-mono text-xs">{log.admin_user_id}</span>
                    {log.target_id && (
                      <>
                        <span className="mx-2">on</span>
                        <span className="font-mono text-xs">{log.target_id}</span>
                      </>
                    )}
                  </div>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <div className="mt-2 p-2 bg-gray-800 rounded text-xs font-mono overflow-x-auto">
                      {Object.entries(log.details).map(([key, value]) => (
                        <div key={key} className="text-gray-400">
                          <span className="text-gray-500">{key}:</span>{" "}
                          <span className="text-gray-300">
                            {typeof value === "object" ? JSON.stringify(value) : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right text-sm text-gray-400 whitespace-nowrap ml-4">
                  <div>{new Date(log.created_at).toLocaleDateString()}</div>
                  <div>{new Date(log.created_at).toLocaleTimeString()}</div>
                  {log.ip_address && (
                    <div className="text-xs text-gray-500">{log.ip_address}</div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {(page > 0 || hasMore) && (
        <div className="flex justify-center gap-4 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-gray-400">Page {page + 1}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
            className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
