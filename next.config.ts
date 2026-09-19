import type { NextConfig } from "next";

// Security headers applied to every response. These are a standard
// hardening layer independent of anything the app code does — they tell
// the browser to enforce protections even if something elsewhere in the
// app (or a future change to it) has a gap.
const securityHeaders = [
  {
    // Prevents this app from being embedded in an <iframe> on another
    // site — the standard defense against clickjacking (tricking a user
    // into clicking something in a disguised, invisible iframe).
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    // Stops the browser from trying to "guess" a different content type
    // than what the server declared — a known vector for turning an
    // upload (e.g. a crafted file) into executable script.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Don't leak the full URL (which can contain IDs, tokens in query
    // strings, etc.) to third-party sites via the Referer header when a
    // link is clicked out of the app.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // Explicitly disable browser features this app has no legitimate use
    // for, so they can't be abused even via an embedded/compromised
    // third-party script.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    // A conservative baseline CSP: only this origin may supply
    // scripts/styles/images/fonts, inline styles are allowed (Tailwind
    // and several UI primitives rely on them), and framing this app
    // (frame-ancestors) or this app framing anything else is blocked —
    // the CSP-level version of X-Frame-Options above, since not every
    // browser honors X-Frame-Options identically.
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Was previously `ignoreBuildErrors: true` — silently letting real
    // type errors through to production. Left off deliberately now: if
    // a build ever fails here, that's real information, not noise to
    // suppress.
  },
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
