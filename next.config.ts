import type { NextConfig } from 'next';

/**
 * Baseline response headers for an interactive tool that handles an API key:
 * never framed (so it cannot be clickjacked into sending), never MIME-sniffed,
 * and relay responses never cached.
 *
 * No script-src policy. Next.js injects inline bootstrap scripts, so a useful
 * policy needs per-request nonces, which would force every page to render
 * dynamically. For a single-page internal tool that trade is not worth making;
 * the framing and sniffing protections carry the real risk here.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
