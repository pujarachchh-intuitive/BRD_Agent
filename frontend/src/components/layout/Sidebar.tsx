"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FilePlus2, History, LayoutDashboard, LogOut, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

const NAV_LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/new", label: "New Request", icon: FilePlus2 },
  { href: "/history", label: "History", icon: History },
];

const COLLAPSED_KEY = "brdAgentSuite.sidebarCollapsed";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  useEffect(() => {
    // Hydrating from localStorage, which doesn't exist during server render — this has to run in
    // an effect rather than a lazy useState initializer.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // localStorage unavailable — just keep the default (expanded).
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // per-viewer convenience only — fine if it doesn't persist.
      }
      return next;
    });
  }

  return (
    <aside className={`app-sidebar${collapsed ? " collapsed" : ""}`}>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <Sparkles size={18} strokeWidth={2.25} />
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-title">BRD Agent Suite</span>
          <span className="sidebar-brand-subtitle">AI Document Generator</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <span className="sidebar-section-label">Workspace</span>
        {NAV_LINKS.map((link) => {
          const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`sidebar-link${isActive ? " active" : ""}`}
              title={collapsed ? link.label : undefined}
            >
              <Icon size={17} strokeWidth={2} />
              <span className="sidebar-link-label">{link.label}</span>
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="sidebar-user">
          <div className="sidebar-user-info" title={user.email}>
            <span className="sidebar-user-name">{user.name}</span>
            <span className="sidebar-user-email">{user.email}</span>
          </div>
          <button type="button" className="sidebar-logout" onClick={handleLogout} title="Log out" aria-label="Log out">
            <LogOut size={15} strokeWidth={2} />
          </button>
        </div>
      )}

      <div className="sidebar-footer">Generates BRD, TSD, flowcharts, architecture diagrams & one-pagers from a project description.</div>
    </aside>
  );
}
