"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAdmin, canManage } from "@/components/AdminProvider";
import { useAuth } from "@/components/AuthProvider";

interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  owner_email?: string;
  status: "active" | "paused" | "suspended" | "revoked" | null;
  subscription_tier_id: string;
  subscription_status: string;
  created_at: string;
  member_count?: number;
  api_key_count?: number;
  monthly_usage?: number;
}

interface Tier {
  id: string;
  name: string;
  monthly_token_limit: number | null;
}

export default function OrganizationsAdminPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { isAdmin, adminRole, loading: adminLoading } = useAdmin();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");

  // Modal states
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [showTierModal, setShowTierModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [newTier, setNewTier] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Create org form
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgTier, setNewOrgTier] = useState("free");

  useEffect(() => {
    if (adminLoading) return;

    if (!isAdmin) {
      router.push("/");
      return;
    }

    loadData();
  }, [isAdmin, adminLoading, router]);

  async function loadData() {
    try {
      const supabase = createClient();

      // Load tiers
      const { data: tierData } = await supabase
        .from("subscription_tiers")
        .select("id, name, monthly_token_limit")
        .order("monthly_price_cents");

      setTiers(tierData || []);

      // Load organizations with additional data
      const { data: orgsData } = await supabase
        .from("organizations")
        .select(`
          id,
          name,
          slug,
          owner_user_id,
          status,
          subscription_tier_id,
          subscription_status,
          created_at
        `)
        .order("created_at", { ascending: false });

      if (orgsData) {
        // Enrich with member counts and usage
        const enrichedOrgs = await Promise.all(
          orgsData.map(async (org) => {
            // Get member count
            const { count: memberCount } = await supabase
              .from("organization_members")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", org.id);

            // Get API key count
            const { count: keyCount } = await supabase
              .from("api_keys")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", org.id)
              .eq("is_active", true);

            // Get monthly usage
            const monthStart = new Date();
            monthStart.setDate(1);
            const { data: usageData } = await supabase
              .from("usage_daily")
              .select("request_count")
              .eq("organization_id", org.id)
              .gte("date", monthStart.toISOString().split("T")[0]);

            const monthlyUsage = usageData?.reduce((sum, u) => sum + (u.request_count || 0), 0) || 0;

            return {
              ...org,
              member_count: memberCount || 0,
              api_key_count: keyCount || 0,
              monthly_usage: monthlyUsage,
            };
          })
        );

        setOrganizations(enrichedOrgs);
      }
    } catch (err) {
      console.error("Error loading organizations:", err);
    } finally {
      setLoading(false);
    }
  }

  async function logAdminAction(action: string, targetId: string, details: Record<string, unknown>) {
    const supabase = createClient();
    await supabase.from("admin_audit_log").insert({
      admin_user_id: user?.id,
      action,
      target_type: "organization",
      target_id: targetId,
      details,
    });
  }

  async function handleCreateOrg() {
    if (!newOrgName.trim() || !canManage(adminRole)) return;

    setActionLoading(true);
    try {
      const supabase = createClient();
      const slug = newOrgName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") + "-" + Date.now();

      const { data: newOrg, error } = await supabase
        .from("organizations")
        .insert({
          name: newOrgName.trim(),
          slug,
          owner_user_id: user?.id,
          subscription_tier_id: newOrgTier,
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating organization:", error);
        alert("Failed to create organization: " + error.message);
        return;
      }

      await logAdminAction("create_organization", newOrg.id, {
        name: newOrgName,
        tier: newOrgTier,
      });

      setShowCreateModal(false);
      setNewOrgName("");
      setNewOrgTier("free");
      loadData();
    } catch (err) {
      console.error("Error creating organization:", err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePause() {
    if (!selectedOrg || !canManage(adminRole)) return;

    setActionLoading(true);
    try {
      const supabase = createClient();
      await supabase
        .from("organizations")
        .update({
          status: "paused",
          paused_at: new Date().toISOString(),
          paused_by: user?.id,
          pause_reason: pauseReason,
        })
        .eq("id", selectedOrg.id);

      await logAdminAction("pause_organization", selectedOrg.id, {
        reason: pauseReason,
        previous_status: selectedOrg.status,
      });

      setShowPauseModal(false);
      setPauseReason("");
      loadData();
    } catch (err) {
      console.error("Error pausing organization:", err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResume(org: Organization) {
    if (!canManage(adminRole)) return;

    setActionLoading(true);
    try {
      const supabase = createClient();
      await supabase
        .from("organizations")
        .update({
          status: "active",
          paused_at: null,
          paused_by: null,
          pause_reason: null,
        })
        .eq("id", org.id);

      await logAdminAction("resume_organization", org.id, {
        previous_status: org.status,
      });

      loadData();
    } catch (err) {
      console.error("Error resuming organization:", err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRevoke() {
    if (!selectedOrg || !canManage(adminRole)) return;

    setActionLoading(true);
    try {
      const supabase = createClient();
      await supabase
        .from("organizations")
        .update({
          status: "revoked",
          revoked_at: new Date().toISOString(),
          revoked_by: user?.id,
          revoke_reason: revokeReason,
        })
        .eq("id", selectedOrg.id);

      await logAdminAction("revoke_organization", selectedOrg.id, {
        reason: revokeReason,
        previous_status: selectedOrg.status,
      });

      setShowRevokeModal(false);
      setRevokeReason("");
      loadData();
    } catch (err) {
      console.error("Error revoking organization:", err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleChangeTier() {
    if (!selectedOrg || !canManage(adminRole) || !newTier) return;

    setActionLoading(true);
    try {
      const supabase = createClient();
      await supabase
        .from("organizations")
        .update({ subscription_tier_id: newTier })
        .eq("id", selectedOrg.id);

      await logAdminAction("change_tier", selectedOrg.id, {
        previous_tier: selectedOrg.subscription_tier_id,
        new_tier: newTier,
      });

      setShowTierModal(false);
      setNewTier("");
      loadData();
    } catch (err) {
      console.error("Error changing tier:", err);
    } finally {
      setActionLoading(false);
    }
  }

  const filteredOrgs = organizations.filter((org) => {
    const matchesSearch =
      org.name.toLowerCase().includes(search.toLowerCase()) ||
      org.slug.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || (org.status || "active") === statusFilter;
    const matchesTier =
      tierFilter === "all" || org.subscription_tier_id === tierFilter;
    return matchesSearch && matchesStatus && matchesTier;
  });

  if (adminLoading || loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-48 mb-8"></div>
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-gray-800 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  const getStatusBadge = (status: string | null) => {
    const s = status || "active";
    switch (s) {
      case "active":
        return <span className="px-2 py-0.5 bg-green-900 text-green-300 rounded text-xs">Active</span>;
      case "paused":
        return <span className="px-2 py-0.5 bg-yellow-900 text-yellow-300 rounded text-xs">Paused</span>;
      case "suspended":
        return <span className="px-2 py-0.5 bg-orange-900 text-orange-300 rounded text-xs">Suspended</span>;
      case "revoked":
        return <span className="px-2 py-0.5 bg-red-900 text-red-300 rounded text-xs line-through">Revoked</span>;
      default:
        return <span className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded text-xs">{s}</span>;
    }
  };

  const getTierBadge = (tierId: string) => {
    const tier = tiers.find((t) => t.id === tierId);
    const name = tier?.name || tierId;
    switch (tierId) {
      case "enterprise":
        return <span className="px-2 py-0.5 bg-purple-900 text-purple-300 rounded text-xs">{name}</span>;
      case "pro":
        return <span className="px-2 py-0.5 bg-blue-900 text-blue-300 rounded text-xs">{name}</span>;
      case "starter":
        return <span className="px-2 py-0.5 bg-cyan-900 text-cyan-300 rounded text-xs">{name}</span>;
      default:
        return <span className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded text-xs">{name}</span>;
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Organizations</h1>
        {canManage(adminRole) && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition"
          >
            Create Organization
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <input
          type="text"
          placeholder="Search by name or slug..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="suspended">Suspended</option>
          <option value="revoked">Revoked</option>
        </select>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
        >
          <option value="all">All Tiers</option>
          {tiers.map((tier) => (
            <option key={tier.id} value={tier.id}>
              {tier.name}
            </option>
          ))}
        </select>
      </div>

      {/* Organizations table */}
      <div className="bg-gray-900 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-800">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Organization</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Status</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Tier</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Members</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">API Keys</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Usage (Month)</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filteredOrgs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No organizations found
                </td>
              </tr>
            ) : (
              filteredOrgs.map((org) => (
                <tr key={org.id} className="hover:bg-gray-800/50">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{org.name}</p>
                      <p className="text-sm text-gray-400">{org.slug}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">{getStatusBadge(org.status)}</td>
                  <td className="px-4 py-3">{getTierBadge(org.subscription_tier_id)}</td>
                  <td className="px-4 py-3 text-sm">{org.member_count}</td>
                  <td className="px-4 py-3 text-sm">{org.api_key_count}</td>
                  <td className="px-4 py-3 text-sm">{org.monthly_usage?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    {canManage(adminRole) && (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setSelectedOrg(org);
                            setNewTier(org.subscription_tier_id);
                            setShowTierModal(true);
                          }}
                          className="px-3 py-1 text-sm text-gray-400 hover:text-white hover:bg-gray-700 rounded transition"
                        >
                          Change Tier
                        </button>
                        {(org.status === "active" || org.status === null) && (
                          <button
                            onClick={() => {
                              setSelectedOrg(org);
                              setShowPauseModal(true);
                            }}
                            className="px-3 py-1 text-sm text-yellow-400 hover:text-yellow-300 hover:bg-yellow-900/30 rounded transition"
                          >
                            Pause
                          </button>
                        )}
                        {org.status === "paused" && (
                          <button
                            onClick={() => handleResume(org)}
                            disabled={actionLoading}
                            className="px-3 py-1 text-sm text-green-400 hover:text-green-300 hover:bg-green-900/30 rounded transition disabled:opacity-50"
                          >
                            Resume
                          </button>
                        )}
                        {org.status !== "revoked" && (
                          <button
                            onClick={() => {
                              setSelectedOrg(org);
                              setShowRevokeModal(true);
                            }}
                            className="px-3 py-1 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pause Modal */}
      {showPauseModal && selectedOrg && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">Pause Organization</h2>
            <p className="text-gray-400 text-sm mb-4">
              Pausing <strong>{selectedOrg.name}</strong> will temporarily disable all API access.
              The organization can be resumed later.
            </p>
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Reason (optional)</label>
              <textarea
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                placeholder="Enter reason for pausing..."
                className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none resize-none h-24"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePause}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 bg-yellow-600 rounded-lg hover:bg-yellow-700 transition disabled:opacity-50"
              >
                {actionLoading ? "Pausing..." : "Pause Organization"}
              </button>
              <button
                onClick={() => {
                  setShowPauseModal(false);
                  setPauseReason("");
                }}
                className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Modal */}
      {showRevokeModal && selectedOrg && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4 text-red-400">Revoke Organization</h2>
            <p className="text-gray-400 text-sm mb-4">
              <strong className="text-red-400">Warning:</strong> Revoking{" "}
              <strong>{selectedOrg.name}</strong> is permanent. All API access will be
              permanently disabled.
            </p>
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Reason (required)</label>
              <textarea
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Enter reason for revoking..."
                className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none resize-none h-24"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRevoke}
                disabled={actionLoading || !revokeReason.trim()}
                className="flex-1 px-4 py-2 bg-red-600 rounded-lg hover:bg-red-700 transition disabled:opacity-50"
              >
                {actionLoading ? "Revoking..." : "Revoke Permanently"}
              </button>
              <button
                onClick={() => {
                  setShowRevokeModal(false);
                  setRevokeReason("");
                }}
                className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Tier Modal */}
      {showTierModal && selectedOrg && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">Change Subscription Tier</h2>
            <p className="text-gray-400 text-sm mb-4">
              Update the subscription tier for <strong>{selectedOrg.name}</strong>.
            </p>
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">New Tier</label>
              <select
                value={newTier}
                onChange={(e) => setNewTier(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
              >
                {tiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name} ({tier.monthly_token_limit?.toLocaleString() || "Unlimited"} requests/mo)
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleChangeTier}
                disabled={actionLoading || newTier === selectedOrg.subscription_tier_id}
                className="flex-1 px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
              >
                {actionLoading ? "Updating..." : "Update Tier"}
              </button>
              <button
                onClick={() => {
                  setShowTierModal(false);
                  setNewTier("");
                }}
                className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Organization Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">Create Organization</h2>
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Organization Name</label>
                <input
                  type="text"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Acme Corp"
                  className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Subscription Tier</label>
                <select
                  value={newOrgTier}
                  onChange={(e) => setNewOrgTier(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
                >
                  {tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name} ({tier.monthly_token_limit?.toLocaleString() || "Unlimited"} requests/mo)
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Note: The organization will be created with you as the owner. You can transfer ownership later.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCreateOrg}
                disabled={actionLoading || !newOrgName.trim()}
                className="flex-1 px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
              >
                {actionLoading ? "Creating..." : "Create Organization"}
              </button>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewOrgName("");
                  setNewOrgTier("free");
                }}
                className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
