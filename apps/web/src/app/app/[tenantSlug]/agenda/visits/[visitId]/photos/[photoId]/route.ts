/**
 * Una foto di una visita di Floral Care (ADR-076; `?size=thumb` per la miniatura): solo per i
 * membri della fioreria che vedono i contratti, e solo finché non è tolta né cancellata. Mai URL
 * pubblici. Regole comuni: lib/private-image-route.ts.
 */
import { getCareVisitPhotoImage } from '@floral/core';
import { photoVariant } from '@/lib/image-response';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<
  RouteContext<'/app/[tenantSlug]/agenda/visits/[visitId]/photos/[photoId]'>
>((ctx, { visitId, photoId }, request) =>
  getCareVisitPhotoImage(ctx, visitId, photoId, photoVariant(request)),
);
