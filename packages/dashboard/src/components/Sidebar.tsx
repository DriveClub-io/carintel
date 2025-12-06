"use client";

import { useAuth } from "./AuthProvider";
import { usePathname } from "next/navigation";

export function Sidebar() {
  const { user, signOut } = useAuth();
  const pathname = usePathname();

  // Don't show sidebar on login page
  if (pathname === "/login" || pathname.startsWith("/auth/")) {
    return null;
  }

  return (
    <aside className="w-64 border-r border-gray-800 p-4 flex flex-col">
      <div className="mb-8">
        <h1 className="text-xl font-bold">Car Intel</h1>
        <p className="text-sm text-gray-400">Dashboard</p>
      </div>

      <nav className="space-y-2 flex-1">
        <a
          href="/"
          className={`block px-4 py-2 rounded-lg transition ${
            pathname === "/" ? "bg-gray-800" : "hover:bg-gray-800"
          }`}
        >
          Overview
        </a>
        <a
          href="/keys"
          className={`block px-4 py-2 rounded-lg transition ${
            pathname === "/keys" ? "bg-gray-800" : "hover:bg-gray-800"
          }`}
        >
          API Keys
        </a>
        <a
          href="/usage"
          className={`block px-4 py-2 rounded-lg transition ${
            pathname === "/usage" ? "bg-gray-800" : "hover:bg-gray-800"
          }`}
        >
          Usage
        </a>
        <a
          href="/settings"
          className={`block px-4 py-2 rounded-lg transition ${
            pathname === "/settings" ? "bg-gray-800" : "hover:bg-gray-800"
          }`}
        >
          Settings
        </a>
      </nav>

      <div className="space-y-2 pt-4 border-t border-gray-800">
        <a
          href="https://docs.carintel.io"
          target="_blank"
          rel="noopener noreferrer"
          className="block text-sm text-gray-400 hover:text-white transition"
        >
          API Documentation
        </a>
        {user && (
          <>
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
            <button
              onClick={signOut}
              className="text-sm text-gray-400 hover:text-white transition"
            >
              Sign Out
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
