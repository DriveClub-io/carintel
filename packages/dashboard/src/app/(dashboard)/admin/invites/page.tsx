"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAdmin, canManage } from "@/components/AdminProvider";
import { useAuth } from "@/components/AuthProvider";

interface Invite {
  id: string;
  email: string;
  organization_id: string;
  organization_name?: string;
  role: "admin" | "member";
  invited_by: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

interface Organization {
  id: string;
  name: string;
}

export default function InvitesAdminPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { isAdmin, adminRole, loading: adminLoading } = useAdmin();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "accepted" | "expired">(
    "pending"
  );

  // Create invite modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newOrgId, setNewOrgId] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "member">("member");
  const [actionLoading, setActionLoading] = useState(false);

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

      // Load organizations
      const { data: orgsData } = await supabase
        .from("organizations")
        .select("id, name")
        .order("name");

      setOrganizations(orgsData || []);

      // Load invites
      const { data: invitesData } = await supabase
        .from("user_invites")
        .select(`
          id,
          email,
          organization_id,
          role,
          invited_by,
          token,
          expires_at,
          accepted_at,
          created_at,
          organizations (name)
        `)
        .order("created_at", { ascending: false });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enrichedInvites = (invitesData || []).map((inv: any) => ({
        ...inv,
        organization_name: inv.organizations?.name,
      }));

      setInvites(enrichedInvites);
    } catch (err) {
      console.error("Error loading invites:", err);
    } finally {
      setLoading(false);
    }
  }

  async function logAdminAction(action: string, targetId: string, details: Record<string, unknown>) {
    const supabase = createClient();
    await supabase.from("admin_audit_log").insert({
      admin_user_id: user?.id,
      action,
      target_type: "invite",
      target_id: targetId,
      details,
    });
  }

  function generateToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function handleCreateInvite() {
    if (!newEmail.trim() || !newOrgId || !canManage(adminRole)) return;

    setActionLoading(true);
    try {
      const supabase = createClient();
      const token = generateToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

      const { data, error } = await supabase
        .from("user_invites")
        .insert({
          email: newEmail.trim().toLowerCase(),
          organization_id: newOrgId,
          role: newRole,
          invited_by: user?.id,
          token,
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating invite:", error);
        alert("Failed to create invite: " + error.message);
        return;
      }

      await logAdminAction("create_invite", data.id, {
        email: newEmail,
        organization_id: newOrgId,
        role: newRole,
      });

      setShowCreateModal(false);
      setNewEmail("");
      setNewOrgId("");
      setNewRole("member");
      loadData();

      // Show invite link
      const inviteLink = `${window.location.origin}/invite/${token}`;
      alert(`Invite created! Link:\n\n${inviteLink}`);
    } catch (err) {
      console.error("Error creating invite:", err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRevokeInvite(invite: Invite) {
    if (!canManage(adminRole)) return;
    if (!confirm("Are you sure you want to revoke this invite?")) return;

    setActionLoading(true);
    try {
      const supabase = createClient();

      await supabase.from("user_invites").delete().eq("id", invite.id);

      await logAdminAction("revoke_invite", invite.id, {
        email: invite.email,
        organization_id: invite.organization_id,
      });

      loadData();
    } catch (err) {
      console.error("Error revoking invite:", err);
    } finally {
      setActionLoading(false);
    }
  }

  function copyInviteLink(token: string) {
    const link = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(link);
    alert("Invite link copied to clipboard!");
  }

  const now = new Date();
  const filteredInvites = invites.filter((inv) => {
    // Search filter
    const searchLower = search.toLowerCase();
    const matchesSearch =
      !search ||
      inv.email.toLowerCase().includes(searchLower) ||
      inv.organization_name?.toLowerCase().includes(searchLower);

    // Status filter
    let matchesStatus = true;
    const isExpired = new Date(inv.expires_at) < now;
    const isAccepted = !!inv.accepted_at;

    if (statusFilter === "pending") {
      matchesStatus = !isAccepted && !isExpired;
    } else if (statusFilter === "accepted") {
      matchesStatus = isAccepted;
    } else if (statusFilter === "expired") {
      matchesStatus = isExpired && !isAccepted;
    }

    return matchesSearch && matchesStatus;
  });

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
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Invites</h1>
        {canManage(adminRole) && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition"
          >
            Create Invite
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <input
          type="text"
          placeholder="Search by email or organization..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-md px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "all" | "pending" | "accepted" | "expired")
          }
          className="px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
        >
          <option value="all">All Invites</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Invites table */}
      <div className="bg-gray-900 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-800">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Email</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">
                Organization
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Role</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Status</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Created</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filteredInvites.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No invites found
                </td>
              </tr>
            ) : (
              filteredInvites.map((invite) => {
                const isExpired = new Date(invite.expires_at) < now;
                const isAccepted = !!invite.accepted_at;

                return (
                  <tr key={invite.id} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3">{invite.email}</td>
                    <td className="px-4 py-3">{invite.organization_name || "Unknown"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          invite.role === "admin"
                            ? "bg-blue-900 text-blue-300"
                            : "bg-gray-700 text-gray-300"
                        }`}
                      >
                        {invite.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {isAccepted ? (
                        <span className="px-2 py-0.5 bg-green-900 text-green-300 rounded text-xs">
                          Accepted
                        </span>
                      ) : isExpired ? (
                        <span className="px-2 py-0.5 bg-red-900 text-red-300 rounded text-xs">
                          Expired
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-yellow-900 text-yellow-300 rounded text-xs">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {new Date(invite.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {!isAccepted && !isExpired && (
                          <button
                            onClick={() => copyInviteLink(invite.token)}
                            className="px-3 py-1 text-sm text-gray-400 hover:text-white hover:bg-gray-700 rounded transition"
                          >
                            Copy Link
                          </button>
                        )}
                        {!isAccepted && canManage(adminRole) && (
                          <button
                            onClick={() => handleRevokeInvite(invite)}
                            disabled={actionLoading}
                            className="px-3 py-1 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Create Invite Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">Create Invite</h2>
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Organization</label>
                <select
                  value={newOrgId}
                  onChange={(e) => setNewOrgId(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">Select organization...</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as "admin" | "member")}
                  className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreateInvite}
                disabled={actionLoading || !newEmail.trim() || !newOrgId}
                className="flex-1 px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
              >
                {actionLoading ? "Creating..." : "Create Invite"}
              </button>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewEmail("");
                  setNewOrgId("");
                  setNewRole("member");
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
