/**
 * L'avviso per email di un blocco di giorni (blocco 4, ADR-083): i cambi di un contratto come li
 * legge l'invio, dal membro dopo il commit o dal lavoro giornaliero che riprova. Una riga d'uscita
 * (`CareEmail` con `blockId`) per blocco e contratto. NON esportato da `@floral/core`.
 */
import type { TransactionClient } from '@floral/db';
import { formatTimeOfDay } from '@floral/domain';
import type { CareBlockNoticeChange } from '../care-email';
import { addressLineOf, isoOf } from './care-internals';

export interface CareBlockNoticeData {
  readonly customerName: string;
  readonly customerEmail: string | null;
  /** La sede del contratto, per un cliente con più sedi. */
  readonly place: string | null;
  readonly changes: readonly CareBlockNoticeChange[];
}

function time(minutes: number | null): string | null {
  return minutes === null ? null : formatTimeOfDay(minutes);
}

/** I cambi di un contratto in un blocco, in ordine di giorno; null se non ce ne sono. */
export async function loadBlockNoticeTx(
  tx: TransactionClient,
  tenantId: string,
  blockId: string,
  subscriptionId: string,
): Promise<CareBlockNoticeData | null> {
  const [subscription, rows] = await Promise.all([
    tx.customerSubscription.findFirst({
      where: { tenantId, id: subscriptionId },
      select: {
        customer: { select: { displayName: true, email: true } },
        customerAddress: { select: { addressLine1: true, neighborhood: true } },
      },
    }),
    tx.careBlockVisit.findMany({
      where: { tenantId, blockId, subscriptionId },
      orderBy: [{ fromDate: 'asc' }, { fromStartMinutes: 'asc' }, { id: 'asc' }],
      select: {
        outcome: true,
        fromDate: true,
        fromStartMinutes: true,
        fromEndMinutes: true,
        toDate: true,
        toStartMinutes: true,
        toEndMinutes: true,
      },
    }),
  ]);
  if (!subscription || rows.length === 0) return null;
  return {
    customerName: subscription.customer.displayName,
    customerEmail: subscription.customer.email,
    place: subscription.customerAddress ? addressLineOf(subscription.customerAddress) : null,
    changes: rows.map((row) => ({
      outcome: row.outcome,
      from: {
        date: isoOf(row.fromDate) ?? '',
        start: time(row.fromStartMinutes),
        end: time(row.fromEndMinutes),
      },
      to:
        row.toDate && row.toStartMinutes !== null && row.toEndMinutes !== null
          ? {
              date: isoOf(row.toDate) ?? '',
              start: formatTimeOfDay(row.toStartMinutes),
              end: formatTimeOfDay(row.toEndMinutes),
            }
          : null,
    })),
  };
}
