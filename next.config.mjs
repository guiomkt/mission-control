/** @type {import('next').NextConfig} */

/**
 * Content-Security-Policy.
 *
 * Tight defaults for a single-page operator panel. Notes:
 *  - `script-src 'self' 'unsafe-inline'`: Next.js bootstraps with inline scripts.
 *    Replace with nonce-based CSP if/when we move off the App Router runtime.
 *  - `style-src 'self' 'unsafe-inline'`: required by Tailwind + Next CSS-in-JS.
 *  - `img-src` includes data: for inline thumbnails; blob: for client-side previews.
 *  - `connect-src` autoriza o projeto Supabase configurado (REST + Realtime
 *    via wss). Lemos a URL do NEXT_PUBLIC_SUPABASE_URL pra não hardcodar o
 *    project ref — se alguém clonar pra outro projeto, o CSP acompanha.
 *  - `frame-ancestors 'none'`: clickjacking protection (also enforced by X-Frame-Options).
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') || '';
const supabaseWs = supabaseUrl.replace(/^https:/, 'wss:');

const connectSrc = [
  "'self'",
  supabaseUrl,
  supabaseWs,
]
  .filter(Boolean)
  .join(' ');

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' https://fonts.gstatic.com data:",
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig = {
  // Produce a self-contained `.next/standalone/` we can copy into a slim
  // runtime image (see Dockerfile). Without this, the production image
  // has to carry `node_modules/` and the full source tree.
  output: 'standalone',
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS
    ? process.env.ALLOWED_DEV_ORIGINS.split(',')
    : [],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
