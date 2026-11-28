/**
 * La foto di una prova di pagamento di un ordine online (M3-3, ADR-088; `?size=thumb` per la
 * miniatura): solo per chi gestisce i soldi (`orders:payments`: contiene dati bancari) e finché non è
 * cancellata (30 giorni dopo la chiusura dell'ordine). Mai URL pubblici. Regole comuni:
 * lib/private-image-route.ts.
 */
import { getPaymentProofImage } from '@floral/core';
import { photoVariant } from '@/lib/image-response';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<
  RouteContext<'/app/[tenantSlug]/orders/[orderId]/proofs/[proofId]'>
>((ctx, { orderId, proofId }, request) =>
  getPaymentProofImage(ctx, orderId, proofId, photoVariant(request)),
);
