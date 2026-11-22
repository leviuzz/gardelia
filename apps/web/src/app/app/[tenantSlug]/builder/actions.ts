'use server';

/**
 * Server action del Diseñador. Il client invia solo ID, quantità e dettagli: prezzi, costi e
 * disponibilità sono riletti e ricalcolati dal servizio (@floral/core). Contesto, errori, pagine
 * da ricaricare e messaggi: `runTenantAction`.
 */
import {
  requestBouquetPreview,
  saveBouquetConfiguration,
  setBouquetConfigurationArchived,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { runTenantAction, section } from '@/lib/tenant-action';

export async function saveDesignAction(
  slug: string,
  configurationId: string | null,
  _prev: ActionState,
  payload: unknown,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { id } = await saveBouquetConfiguration(ctx, payload, configurationId ?? undefined);
    return {
      revalidate: section(routes.builder.list()),
      // Un disegno nuovo si apre nella sua pagina; uno esistente resta dov'è, con il toast.
      redirectTo: configurationId === null ? routes.builder.design(id, { saved: true }) : undefined,
      success: 'builder.editor.saved',
    };
  });
}

export async function setDesignArchivedAction(
  slug: string,
  configurationId: string,
  archived: boolean,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await setBouquetConfigurationArchived(ctx, configurationId, archived);
    return { revalidate: section(routes.builder.list()), success: 'common.changesSaved' };
  });
}

/**
 * "Generar otra versión": una foto nuova dello stesso ramo anche se ce n'è già una (1 credito,
 * confermato nella finestra). I preventivi già creati tengono la loro immagine.
 */
export async function requestAnotherPreviewAction(
  slug: string,
  configurationId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await requestBouquetPreview(ctx, configurationId, new Date(), { anotherVersion: true });
    return {
      revalidate: routes.builder.design(configurationId),
      success: 'builder.preview.anotherRequested',
    };
  });
}

/** Richiede l'anteprima AI del disegno salvato: credito e cache gestiti dal servizio. */
export async function requestPreviewAction(
  slug: string,
  configurationId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await requestBouquetPreview(ctx, configurationId);
    return {
      revalidate: routes.builder.design(configurationId),
      success: 'builder.preview.requested',
    };
  });
}
