"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { usePathname, useRouter } from "next/navigation";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  subscription_tier_id: string | null;
  subscription_status: string | null;
}

interface AuthContextType {
  user: User | null;
  organizationId: string | null;
  organizations: Organization[];
  currentOrganization: Organization | null;
  loading: boolean;
  switchOrganization: (orgId: string) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  organizationId: null,
  organizations: [],
  currentOrganization: null,
  loading: true,
  switchOrganization: () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const publicPaths = ["/login", "/auth/callback", "/invite"];
const ORG_STORAGE_KEY = "carintel_selected_org";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const currentOrganization = organizations.find(org => org.id === organizationId) || null;

  const switchOrganization = useCallback((orgId: string) => {
    const org = organizations.find(o => o.id === orgId);
    if (org) {
      setOrganizationId(orgId);
      // Store selection in localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem(ORG_STORAGE_KEY, orgId);
      }
    }
  }, [organizations]);

  async function fetchOrganizations(currentUser: User): Promise<{ orgs: Organization[], selectedId: string | null }> {
    try {
      const supabase = createClient();

      // Fetch all organizations owned by the user
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingOrgs, error: fetchError } = await (supabase.from("organizations") as any)
        .select("id, name, slug, subscription_tier_id, subscription_status")
        .eq("owner_user_id", currentUser.id)
        .order("created_at", { ascending: true });

      if (fetchError) {
        console.error("Error fetching organizations:", fetchError);
        return { orgs: [], selectedId: null };
      }

      if (existingOrgs && existingOrgs.length > 0) {
        const orgs = existingOrgs as Organization[];

        // Try to restore previously selected org from localStorage
        let selectedId: string | null = null;
        if (typeof window !== "undefined") {
          const storedOrgId = localStorage.getItem(ORG_STORAGE_KEY);
          if (storedOrgId && orgs.some(o => o.id === storedOrgId)) {
            selectedId = storedOrgId;
          }
        }

        // Default to first org if no stored selection
        if (!selectedId) {
          selectedId = orgs[0].id;
        }

        return { orgs, selectedId };
      }

      // Create a new organization for the user
      const userName = currentUser.user_metadata?.full_name
        || currentUser.user_metadata?.name
        || currentUser.email?.split("@")[0]
        || "My Organization";

      const slug = `${userName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now()}`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newOrg, error: insertError } = await (supabase.from("organizations") as any)
        .insert({
          name: `${userName}'s Organization`,
          slug,
          owner_user_id: currentUser.id,
        })
        .select("id, name, slug, subscription_tier_id, subscription_status")
        .single();

      if (insertError) {
        console.error("Error creating organization:", insertError);
        return { orgs: [], selectedId: null };
      }

      const org = newOrg as Organization;
      return { orgs: [org], selectedId: org.id };
    } catch (err) {
      console.error("Unexpected error in fetchOrganizations:", err);
      return { orgs: [], selectedId: null };
    }
  }

  useEffect(() => {
    console.log("[AuthProvider] useEffect starting, pathname:", pathname);
    const supabase = createClient();
    let initialCheckDone = false;

    // Listen for auth changes - this is the primary way we get auth state
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("[AuthProvider] Auth state changed:", event, !!session?.user);

      if (session?.user) {
        setUser(session.user);
        // Fetch all organizations for the user
        fetchOrganizations(session.user).then(({ orgs, selectedId }) => {
          console.log("[AuthProvider] Fetched organizations:", orgs.length, "selected:", selectedId);
          setOrganizations(orgs);
          setOrganizationId(selectedId);
        });
      } else {
        setUser(null);
        setOrganizations([]);
        setOrganizationId(null);
        const isPublicPath = publicPaths.some(path => pathname === path || pathname.startsWith(path + "/"));
        if (!isPublicPath && initialCheckDone) {
          router.push("/login");
        }
      }

      // Always set loading to false after we get an auth event
      setLoading(false);
      initialCheckDone = true;
    });

    // Set a timeout to ensure we don't hang forever
    const timeout = setTimeout(() => {
      console.log("[AuthProvider] Timeout - setting loading to false");
      setLoading(false);
      initialCheckDone = true;
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [pathname, router]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setOrganizations([]);
    setOrganizationId(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem(ORG_STORAGE_KEY);
    }
    router.push("/login");
  }

  return (
    <AuthContext.Provider value={{
      user,
      organizationId,
      organizations,
      currentOrganization,
      loading,
      switchOrganization,
      signOut
    }}>
      {children}
    </AuthContext.Provider>
  );
}
