"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAdmin } from "@/components/AdminProvider";

interface UsageData {
  date: string;
  organization_id: string;
  organization_name?: string;
  source: string;
  endpoint: string;
  request_count: number;
  tokens_used: number;
}

interface DailySummary {
  date: string;
  total_requests: number;
  total_tokens: number;
}

interface Organization {
  id: string;
  name: string;
}

export default function UsageAdminPage() {
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdmin();
  const [usageData, setUsageData] = useState<UsageData[]>([]);
  const [dailySummary, setDailySummary] = useState<DailySummary[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [orgFilter, setOrgFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState<string>(() => {
    return new Date().toISOString().split("T")[0];
  });

  useEffect(() => {
    if (adminLoading) return;

    if (!isAdmin) {
      router.push("/");
      return;
    }

    loadOrganizations();
  }, [isAdmin, adminLoading, router]);

  useEffect(() => {
    if (!isAdmin) return;
    loadUsageData();
  }, [isAdmin, orgFilter, dateFrom, dateTo]);

  async function loadOrganizations() {
    const supabase = createClient();
    const { data } = await supabase
      .from("organizations")
      .select("id, name")
      .order("name");
    setOrganizations(data || []);
  }

  async function loadUsageData() {
    setLoading(true);
    try {
      const supabase = createClient();

      // Build query
      let query = supabase
        .from("usage_daily")
        .select(`
          date,
          organization_id,
          source,
          endpoint,
          request_count,
          tokens_used,
          organizations (name)
        `)
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date", { ascending: false });

      if (orgFilter !== "all") {
        query = query.eq("organization_id", orgFilter);
      }

      const { data } = await query;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enrichedData = (data || []).map((d: any) => ({
        ...d,
        organization_name: d.organizations?.name,
      }));

      setUsageData(enrichedData);

      // Calculate daily summary
      const summaryMap = new Map<string, DailySummary>();
      enrichedData.forEach((d) => {
        const existing = summaryMap.get(d.date) || {
          date: d.date,
          total_requests: 0,
          total_tokens: 0,
        };
        existing.total_requests += d.request_count || 0;
        existing.total_tokens += d.tokens_used || 0;
        summaryMap.set(d.date, existing);
      });

      setDailySummary(
        Array.from(summaryMap.values()).sort((a, b) => b.date.localeCompare(a.date))
      );
    } catch (err) {
      console.error("Error loading usage data:", err);
    } finally {
      setLoading(false);
    }
  }

  function exportCSV() {
    const headers = ["Date", "Organization", "Source", "Endpoint", "Requests", "Tokens"];
    const rows = usageData.map((d) => [
      d.date,
      d.organization_name || d.organization_id,
      d.source,
      d.endpoint,
      d.request_count,
      d.tokens_used,
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `usage-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalRequests = dailySummary.reduce((sum, d) => sum + d.total_requests, 0);
  const totalTokens = dailySummary.reduce((sum, d) => sum + d.total_tokens, 0);

  // Group by organization for the table
  const orgSummary = usageData.reduce(
    (acc, d) => {
      const key = d.organization_id;
      if (!acc[key]) {
        acc[key] = {
          organization_id: d.organization_id,
          organization_name: d.organization_name || "Unknown",
          total_requests: 0,
          total_tokens: 0,
        };
      }
      acc[key].total_requests += d.request_count || 0;
      acc[key].total_tokens += d.tokens_used || 0;
      return acc;
    },
    {} as Record<
      string,
      {
        organization_id: string;
        organization_name: string;
        total_requests: number;
        total_tokens: number;
      }
    >
  );

  if (adminLoading || loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-48 mb-8"></div>
        <div className="grid grid-cols-3 gap-6 mb-8">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-800 rounded-lg"></div>
          ))}
        </div>
        <div className="h-64 bg-gray-800 rounded-lg"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Usage Analytics</h1>
        <button
          onClick={exportCSV}
          disabled={usageData.length === 0}
          className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <select
          value={orgFilter}
          onChange={(e) => setOrgFilter(e.target.value)}
          className="px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
        >
          <option value="all">All Organizations</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">From:</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">To:</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gray-900 rounded-lg p-6">
          <p className="text-sm text-gray-400 mb-1">Total Requests</p>
          <p className="text-3xl font-bold">{totalRequests.toLocaleString()}</p>
          <p className="text-sm text-gray-400 mt-1">in selected period</p>
        </div>

        <div className="bg-gray-900 rounded-lg p-6">
          <p className="text-sm text-gray-400 mb-1">Total Tokens</p>
          <p className="text-3xl font-bold">{totalTokens.toLocaleString()}</p>
          <p className="text-sm text-gray-400 mt-1">consumed</p>
        </div>

        <div className="bg-gray-900 rounded-lg p-6">
          <p className="text-sm text-gray-400 mb-1">Active Organizations</p>
          <p className="text-3xl font-bold">{Object.keys(orgSummary).length}</p>
          <p className="text-sm text-gray-400 mt-1">with usage</p>
        </div>
      </div>

      {/* Usage by Organization */}
      <div className="bg-gray-900 rounded-lg overflow-hidden mb-8">
        <div className="px-4 py-3 bg-gray-800 border-b border-gray-700">
          <h2 className="font-semibold">Usage by Organization</h2>
        </div>
        <table className="w-full">
          <thead className="bg-gray-800/50">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">
                Organization
              </th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-400">
                Requests
              </th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-400">
                Tokens
              </th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-400">
                % of Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {Object.values(orgSummary)
              .sort((a, b) => b.total_requests - a.total_requests)
              .map((org) => (
                <tr key={org.organization_id} className="hover:bg-gray-800/50">
                  <td className="px-4 py-3">{org.organization_name}</td>
                  <td className="px-4 py-3 text-right">
                    {org.total_requests.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {org.total_tokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {totalRequests > 0
                      ? ((org.total_requests / totalRequests) * 100).toFixed(1)
                      : 0}
                    %
                  </td>
                </tr>
              ))}
            {Object.keys(orgSummary).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  No usage data for selected period
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Daily breakdown */}
      <div className="bg-gray-900 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-gray-800 border-b border-gray-700">
          <h2 className="font-semibold">Daily Breakdown</h2>
        </div>
        <table className="w-full">
          <thead className="bg-gray-800/50">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Date</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-400">
                Requests
              </th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-400">
                Tokens
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {dailySummary.slice(0, 30).map((day) => (
              <tr key={day.date} className="hover:bg-gray-800/50">
                <td className="px-4 py-3">{day.date}</td>
                <td className="px-4 py-3 text-right">
                  {day.total_requests.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {day.total_tokens.toLocaleString()}
                </td>
              </tr>
            ))}
            {dailySummary.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                  No usage data for selected period
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
