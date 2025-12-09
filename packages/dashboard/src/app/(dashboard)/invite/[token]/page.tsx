"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";

interface InviteDetails {
  id: string;
  email: string;
  organization_id: string;
  organization_name: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
}

export default function InviteAcceptPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = params.token as string;

  useEffect(() => {
    loadInvite();
  }, [token]);

  async function loadInvite() {
    try {
      const supabase = createClient();

      const { data, error: fetchError } = await supabase
        .from("user_invites")
        .select(`
          id,
          email,
          organization_id,
          role,
          expires_at,
          accepted_at,
          organizations (name)
        `)
        .eq("token", token)
        .single();

      if (fetchError || !data) {
        setError("Invalid or expired invite link");
        setLoading(false);
        return;
      }

      const isExpired = new Date(data.expires_at) < new Date();
      if (isExpired) {
        setError("This invite has expired");
        setLoading(false);
        return;
      }

      if (data.accepted_at) {
        setError("This invite has already been accepted");
        setLoading(false);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setInvite({
        ...data,
        organization_name: (data as any).organizations?.name || "Unknown",
      });
    } catch (err) {
      console.error("Error loading invite:", err);
      setError("Failed to load invite");
    } finally {
      setLoading(false);
    }
  }

  async function handleAccept() {
    if (!invite || !user) return;

    setAccepting(true);
    try {
      const supabase = createClient();

      // Call the accept_invite function
      const { data, error: acceptError } = await supabase.rpc("accept_invite", {
        p_token: token,
        p_user_id: user.id,
      });

      if (acceptError) {
        console.error("Error accepting invite:", acceptError);
        setError("Failed to accept invite: " + acceptError.message);
        setAccepting(false);
        return;
      }

      const result = data as { success: boolean; error?: string; message?: string };

      if (!result.success) {
        setError(result.error || "Failed to accept invite");
        setAccepting(false);
        return;
      }

      // Redirect to dashboard
      router.push("/");
    } catch (err) {
      console.error("Error accepting invite:", err);
      setError("Failed to accept invite");
    } finally {
      setAccepting(false);
    }
  }

  async function handleSignIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/invite/${token}`,
      },
    });
  }

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-800 rounded w-48 mb-4"></div>
          <div className="h-4 bg-gray-800 rounded w-64"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-gray-900 rounded-lg p-8 max-w-md w-full text-center">
          <div className="text-red-400 text-5xl mb-4">!</div>
          <h1 className="text-xl font-bold mb-2">Invite Error</h1>
          <p className="text-gray-400 mb-6">{error}</p>
          <a
            href="/"
            className="inline-block px-6 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }

  if (!invite) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-lg p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-2">You&apos;ve Been Invited!</h1>
          <p className="text-gray-400">
            You&apos;ve been invited to join{" "}
            <strong className="text-white">{invite.organization_name}</strong> on Car Intel.
          </p>
        </div>

        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-400">Organization</span>
              <span className="font-medium">{invite.organization_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Role</span>
              <span
                className={`px-2 py-0.5 rounded text-xs ${
                  invite.role === "admin"
                    ? "bg-blue-900 text-blue-300"
                    : "bg-gray-700 text-gray-300"
                }`}
              >
                {invite.role}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Invited Email</span>
              <span className="text-sm">{invite.email}</span>
            </div>
          </div>
        </div>

        {user ? (
          <div>
            <p className="text-sm text-gray-400 mb-4 text-center">
              Signed in as <strong>{user.email}</strong>
            </p>
            <button
              onClick={handleAccept}
              disabled={accepting}
              className="w-full px-6 py-3 bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50 font-medium"
            >
              {accepting ? "Accepting..." : "Accept Invite"}
            </button>
            {user.email !== invite.email && (
              <p className="text-xs text-yellow-400 mt-3 text-center">
                Note: The invite was sent to {invite.email} but you&apos;re signed in as {user.email}.
                You can still accept.
              </p>
            )}
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-400 mb-4 text-center">
              Sign in to accept this invitation
            </p>
            <button
              onClick={handleSignIn}
              className="w-full px-6 py-3 bg-white text-gray-900 rounded-lg hover:bg-gray-100 transition font-medium flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Sign in with Google
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
