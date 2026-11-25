/**
 * La foto di una consulta dell'Asistente de plantas (ADR-085; `?size=thumb` per la miniatura):
 * solo per chi usa l'assistente nella fioreria, del contratto del percorso, finché non è cancellata
 * (30 giorni dopo la fine del contratto). Mai URL pubblici. Regole comuni: lib/private-image-route.ts.
 */
import { getAssistantPhotoImage } from '@floral/core';
import { photoVariant } from '@/lib/image-response';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<
  RouteContext<'/app/[tenantSlug]/subscriptions/[subscriptionId]/assistant/photos/[caseId]'>
>((ctx, { subscriptionId, caseId }, request) =>
  getAssistantPhotoImage(ctx, caseId, photoVariant(request), subscriptionId),
);
