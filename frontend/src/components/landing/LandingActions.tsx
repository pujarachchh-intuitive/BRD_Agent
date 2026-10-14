"use client";

// The only auth-aware part of the landing page — everything else there is static and renders on
// the server. A signed-out visitor gets sign-up/log-in calls to action; a signed-in one gets
// shortcuts straight back into the app instead.

import { ArrowRight, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";

type Placement = "nav" | "hero" | "cta";

export default function LandingActions({ placement }: { placement: Placement }) {
  // Shows the signed-out actions until /api/auth/me resolves rather than hiding them: a slow or
  // unreachable backend must never leave the landing page without its calls to action.
  const { user } = useAuth();
  const className = `lp-actions lp-actions-${placement}`;

  if (placement === "nav") {
    return (
      <div className={className}>
        {user ? (
          <Link href="/dashboard" className="lp-btn lp-btn-primary lp-btn-sm">
            <LayoutDashboard size={15} /> Open dashboard
          </Link>
        ) : (
          <>
            <Link href="/login" className="lp-btn lp-btn-ghost lp-btn-sm">
              Log in
            </Link>
            <Link href="/register" className="lp-btn lp-btn-primary lp-btn-sm">
              Get started
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      {user ? (
        <>
          <Link href="/new" className="lp-btn lp-btn-primary lp-btn-lg">
            Start a new request <ArrowRight size={18} />
          </Link>
          <Link href="/dashboard" className="lp-btn lp-btn-outline lp-btn-lg">
            <LayoutDashboard size={17} /> Open dashboard
          </Link>
        </>
      ) : (
        <>
          <Link href="/register" className="lp-btn lp-btn-primary lp-btn-lg">
            {placement === "hero" ? "Get started" : "Create your account"} <ArrowRight size={18} />
          </Link>
          {placement === "hero" ? (
            <a href="#how-it-works" className="lp-btn lp-btn-outline lp-btn-lg">
              See how it works
            </a>
          ) : (
            <Link href="/login" className="lp-btn lp-btn-outline lp-btn-lg">
              Log in
            </Link>
          )}
        </>
      )}
    </div>
  );
}
