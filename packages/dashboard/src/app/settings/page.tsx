"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

interface Organization {
  id: string;
  name: string;
  slug: string;
  subscription_tier: string;
  subscription_status: string;
  created_at: string;
}

interface Tier {
  id: string;
  name: string;
  monthly_price_cents: number;
  monthly_token_limit: number | null;
  rate_limit_per_minute: number;
}

export default function SettingsPage() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    async function loadSettings() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: orgData } = await (supabase.from("organizations") as any)
        .select("*, subscription_tiers(*)")
        .eq("owner_user_id", user.id)
        .single();

      if (orgData) {
        setOrg(orgData as Organization);
        setOrgName((orgData as Organization).name);
        setTier(orgData.subscription_tiers as Tier);
      }
      setLoading(false);
    }

    loadSettings();
  }, []);

  async function saveSettings() {
    if (!org || !orgName.trim()) return;

    setSaving(true);
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("organizations") as any)
      .update({ name: orgName })
      .eq("id", org.id);
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-48 mb-8"></div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-gray-800 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 text-center">
        <p className="text-gray-400 mb-4">
          Sign in to view your organization settings
        </p>
        <a
          href="/login"
          className="inline-block px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition"
        >
          Sign In
        </a>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">Settings</h1>

      {/* Organization settings */}
      <div className="bg-gray-900 rounded-lg p-6 mb-8">
        <h2 className="font-semibold mb-4">Organization</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Slug</label>
            <input
              type="text"
              value={org.slug}
              disabled
              className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 opacity-50"
            />
          </div>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="px-6 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Subscription */}
      <div className="bg-gray-900 rounded-lg p-6 mb-8">
        <h2 className="font-semibold mb-4">Subscription</h2>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Current Plan</span>
            <span className="font-medium">{tier?.name || "Free"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Status</span>
            <span
              className={`px-2 py-0.5 rounded text-sm ${
                org.subscription_status === "active"
                  ? "bg-green-900 text-green-300"
                  : "bg-yellow-900 text-yellow-300"
              }`}
            >
              {org.subscription_status}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Monthly Limit</span>
            <span>
              {tier?.monthly_token_limit?.toLocaleString() || "Unlimited"}{" "}
              requests
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Rate Limit</span>
            <span>{tier?.rate_limit_per_minute || 10} req/min</span>
          </div>
          <div className="pt-4 border-t border-gray-800">
            <a
              href="mailto:support@carintel.io?subject=Upgrade%20Request"
              className="text-purple-400 hover:text-purple-300 text-sm"
            >
              Contact us to upgrade your plan
            </a>
          </div>
        </div>
      </div>

      {/* Account info */}
      <div className="bg-gray-900 rounded-lg p-6">
        <h2 className="font-semibold mb-4">Account</h2>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Member Since</span>
            <span>{new Date(org.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
