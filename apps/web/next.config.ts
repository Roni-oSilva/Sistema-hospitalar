import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Em produção o Nginx serve /api e /socket.io direto da API (mesma origem). Em desenvolvimento, o próprio Next
 * encaminha /api para a API local — assim o cookie de sessão é de mesma origem nos dois cenários.
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? '';
const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  // Next injeta scripts inline de hidratação; em dev também precisa de eval (React Refresh)
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ws: wss:${SOCKET_URL ? ` ${SOCKET_URL}` : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  // monorepo: rastreia dependências a partir da raiz (inclui packages/shared no build standalone)
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
