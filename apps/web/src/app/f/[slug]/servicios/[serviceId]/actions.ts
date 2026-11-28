'use server';

/**
 * «Enviar solicitud» di un servizio della vetrina (M5, ADR-089). Chi compra arriva SOLO dalla
 * sessione (`runBuyerAction`); slug e servizio legati con `.bind()` vengono dal browser, ma
 * diventano una fioreria e un servizio solo se sono pubblicati (lo verifica il servizio).
 */
import { cookies } from 'next/headers';
import { submitServiceRequest } from '@floral/core';
import { SERVICE_REQUEST_LIMITS } from '@floral/domain';
import type { ActionState } from '@/lib/action-state';
import { FOUND_COOKIE, foundSlugs } from '@/lib/attribution';
import { runBuyerAction } from '@/lib/buyer';
import { formDataToObject } from '@/lib/form-data';
import { orderMailDeps } from '@/lib/order-mail';
import { getRequestMeta } from '@/lib/request-meta';
import { accountRoutes, publicStoreRoutes } from '@/lib/routes';
import { uploadedPhotoList } from '@/lib/uploads';

export async function submitServiceRequestAction(
  slug: string,
  serviceId: string,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      const photos = await uploadedPhotoList(formData, 'photos', SERVICE_REQUEST_LIMITS.photos);
      formData.delete('photos');
      // Arrivato dalla ricerca di Gardelia (cookie dell'attribuzione): l'origine del cliente.
      const fromSearch = foundSlugs((await cookies()).get(FOUND_COOKIE)?.value).includes(slug);
      const sent = await submitServiceRequest(
        ctx,
        slug,
        serviceId,
        formDataToObject(formData),
        photos,
        { fromSearch, request: await getRequestMeta() },
        orderMailDeps(),
      );
      return {
        revalidate: accountRoutes.home,
        redirectTo: accountRoutes.requests.detail(sent.requestId, { enviada: true }),
      };
    },
    { next: publicStoreRoutes(slug).service(serviceId) },
  );
}
