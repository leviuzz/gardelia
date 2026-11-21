import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  logger,
} from '@floral/core';
import type { FieldErrors } from '@floral/domain';
import type { ActionState } from './action-state';
import { getRequestMeta } from './request-meta';

export { idleState, type ActionState } from './action-state';

/** Traduce i codici di validazione del dominio in messaggi es-MX. */
export async function translateFieldErrors(fieldErrors: FieldErrors): Promise<Record<string, string>> {
  const t = await getTranslations('validation');
  const result: Record<string, string> = {};
  for (const [field, code] of Object.entries(fieldErrors)) {
    if (!code) continue;
    result[field] = t.has(code) ? t(code) : t('invalid');
  }
  return result;
}

/**
 * Converte qualsiasi errore di una server action in uno stato mostrabile all'utente.
 * Gli errori interni vengono loggati con requestId e mai mostrati nel dettaglio.
 * I redirect/notFound di Next vengono rilanciati.
 */
export async function actionError(error: unknown): Promise<ActionState> {
  unstable_rethrow(error);
  const t = await getTranslations('errors');
  if (error instanceof ValidationError) {
    return {
      status: 'error',
      message: t('validation'),
      fieldErrors: await translateFieldErrors(error.fieldErrors),
    };
  }
  if (error instanceof ConflictError) {
    const key = `conflict.${error.reason}`;
    return { status: 'error', message: t.has(key) ? t(key) : t('generic') };
  }
  if (error instanceof ForbiddenError) return { status: 'error', message: t('forbidden') };
  if (error instanceof NotFoundError) return { status: 'error', message: t('notFound') };

  const { requestId } = await getRequestMeta();
  logger.error({ err: error, requestId }, 'errore inatteso in una server action');
  return {
    status: 'error',
    message: requestId ? t('unexpectedWithId', { requestId }) : t('unexpected'),
  };
}
