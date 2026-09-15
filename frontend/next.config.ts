import type { NextConfig } from "next";

// The FastAPI backend (webapp/server.py). Same in dev and prod: the frontend always calls
// relative "/api/..." paths, and Next.js rewrites them here — so no CORS setup needed and no env
// var to configure per-deploy unless the backend moves off localhost:8000.
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // The rewrite proxy defaults to a 30s timeout, but /api/generate and /api/runs/{id}/revise can
  // legitimately take 30-90s (they run a multi-step Gemini pipeline) — without this, long runs get
  // killed with a "socket hang up" right as the backend is still working.
  experimental: {
    proxyTimeout: 180000,
  },
  // Next dev blocks cross-origin access to its own dev-only endpoints (HMR websocket, dev fonts)
  // by default. Visiting via 127.0.0.1 instead of localhost otherwise triggers harmless-looking but
  // noisy 403s / failed HMR websocket errors in the console.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Hides the floating dev-mode badge (route/build indicator) — purely cosmetic, but it sits right
  // over the sidebar footer and is worth turning off for a clean demo.
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
