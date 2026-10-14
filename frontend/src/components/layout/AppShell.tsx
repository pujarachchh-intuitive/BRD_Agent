"use client";

import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import AuthGuard from "./AuthGuard";
import Sidebar from "./Sidebar";

const PUBLIC_PATHS = new Set(["/login", "/register"]);
const LANDING_PATH = "/";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === LANDING_PATH) {
    // The marketing landing page is open to everyone, signed in or not — no AuthGuard redirect
    // either way, and it brings its own nav, so no sidebar.
    return <>{children}</>;
  }
  if (PUBLIC_PATHS.has(pathname)) {
    // Login/register are standalone pages — the full nav sidebar has nothing useful to point to
    // for a signed-out visitor.
    return <AuthGuard>{children}</AuthGuard>;
  }
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <AuthGuard>{children}</AuthGuard>
      </div>
    </div>
  );
}
