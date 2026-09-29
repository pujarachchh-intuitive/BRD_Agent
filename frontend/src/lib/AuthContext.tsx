"use client";

// Authenticated-user state for the whole app. Session identity itself lives in an HTTP-only
// cookie set by the backend (webapp/auth/router.py) — this context just tracks who that resolves
// to (via GET /api/auth/me) so components can render "logged in as X" and redirect when signed out.

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiLogin, apiLogout, apiMe, apiRegister } from "./api";
import { AuthUser } from "./types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiMe()
      .then((current) => {
        if (!cancelled) setUser(current);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const current = await apiLogin(email, password);
    setUser(current);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    await apiRegister(name, email, password);
    // Registration alone doesn't start a session (only /login sets the cookie) — chain straight
    // into login so a new user lands signed in, matching a normal "sign up" flow.
    const current = await apiLogin(email, password);
    setUser(current);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
