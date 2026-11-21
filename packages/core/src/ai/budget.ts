import type { TransactionClient } from '@floral/db';
import { aiMonthlyBudgetMicros } from './providers';

/**
 * Tetto di spesa mensile della piattaforma (ADR-024): la spesa del mese di tutte le fiorerie
 * (stimata per i job in corso, reale per quelli finiti: anteprime, descrizioni di stile e
 * scontorni) più il nuovo costo resta entro il tetto?
 */
export async function fitsMonthlyAiBudget(
  tx: TransactionClient,
  extraMicros: number,
  now: Date,
): Promise<boolean> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const spent = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT app_ai_spend_since(${monthStart}::timestamptz) AS total`;
  return Number(spent[0]?.total ?? 0) + extraMicros <= aiMonthlyBudgetMicros();
}
