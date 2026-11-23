/**
 * Anteprima del logo (`logo`) o della copertina (`cover`) nelle impostazioni della tienda
 * (ADR-065), anche prima di pubblicarla: solo ai membri della fioreria. Regole comuni:
 * lib/private-image-route.ts.
 */
import { getStoreImage } from '@floral/core';
import { privateImageRoute } from '@/lib/private-image-route';

const KINDS: Readonly<Record<string, 'LOGO' | 'COVER'>> = { logo: 'LOGO', cover: 'COVER' };

export const GET = privateImageRoute<RouteContext<'/app/[tenantSlug]/settings/store/image/[kind]'>>(
  (ctx, { kind }) => getStoreImage(ctx, KINDS[kind]),
);
