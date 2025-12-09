"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { useAdmin, canManage } from "@/components/AdminProvider";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  Mail,
  MoreHorizontal,
  Plus,
  Trash2,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface UserOrganization {
  id: string;
  organization_id: string;
  role: string;
  created_at: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    owner_user_id: string;
  };
}

interface Organization {
  id: string;
  name: string;
  slug: string;
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

export default function UserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params.id as string;
  const { isAdmin, adminRole, loading: adminLoading } = useAdmin();

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userOrgs, setUserOrgs] = useState<UserOrganization[]>([]);
  const [ownedOrgs, setOwnedOrgs] = useState<Organization[]>([]);
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showAddOrgModal, setShowAddOrgModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [selectedOrgForRemove, setSelectedOrgForRemove] = useState<UserOrganization | null>(null);
  const [addOrgId, setAddOrgId] = useState("");
  const [addOrgRole, setAddOrgRole] = useState<"admin" | "member">("member");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (adminLoading) return;

    if (!isAdmin) {
      router.push("/");
      return;
    }

    loadUserData();
  }, [isAdmin, adminLoading, router, userId]);

  async function loadUserData() {
    try {
      const supabase = createClient();

      // Load user profile
      const { data: profileData, error: profileError } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (profileError && profileError.code !== "PGRST116") {
        console.error("Error loading profile:", profileError);
      }

      // Load all organizations for the dropdown
      const { data: allOrgsData } = await supabase
        .from("organizations")
        .select("id, name, slug, owner_user_id")
        .order("name");

      setAllOrgs(allOrgsData || []);

      // Get organizations owned by this user
      const owned = allOrgsData?.filter((org) => org.owner_user_id === userId) || [];
      setOwnedOrgs(owned);

      // If no profile exists, try to get info from organization name
      if (!profileData) {
        const ownedOrg = owned[0];
        if (ownedOrg) {
          const nameMatch = ownedOrg.name.match(/^(.+)'s Organization$/);
          setUserProfile({
            id: userId,
            email: null,
            full_name: nameMatch ? nameMatch[1] : "Unknown User",
            avatar_url: null,
            created_at: "",
          });
        } else {
          setUserProfile({
            id: userId,
            email: null,
            full_name: "Unknown User",
            avatar_url: null,
            created_at: "",
          });
        }
      } else {
        setUserProfile(profileData);
      }

      // Load organization memberships (not as owner)
      const { data: membershipsData } = await supabase
        .from("organization_members")
        .select(`
          id,
          organization_id,
          role,
          created_at,
          organizations (id, name, slug, owner_user_id)
        `)
        .eq("user_id", userId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const formattedMemberships = (membershipsData || []).map((m: any) => ({
        id: m.id,
        organization_id: m.organization_id,
        role: m.role,
        created_at: m.created_at,
        organization: m.organizations,
      }));

      setUserOrgs(formattedMemberships);
    } catch (err) {
      console.error("Error loading user data:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddToOrg() {
    if (!addOrgId || !canManage(adminRole)) return;

    setActionLoading(true);
    try {
      const supabase = createClient();

      // Check if already a member
      const { data: existing } = await supabase
        .from("organization_members")
        .select("id")
        .eq("organization_id", addOrgId)
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        toast.error("User is already a member of this organization");
        setActionLoading(false);
        return;
      }

      // Check if user owns this org
      const org = allOrgs.find((o) => o.id === addOrgId);
      if (org?.owner_user_id === userId) {
        toast.error("User is the owner of this organization");
        setActionLoading(false);
        return;
      }

      const { error } = await supabase.from("organization_members").insert({
        organization_id: addOrgId,
        user_id: userId,
        role: addOrgRole,
      });

      if (error) {
        toast.error("Failed to add user to organization");
        console.error(error);
      } else {
        toast.success("User added to organization");
        setShowAddOrgModal(false);
        setAddOrgId("");
        setAddOrgRole("member");
        loadUserData();
      }
    } catch (err) {
      console.error("Error adding to org:", err);
      toast.error("Failed to add user to organization");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRemoveFromOrg() {
    if (!selectedOrgForRemove || !canManage(adminRole)) return;

    setActionLoading(true);
    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("organization_members")
        .delete()
        .eq("id", selectedOrgForRemove.id);

      if (error) {
        toast.error("Failed to remove user from organization");
        console.error(error);
      } else {
        toast.success("User removed from organization");
        setShowRemoveModal(false);
        setSelectedOrgForRemove(null);
        loadUserData();
      }
    } catch (err) {
      console.error("Error removing from org:", err);
      toast.error("Failed to remove user from organization");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleChangeRole(membershipId: string, newRole: string) {
    if (!canManage(adminRole)) return;

    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("organization_members")
        .update({ role: newRole })
        .eq("id", membershipId);

      if (error) {
        toast.error("Failed to update role");
        console.error(error);
      } else {
        toast.success("Role updated");
        loadUserData();
      }
    } catch (err) {
      console.error("Error changing role:", err);
      toast.error("Failed to update role");
    }
  }

  if (adminLoading || loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-60" />
          </div>
        </div>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAdmin || !userProfile) {
    return null;
  }

  // Get orgs user is NOT already a member of (and doesn't own)
  const availableOrgs = allOrgs.filter(
    (org) =>
      org.owner_user_id !== userId &&
      !userOrgs.some((uo) => uo.organization_id === org.id)
  );

  return (
    <div className="space-y-6">
      {/* Back button and header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/users">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-4">
          <Avatar className="h-12 w-12">
            {userProfile.avatar_url && (
              <AvatarImage src={userProfile.avatar_url} alt={userProfile.full_name || ""} />
            )}
            <AvatarFallback className="bg-primary/10 text-primary">
              {getInitials(userProfile.full_name || "U")}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {userProfile.full_name || "Unknown User"}
            </h1>
            <p className="text-muted-foreground">
              {userProfile.email || userId}
            </p>
          </div>
        </div>
      </div>

      {/* User Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            User Information
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">User ID</p>
            <p className="font-mono text-sm">{userId}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Email</p>
            <p className="text-sm">{userProfile.email || "Not available"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Full Name</p>
            <p className="text-sm">{userProfile.full_name || "Not available"}</p>
          </div>
          {userProfile.created_at && (
            <div>
              <p className="text-sm text-muted-foreground">Joined</p>
              <p className="text-sm">
                {new Date(userProfile.created_at).toLocaleDateString()}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Organizations */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Organizations
              </CardTitle>
              <CardDescription>
                Organizations this user owns or is a member of
              </CardDescription>
            </div>
            {canManage(adminRole) && availableOrgs.length > 0 && (
              <Button onClick={() => setShowAddOrgModal(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add to Organization
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Owned Organizations */}
              {ownedOrgs.map((org) => (
                <TableRow key={`owned-${org.id}`}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{org.name}</span>
                      <span className="text-xs text-muted-foreground">{org.slug}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge>Owner</Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm">
                    Cannot modify owner
                  </TableCell>
                </TableRow>
              ))}

              {/* Member Organizations */}
              {userOrgs.map((membership) => (
                <TableRow key={membership.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{membership.organization.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {membership.organization.slug}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={membership.role === "admin" ? "default" : "secondary"}>
                      {membership.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage(adminRole) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              handleChangeRole(
                                membership.id,
                                membership.role === "admin" ? "member" : "admin"
                              )
                            }
                          >
                            Change to {membership.role === "admin" ? "Member" : "Admin"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => {
                              setSelectedOrgForRemove(membership);
                              setShowRemoveModal(true);
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove from Organization
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}

              {ownedOrgs.length === 0 && userOrgs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                    User is not a member of any organizations
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add to Organization Modal */}
      <Dialog open={showAddOrgModal} onOpenChange={setShowAddOrgModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User to Organization</DialogTitle>
            <DialogDescription>
              Add {userProfile.full_name || "this user"} to an organization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Organization</label>
              <Select value={addOrgId} onValueChange={setAddOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select organization..." />
                </SelectTrigger>
                <SelectContent>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={addOrgRole} onValueChange={(v) => setAddOrgRole(v as "admin" | "member")}>
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
            <Button variant="outline" onClick={() => setShowAddOrgModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddToOrg} disabled={actionLoading || !addOrgId}>
              {actionLoading ? "Adding..." : "Add to Organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove from Organization Modal */}
      <Dialog open={showRemoveModal} onOpenChange={setShowRemoveModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from Organization</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {userProfile.full_name || "this user"} from{" "}
              <strong>{selectedOrgForRemove?.organization.name}</strong>?
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
