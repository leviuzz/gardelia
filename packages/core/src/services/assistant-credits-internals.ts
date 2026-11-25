/**
 * Asistente de plantas (ADR-085, blocco 6b): i saldi dei crediti e il ritorno a fine contratto.
 * Separato dagli aiuti del modello così chi chiude i contratti non carica l'SDK.
 */
import type { TransactionClient } from '@floral/db';

/** Crediti PLANT_ASSISTANT comprati dalla fioreria e quelli dati ai contratti (resi compresi). */
export async function shopAssistantCreditsTx(
  tx: TransactionClient,
  tenantId: string,
): Promise<{ readonly purchased: number; readonly allocated: number }> {
  const [granted, allocated] = await Promise.all([
    tx.aiCreditGrant.aggregate({
      where: { tenantId, feature: 'PLANT_ASSISTANT' },
      _sum: { units: true },
    }),
    tx.assistantCreditAllocation.aggregate({
      where: { tenantId },
      _sum: { credits: true },
    }),
  ]);
  return { purchased: granted._sum.units ?? 0, allocated: allocated._sum.credits ?? 0 };
}

/** I crediti di un contratto visti dalla fioreria: dati, resi, usati (risposte del cliente), riservati. */
export async function contractAssistantCreditsTx(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
  now: Date = new Date(),
): Promise<{
  readonly given: number;
  readonly returned: number;
  readonly used: number;
  readonly held: number;
  readonly lastUsedAt: Date | null;
}> {
  const [given, returned, used, held, last] = await Promise.all([
    tx.assistantCreditAllocation.aggregate({
      where: { tenantId, subscriptionId, kind: 'GIVE' },
      _sum: { credits: true },
    }),
    tx.assistantCreditAllocation.aggregate({
      where: { tenantId, subscriptionId, kind: 'RETURN_ENDED' },
      _sum: { credits: true },
    }),
    tx.assistantAnswer.count({ where: { tenantId, subscriptionId, channel: 'PORTAL' } }),
    tx.assistantCreditHold.count({ where: { tenantId, subscriptionId, expiresAt: { gt: now } } }),
    tx.assistantAnswer.findFirst({
      where: { tenantId, subscriptionId, channel: 'PORTAL' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  return {
    given: given._sum.credits ?? 0,
    returned: -(returned._sum.credits ?? 0),
    used,
    held,
    lastUsedAt: last?.createdAt ?? null,
  };
}

/**
 * Fine del contratto: i crediti non usati tornano alla fioreria (una riga `RETURN_ENDED`
 * negativa) e le riserve in corso si tolgono. Va chiamata nella transazione che chiude il
 * contratto, con il contratto già sotto lock. Restituisce i crediti resi (0 = niente da rendere).
 */
export async function returnAssistantCreditsTx(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
  userId: string | null,
): Promise<number> {
  await tx.assistantCreditHold.deleteMany({ where: { tenantId, subscriptionId } });
  const [allocated, used] = await Promise.all([
    tx.assistantCreditAllocation.aggregate({
      where: { tenantId, subscriptionId },
      _sum: { credits: true },
    }),
    tx.assistantAnswer.count({ where: { tenantId, subscriptionId, channel: 'PORTAL' } }),
  ]);
  const unused = (allocated._sum.credits ?? 0) - used;
  if (unused <= 0) return 0;
  await tx.assistantCreditAllocation.create({
    data: {
      tenantId,
      subscriptionId,
      kind: 'RETURN_ENDED',
      credits: -unused,
      createdByUserId: userId,
    },
    select: { id: true },
  });
  return unused;
}
