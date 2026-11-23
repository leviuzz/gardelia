import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PlanRequiredError,
  ValidationError,
  logger,
} from '@floral/core';
import type { FieldErrors } from '@floral/domain';
import type { ActionState } from './action-state';
import { getRequestMeta } from './request-meta';

export { idleState, type ActionState } from './action-state';

/** Traduce i codici di validazione del dominio in messaggi es-MX. */
export async function translateFieldErrors(
  fieldErrors: FieldErrors,
): Promise<Record<string, string>> {
  const t = await getTranslations('validation');
  const root = await getTranslations();
  const result: Record<string, string> = {};
  for (const [field, code] of Object.entries(fieldErrors)) {
    if (!code) continue;
    // Moduli con i testi nel proprio namespace (ADR-060): `inventory_x` → `inventory.validation.x`.
    const moduleKey = namespacedKey(code, 'validation');
    result[field] = t.has(code)
      ? t(code)
      : moduleKey && root.has(moduleKey)
        ? root(moduleKey)
        : t('invalid');
  }
  return result;
}

/**
 * Chiave di un testo nel namespace del suo modulo: `inventory_insufficient_stock` →
 * `inventory.conflict.insufficient_stock`; null se il codice non ha il prefisso del modulo.
 */
export function namespacedKey(code: string, group: 'conflict' | 'validation'): string | null {
  const match = /^([a-z]+)_(.+)$/.exec(code);
  return match ? `${match[1]}.${group}.${match[2]}` : null;
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
    if (t.has(key)) return { status: 'error', message: t(key) };
    // Moduli con i testi nel proprio namespace (ADR-060): `inventory_x` → `inventory.conflict.x`.
    const moduleKey = namespacedKey(error.reason, 'conflict');
    const root = await getTranslations();
    return {
      status: 'error',
      message: moduleKey && root.has(moduleKey) ? root(moduleKey) : t('generic'),
    };
  }
  if (error instanceof ForbiddenError) return { status: 'error', message: t('forbidden') };
  if (error instanceof PlanRequiredError) return { status: 'error', message: t('planRequired') };
  if (error instanceof NotFoundError) return { status: 'error', message: t('notFound') };

  const { requestId } = await getRequestMeta();
  logger.error({ err: error, requestId }, 'errore inatteso in una server action');
  return {
    status: 'error',
    message: requestId ? t('unexpectedWithId', { requestId }) : t('unexpected'),
  };
}
