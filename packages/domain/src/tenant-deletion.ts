/**
 * "Eliminar florería" (ADR-074, deciso dal founder il 24/11/2026): la fioreria si archivia subito
 * (sparisce per tutti) e si cancella davvero dopo 30 giorni, durante i quali il titolare può
 * recuperarla. Regole pure: blocchi, data della cancellazione, conferma con il nome.
 */
import { z } from 'zod';
import { isOrderFinal, type OrderStatus } from './order';

export const TENANT_DELETION = {
  /** Giorni in cui la fioreria archiviata si può ancora recuperare. */
  graceDays: 30,
  /** Fiorerie cancellate per giro della manutenzione giornaliera. */
  purgePerRun: 20,
} as const;

/** Cosa impedisce di eliminare la fioreria adesso. */
export type TenantDeletionBlocker = 'tenant_deletion_open_orders';

/**
 * Ordini in corso: chi ha ordinato aspetta i fiori. Un borrador non è ancora un impegno e non
 * blocca; gli ordini consegnati, ritirati o annullati nemmeno.
 */
export function tenantDeletionBlockers(input: {
  readonly orderStatuses: readonly OrderStatus[];
}): TenantDeletionBlocker[] {
  const open = input.orderStatuses.some((status) => status !== 'DRAFT' && !isOrderFinal(status));
  return open ? ['tenant_deletion_open_orders'] : [];
}

/** Il giorno da cui la fioreria si cancella davvero (30 giorni dopo la richiesta). */
export function tenantDeleteAfter(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + TENANT_DELETION.graceDays * 24 * 60 * 60 * 1000);
}

/** Nome confrontato senza maiuscole, accenti e spazi doppi: "Florería  Las Rosas" = "floreria las rosas". */
function comparableName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es');
}

/**
 * Conferma: si scrive il nome della fioreria, così non si elimina quella sbagliata con un clic.
 * Errore `tenant_deletion_name_mismatch` sul campo.
 */
export function tenantDeletionSchema(tenantName: string) {
  return z.object({
    confirmName: z
      .string({ error: 'required' })
      .trim()
      .min(1, { error: 'required' })
      .max(200, { error: 'too_long' })
      .refine((value) => comparableName(value) === comparableName(tenantName), {
        error: 'tenant_deletion_name_mismatch',
      }),
  });
}
