"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAdmin, canManage } from "@/components/AdminProvider";
import { useAuth } from "@/components/AuthProvider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Eye, MoreHorizontal, Search, UserPlus, X } from "lucide-react";
import Link from "next/link";

interface UserMetadata {
  email: string;
  name: string;
  avatar_url: string | null;
}

interface UserWithOrgs {
  user_id: string;
  name: string;
  email?: string;
  avatar_url?: string | null;
  organizations: {
    id: string;
    name: string;
    role: string;
    is_owner: boolean;
  }[];
}

interface Organization {
  id: string;
  name: string;
  owner_user_id: string;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function extractUserNameFromOrg(orgName: string): string {
  // Organization names are formatted as "{userName}'s Organization"
  const match = orgName.match(/^(.+)'s Organization$/);
  return match ? match[1] : orgName;
}

export default function UsersAdminPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { isAdmin, adminRole, loading: adminLoading } = useAdmin();
  const [users, setUsers] = useState<UserWithOrgs[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Modal states
  const [selectedUser, setSelectedUser] = useState<UserWithOrgs | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [selectedOrgForAction, setSelectedOrgForAction] = useState<string>("");
  const [inviteOrgId, setInviteOrgId] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
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
        .select("id, name, owner_user_id")
        .order("name");

      setOrganizations(orgsData || []);

      // Fetch user profiles from database (includes avatars from OAuth)
      let userMetadataMap: Record<string, UserMetadata> = {};
      const { data: profilesData } = await supabase
        .from("user_profiles")
        .select("id, email, full_name, avatar_url");

      if (profilesData) {
        profilesData.forEach((profile) => {
          userMetadataMap[profile.id] = {
            email: profile.email || "",
            name: profile.full_name || "",
            avatar_url: profile.avatar_url,
          };
        });
      }

      // Create a map of owner_user_id to organization name for getting user names (fallback)
      const ownerNameMap = new Map<string, string>();
      orgsData?.forEach((org) => {
        if (org.owner_user_id) {
          ownerNameMap.set(org.owner_user_id, extractUserNameFromOrg(org.name));
        }
      });

      // Load organization members with their orgs
      const { data: membersData } = await supabase
        .from("organization_members")
        .select(`
          user_id,
          role,
          organization_id,
          organizations (id, name, owner_user_id)
        `);

      // Group by user - use a Set to track unique user+org combinations
      const userMap = new Map<string, UserWithOrgs>();
      const userOrgSet = new Set<string>();

      // Add owners first
      orgsData?.forEach((org) => {
        if (org.owner_user_id) {
          const key = `${org.owner_user_id}-${org.id}`;
          if (userOrgSet.has(key)) return;
          userOrgSet.add(key);

          if (!userMap.has(org.owner_user_id)) {
            const metadata = userMetadataMap[org.owner_user_id];
            userMap.set(org.owner_user_id, {
              user_id: org.owner_user_id,
              name: metadata?.name || extractUserNameFromOrg(org.name),
              email: metadata?.email,
              avatar_url: metadata?.avatar_url,
              organizations: [],
            });
          }
          const userData = userMap.get(org.owner_user_id)!;
          userData.organizations.push({
            id: org.id,
            name: org.name,
            role: "owner",
            is_owner: true,
          });
        }
      });

      // Add members (but not if they're already added as owner for that org)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      membersData?.forEach((member: any) => {
        const org = member.organizations as { id: string; name: string; owner_user_id: string } | null;
        if (!org) return;

        const key = `${member.user_id}-${org.id}`;
        if (userOrgSet.has(key)) return; // Skip if already added
        userOrgSet.add(key);

        const isOwner = org.owner_user_id === member.user_id;

        if (!userMap.has(member.user_id)) {
          const metadata = userMetadataMap[member.user_id];
          // Try to get name from metadata, then from their own org, or use a placeholder
          const userName = metadata?.name || ownerNameMap.get(member.user_id) || "Unknown User";
          userMap.set(member.user_id, {
            user_id: member.user_id,
            name: userName,
            email: metadata?.email,
            avatar_url: metadata?.avatar_url,
            organizations: [],
          });
        }

        const userData = userMap.get(member.user_id)!;
        userData.organizations.push({
          id: org.id,
          name: org.name,
          role: isOwner ? "owner" : member.role,
          is_owner: isOwner,
        });
      });

