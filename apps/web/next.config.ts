import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// Unica fonte delle variabili in sviluppo: `.env` nella root del monorepo.
// In CI/produzione le variabili arrivano dall'ambiente e hanno la precedenza.
loadEnv({ path: `${repoRoot}.env`, quiet: true });

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// HSTS solo quando l'app è servita in HTTPS (in locale su http verrebbe ignorato o darebbe problemi).
const isHttps = (process.env.APP_URL ?? '').startsWith('https://');

/** Header di sicurezza statici. Il Content-Security-Policy (con nonce) è impostato in src/proxy.ts. */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isHttps
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // I pacchetti del monorepo sono "internal packages": esportano sorgenti TypeScript.
  transpilePackages: ['@floral/domain', '@floral/db', '@floral/core'],
  serverExternalPackages: ['nodemailer'],
  experimental: {
    // Foto del catalogo e di "Mis ramos": una per richiesta, al massimo 8 MB (ADR-029); il
    // proxy di Next accetta già fino a 10 MB.
    serverActions: { bodySizeLimit: '9mb' },
  },
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
