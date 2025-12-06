"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  environment: "live" | "test";
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export default function KeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyEnv, setNewKeyEnv] = useState<"live" | "test">("test");
  const [newKey, setNewKey] = useState<string | null>(null);

  useEffect(() => {
    loadKeys();
  }, []);

  async function loadKeys() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return;
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("owner_user_id", user.id)
      .single();

    if (!org) {
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("api_keys")
      .select("id, name, key_prefix, environment, is_active, created_at, last_used_at")
      .eq("organization_id", (org as { id: string }).id)
      .order("created_at", { ascending: false });

    setKeys((data as ApiKey[]) || []);
    setLoading(false);
  }

  async function createKey() {
    if (!newKeyName.trim()) return;

    setCreating(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setCreating(false);
      return;
    }

    // Generate a random API key
    const prefix = `ci_${newKeyEnv}_`;
    const randomPart = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const fullKey = prefix + randomPart;

    // Hash the key
    const encoder = new TextEncoder();
    const data = encoder.encode(fullKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // Get org ID
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("owner_user_id", user.id)
      .single();

    if (!org) {
      setCreating(false);
      return;
    }

    // Insert the key
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("api_keys") as any).insert({
      organization_id: (org as { id: string }).id,
      name: newKeyName,
      key_hash: keyHash,
      key_prefix: fullKey.slice(0, 12) + "...",
      environment: newKeyEnv,
    });

    if (error) {
      console.error("Error creating key:", error);
      setCreating(false);
      return;
    }

    setNewKey(fullKey);
    setNewKeyName("");
    setCreating(false);
    loadKeys();
  }

  async function revokeKey(keyId: string) {
    if (!confirm("Are you sure you want to revoke this API key?")) return;

    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("api_keys") as any).update({ is_active: false }).eq("id", keyId);
    loadKeys();
  }

  function copyKey() {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
    }
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

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">API Keys</h1>
      </div>

      {/* New key modal */}
      {newKey && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-lg w-full">
            <h2 className="text-xl font-bold mb-4">API Key Created</h2>
            <p className="text-gray-400 text-sm mb-4">
              Copy your API key now. You won&apos;t be able to see it again!
            </p>
            <div className="bg-gray-800 rounded p-3 font-mono text-sm break-all mb-4">
              {newKey}
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyKey}
                className="flex-1 px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition"
              >
                Copy to Clipboard
              </button>
              <button
                onClick={() => setNewKey(null)}
                className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create key form */}
      <div className="bg-gray-900 rounded-lg p-6 mb-8">
        <h2 className="font-semibold mb-4">Create New Key</h2>
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="Key name (e.g., Production, Development)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="flex-1 px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
          />
          <select
            value={newKeyEnv}
            onChange={(e) => setNewKeyEnv(e.target.value as "live" | "test")}
            className="px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
          >
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
          <button
            onClick={createKey}
            disabled={creating || !newKeyName.trim()}
            className="px-6 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>

      {/* Keys list */}
      <div className="space-y-4">
        {keys.length === 0 ? (
          <div className="bg-gray-900 rounded-lg p-6 text-center text-gray-400">
            No API keys yet. Create one above to get started.
          </div>
        ) : (
          keys.map((key) => (
            <div
              key={key.id}
              className={`bg-gray-900 rounded-lg p-4 flex items-center justify-between ${
                !key.is_active ? "opacity-50" : ""
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{key.name}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      key.environment === "live"
                        ? "bg-green-900 text-green-300"
                        : "bg-yellow-900 text-yellow-300"
                    }`}
                  >
                    {key.environment}
                  </span>
                  {!key.is_active && (
                    <span className="text-xs px-2 py-0.5 rounded bg-red-900 text-red-300">
                      Revoked
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-400 mt-1">
                  <span className="font-mono">{key.key_prefix}</span>
                  <span className="mx-2">|</span>
                  <span>
                    Created {new Date(key.created_at).toLocaleDateString()}
                  </span>
                  {key.last_used_at && (
                    <>
                      <span className="mx-2">|</span>
                      <span>
                        Last used {new Date(key.last_used_at).toLocaleDateString()}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {key.is_active && (
                <button
                  onClick={() => revokeKey(key.id)}
                  className="px-4 py-2 text-red-400 hover:text-red-300 hover:bg-gray-800 rounded-lg transition"
                >
                  Revoke
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
