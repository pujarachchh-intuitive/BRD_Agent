"use client";

// Client-side redirect only — the backend does not (yet) enforce auth on the BRD routes
// themselves, that's ownership-enforcement, a later step. This just keeps a signed-out visitor
// on the login/register pages and a signed-in one off them.

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";

const PUBLIC_PATHS = new Set(["/login", "/register"]);

export default function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPath = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublicPath) {
      router.replace("/login");
    } else if (user && isPublicPath) {
      router.replace("/");
    }
  }, [loading, user, isPublicPath, router]);

  if (loading) return null;
  if (!user && !isPublicPath) return null;
  if (user && isPublicPath) return null;
  return <>{children}</>;
}
