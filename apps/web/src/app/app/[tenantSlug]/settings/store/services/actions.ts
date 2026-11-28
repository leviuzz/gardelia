'use server';

/**
 * «Servizi in vetrina» (M5, ADR-089): le azioni delle Impostazioni. La chiave del servizio legata
 * con `.bind()` arriva dal browser: diventa un servizio solo se è della fioreria (lo controlla il
 * servizio, che risponde 404 con l'evento di sicurezza per un ID di un'altra fioreria).
 */
import {
  ValidationError,
  addStorefrontServicePhoto,
  archiveStorefrontService,
  createStorefrontService,
  moveStorefrontService,
  removeStorefrontServicePhoto,
  saveStorefrontService,
  setStorefrontServicePublished,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { formDataToObject } from '@/lib/form-data';
import { publicStoreRoutes } from '@/lib/routes';
import { storefrontServiceTarget } from '@/lib/storefront-services';
import { runTenantAction } from '@/lib/tenant-action';
import { uploadedBytes } from '@/lib/uploads';

function targetOf(key: string) {
  const target = storefrontServiceTarget(key);
  if (!target) throw new ValidationError({ _form: 'invalid_option' });
  return target;
}

/** Testi, «Desde $X» e (per un servizio della fioreria) nome e domande del modulo. */
export async function saveStorefrontServiceAction(
  slug: string,
  key: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await saveStorefrontService(ctx, targetOf(key), formDataToObject(formData));
    return {
      revalidate: [routes.settings.storeServices, routes.settings.storeService(key)],
      success: 'storeServices.saved',
    };
  });
}

/** «Nuovo servizio»: si crea spento e si apre la sua scheda per foto e testi. */
export async function createStorefrontServiceAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const created = await createStorefrontService(ctx, formDataToObject(formData));
    return {
      revalidate: routes.settings.storeServices,
      redirectTo: routes.settings.storeService(created.id),
      success: 'storeServices.created',
    };
  });
}

/** Accende o spegne un servizio in vetrina. */
export async function setStorefrontServicePublishedAction(
  slug: string,
  key: string,
  published: boolean,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await setStorefrontServicePublished(ctx, targetOf(key), published === true);
    return {
      revalidate: [
        routes.settings.storeServices,
        routes.settings.storeService(key),
        publicStoreRoutes(ctx.tenantSlug).home,
      ],
      success: published ? 'storeServices.published' : 'storeServices.unpublished',
    };
  });
}

/** Le frecce dell'ordine in vetrina (solo i servizi della fioreria). */
export async function moveStorefrontServiceAction(
  slug: string,
  serviceId: string,
  direction: 'up' | 'down',
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await moveStorefrontService(ctx, serviceId, direction === 'up' ? 'up' : 'down');
    return { revalidate: routes.settings.storeServices };
  });
}

/** Archivia un servizio della fioreria: sparisce dalla vetrina, le richieste restano. */
export async function archiveStorefrontServiceAction(
  slug: string,
  serviceId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await archiveStorefrontService(ctx, serviceId);
    return {
      revalidate: [routes.settings.storeServices, publicStoreRoutes(ctx.tenantSlug).home],
      redirectTo: routes.settings.storeServices,
      success: 'storeServices.archived',
    };
  });
}

/** Una foto (il caricamento le manda una alla volta, già ridotte nel browser). */
export async function uploadStorefrontServicePhotoAction(
  slug: string,
  key: string,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addStorefrontServicePhoto(ctx, targetOf(key), await uploadedBytes(formData));
    return { revalidate: [routes.settings.storeServices, routes.settings.storeService(key)] };
  });
}

export async function removeStorefrontServicePhotoAction(
  slug: string,
  key: string,
  photoId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeStorefrontServicePhoto(ctx, photoId);
    return {
      revalidate: [routes.settings.storeServices, routes.settings.storeService(key)],
      success: 'storeServices.photoRemoved',
    };
  });
}
