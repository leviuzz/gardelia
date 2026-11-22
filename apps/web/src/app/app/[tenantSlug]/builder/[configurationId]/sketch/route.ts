/**
 * Boceto esatto del disegno salvato (ADR-034): PNG disegnato dai ritagli delle foto della
 * fioreria, servito solo ai suoi membri con il piano che include il Builder. L'URL della pagina
 * porta `?v=<versione>`: cambia quando cambia il boceto, quindi la cache del browser è sicura.
 * Regole comuni: lib/private-image-route.ts.
 */
import { getBouquetSketch } from '@floral/core';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<
  RouteContext<'/app/[tenantSlug]/builder/[configurationId]/sketch'>
>((ctx, { configurationId }) => getBouquetSketch(ctx, configurationId));
