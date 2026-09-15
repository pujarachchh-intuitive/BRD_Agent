"use client";

import { FilePlus2, LayoutDashboard, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/new", label: "New Request", icon: FilePlus2 },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="app-sidebar">
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
            <Link key={link.href} href={link.href} className={`sidebar-link${isActive ? " active" : ""}`}>
              <Icon size={17} strokeWidth={2} />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">Generates BRD, TSD, flowcharts, architecture diagrams & one-pagers from a project description.</div>
    </aside>
  );
}
