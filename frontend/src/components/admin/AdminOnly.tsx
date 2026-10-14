"use client";

import { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

/** Renders children only for admins. The backend enforces this too (require_admin) — this just
 * avoids showing a page whose every request would be refused. */
export default function AdminOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="skeleton" style={{ height: 240 }} />;
  if (user?.role !== "ADMIN") {
    return (
      <div className="card empty-state">
        <div className="empty-state-icon">
          <ShieldCheck size={22} />
        </div>
        <p className="m-0 font-medium" style={{ color: "var(--color-text)" }}>
          Template Studio is only available to admins.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
