"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAdmin } from "@/components/AdminProvider";

interface AdminStats {
  totalOrganizations: number;
  activeOrganizations: number;
  pausedOrganizations: number;
  totalUsers: number;
  totalApiKeys: number;
  totalRequestsToday: number;
  totalRequestsMonth: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const { isAdmin, adminRole, loading: adminLoading } = useAdmin();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (adminLoading) return;

    if (!isAdmin) {
      router.push("/");
      return;
    }

    loadStats();
  }, [isAdmin, adminLoading, router]);

  async function loadStats() {
    try {
      const supabase = createClient();

      // Get organization stats
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, status");

      const totalOrganizations = orgs?.length || 0;
      const activeOrganizations = orgs?.filter((o) => o.status === "active" || o.status === null).length || 0;
      const pausedOrganizations = orgs?.filter((o) => o.status === "paused").length || 0;

      // Get user count (from organizations owners + members)
      const { count: userCount } = await supabase
        .from("organization_members")
        .select("user_id", { count: "exact", head: true });

      // Get API key count
      const { count: keyCount } = await supabase
        .from("api_keys")
        .select("id", { count: "exact", head: true });

      // Get today's requests
      const today = new Date().toISOString().split("T")[0];
      const { data: todayUsage } = await supabase
        .from("usage_daily")
        .select("request_count")
        .eq("date", today);

      const totalRequestsToday = todayUsage?.reduce((sum, u) => sum + (u.request_count || 0), 0) || 0;

      // Get this month's requests
      const monthStart = new Date();
      monthStart.setDate(1);
      const { data: monthUsage } = await supabase
        .from("usage_daily")
        .select("request_count")
        .gte("date", monthStart.toISOString().split("T")[0]);

      const totalRequestsMonth = monthUsage?.reduce((sum, u) => sum + (u.request_count || 0), 0) || 0;

      setStats({
        totalOrganizations,
        activeOrganizations,
        pausedOrganizations,
        totalUsers: userCount || 0,
        totalApiKeys: keyCount || 0,
        totalRequestsToday,
        totalRequestsMonth,
      });
    } catch (err) {
      console.error("Error loading admin stats:", err);
    } finally {
      setLoading(false);
    }
  }

  if (adminLoading || loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-48 mb-8"></div>
        <div className="grid grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-gray-800 rounded-lg"></div>
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
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <span className="text-xs px-2 py-1 bg-purple-900 text-purple-300 rounded">
          {adminRole === "super_admin" ? "Super Admin" : adminRole === "admin" ? "Admin" : "Support"}
        </span>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-gray-900 rounded-lg p-6">
          <p className="text-sm text-gray-400 mb-1">Organizations</p>
          <p className="text-3xl font-bold">{stats?.totalOrganizations.toLocaleString()}</p>
          <p className="text-sm text-gray-400 mt-1">
            {stats?.activeOrganizations} active, {stats?.pausedOrganizations} paused
          </p>
        </div>

        <div className="bg-gray-900 rounded-lg p-6">
          <p className="text-sm text-gray-400 mb-1">Total Users</p>
          <p className="text-3xl font-bold">{stats?.totalUsers.toLocaleString()}</p>
          <p className="text-sm text-gray-400 mt-1">org members</p>
        </div>

        <div className="bg-gray-900 rounded-lg p-6">
          <p className="text-sm text-gray-400 mb-1">API Keys</p>
          <p className="text-3xl font-bold">{stats?.totalApiKeys.toLocaleString()}</p>
          <p className="text-sm text-gray-400 mt-1">active keys</p>
        </div>

        <div className="bg-gray-900 rounded-lg p-6">
          <p className="text-sm text-gray-400 mb-1">Requests Today</p>
          <p className="text-3xl font-bold">{stats?.totalRequestsToday.toLocaleString()}</p>
          <p className="text-sm text-gray-400 mt-1">
            {stats?.totalRequestsMonth.toLocaleString()} this month
          </p>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <a
          href="/admin/organizations"
          className="bg-gray-900 rounded-lg p-6 hover:bg-gray-800 transition group"
        >
          <h3 className="font-semibold mb-2 group-hover:text-purple-400 transition">
            Manage Organizations
          </h3>
          <p className="text-sm text-gray-400">
            View, pause, or revoke organization access. Change subscription tiers.
          </p>
        </a>

        <a
          href="/admin/users"
          className="bg-gray-900 rounded-lg p-6 hover:bg-gray-800 transition group"
        >
          <h3 className="font-semibold mb-2 group-hover:text-purple-400 transition">
            Manage Users
          </h3>
          <p className="text-sm text-gray-400">
            View users, manage organization memberships, invite new users.
          </p>
        </a>

        <a
          href="/admin/usage"
          className="bg-gray-900 rounded-lg p-6 hover:bg-gray-800 transition group"
        >
          <h3 className="font-semibold mb-2 group-hover:text-purple-400 transition">
            Usage Analytics
          </h3>
          <p className="text-sm text-gray-400">
            View global usage stats, filter by organization or date range.
          </p>
        </a>

        <a
          href="/admin/invites"
          className="bg-gray-900 rounded-lg p-6 hover:bg-gray-800 transition group"
        >
          <h3 className="font-semibold mb-2 group-hover:text-purple-400 transition">
            Invites
          </h3>
          <p className="text-sm text-gray-400">
            Create and manage user invitations to organizations.
          </p>
        </a>

        <a
          href="/admin/audit"
          className="bg-gray-900 rounded-lg p-6 hover:bg-gray-800 transition group"
        >
          <h3 className="font-semibold mb-2 group-hover:text-purple-400 transition">
            Audit Log
          </h3>
          <p className="text-sm text-gray-400">
            View all admin actions and changes made to the system.
          </p>
        </a>
      </div>
    </div>
  );
}
