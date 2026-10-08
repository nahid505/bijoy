import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];
// Content-Security-Policy (per-request nonce) and HSTS (HTTPS deployments) are set in src/middleware.ts.

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // business backup restore uploads files up to 50 MB through a server action (default limit: 1 MB)
  experimental: { serverActions: { bodySizeLimit: "55mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