      setUsers(Array.from(userMap.values()));
    } catch (err) {
      console.error("Error loading users:", err);
    } finally {
      setLoading(false);
    }
  }

  async function logAdminAction(action: string, targetId: string, details: Record<string, unknown>) {
    const supabase = createClient();
    await supabase.from("admin_audit_log").insert({
      admin_user_id: user?.id,
      action,
      target_type: "user",
      target_id: targetId,
      details,
    });
  }

  async function handleAddToOrg() {
    if (!selectedUser || !inviteOrgId || !canManage(adminRole)) return;

    setActionLoading(true);
    try {
      const supabase = createClient();

      // Check if already a member
      const { data: existing } = await supabase
        .from("organization_members")
        .select("id")
        .eq("organization_id", inviteOrgId)
        .eq("user_id", selectedUser.user_id)
        .maybeSingle();

      if (existing) {
        alert("User is already a member of this organization");
        setActionLoading(false);
        return;
      }

      await supabase.from("organization_members").insert({
        organization_id: inviteOrgId,
        user_id: selectedUser.user_id,
        role: inviteRole,
        invited_by: user?.id,
      });

      await logAdminAction("add_user_to_org", selectedUser.user_id, {
        organization_id: inviteOrgId,
        role: inviteRole,
      });

      setShowInviteModal(false);
      setInviteOrgId("");
      setInviteRole("member");
      loadData();
    } catch (err) {
      console.error("Error adding user to org:", err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRemoveFromOrg() {
    if (!selectedUser || !selectedOrgForAction || !canManage(adminRole)) return;

    setActionLoading(true);
    try {
      const supabase = createClient();

      await supabase
        .from("organization_members")
        .delete()
        .eq("organization_id", selectedOrgForAction)
        .eq("user_id", selectedUser.user_id);

      await logAdminAction("remove_user_from_org", selectedUser.user_id, {
        organization_id: selectedOrgForAction,
      });

      setShowRemoveModal(false);
      setSelectedOrgForAction("");
      loadData();
    } catch (err) {
      console.error("Error removing user from org:", err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleChangeRole(userId: string, orgId: string, newRole: string) {
    if (!canManage(adminRole)) return;

    try {
      const supabase = createClient();

      await supabase
        .from("organization_members")
        .update({ role: newRole })
        .eq("organization_id", orgId)
        .eq("user_id", userId);

      await logAdminAction("change_user_role", userId, {
        organization_id: orgId,
        new_role: newRole,
      });

      loadData();
    } catch (err) {
      console.error("Error changing role:", err);
    }
  }

  const filteredUsers = users.filter((u) => {
    const searchLower = search.toLowerCase();
    return (
      u.user_id.toLowerCase().includes(searchLower) ||
      u.name.toLowerCase().includes(searchLower) ||
      u.email?.toLowerCase().includes(searchLower) ||
      u.organizations.some((o) => o.name.toLowerCase().includes(searchLower))
    );
  });

  if (adminLoading || loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted rounded w-48 animate-pulse" />
        <div className="h-10 bg-muted rounded w-80 animate-pulse" />
        <div className="rounded-md border">
          <div className="h-96 bg-muted/50 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Users table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Organizations</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((userData) => (
                <TableRow key={userData.user_id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/admin/users/${userData.user_id}`} className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        {userData.avatar_url && (
                          <AvatarImage src={userData.avatar_url} alt={userData.name} />
                        )}
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {getInitials(userData.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium">{userData.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {userData.email || `${userData.user_id.slice(0, 8)}...`}
                        </span>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {userData.organizations.map((org) => (
                        <Badge
                          key={org.id}
                          variant={org.is_owner ? "default" : org.role === "admin" ? "secondary" : "outline"}
                          className="text-xs"
                        >
                          {org.name.replace("'s Organization", "")}
                          <span className="ml-1 opacity-70">
                            ({org.is_owner ? "Owner" : org.role})
                          </span>
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {canManage(adminRole) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Open menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/users/${userData.user_id}`}>
                              <Eye className="mr-2 h-4 w-4" />
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedUser(userData);
                              setShowInviteModal(true);
                            }}
                          >
                            <UserPlus className="mr-2 h-4 w-4" />
                            Add to Organization
                          </DropdownMenuItem>
                          {userData.organizations.filter((o) => !o.is_owner).map((org) => (
                            <DropdownMenuItem
                              key={org.id}
                              onClick={() => {
                                setSelectedUser(userData);
                                setSelectedOrgForAction(org.id);
                                setShowRemoveModal(true);
                              }}
                              className="text-destructive focus:text-destructive"
                            >
                              <X className="mr-2 h-4 w-4" />
                              Remove from {org.name.replace("'s Organization", "")}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add to Org Modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User to Organization</DialogTitle>
            <DialogDescription>
              Add {selectedUser?.name} to an organization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Organization</label>
              <Select value={inviteOrgId} onValueChange={setInviteOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select organization..." />
                </SelectTrigger>
                <SelectContent>
                  {organizations
                    .filter(
                      (org) =>
                        !selectedUser?.organizations.find((o) => o.id === org.id)
                    )
                    .map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "admin" | "member")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddToOrg} disabled={actionLoading || !inviteOrgId}>
              {actionLoading ? "Adding..." : "Add to Organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove from Org Modal */}
      <Dialog open={showRemoveModal} onOpenChange={setShowRemoveModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove User from Organization</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {selectedUser?.name} from{" "}
              <strong>
                {selectedUser?.organizations.find((o) => o.id === selectedOrgForAction)?.name}
              </strong>
              ?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRemoveModal(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemoveFromOrg} disabled={actionLoading}>
              {actionLoading ? "Removing..." : "Remove User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
