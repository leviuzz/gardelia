/**
 * Piani SaaS ed entitlements [BILL-01, spec §7 Basic/Plus].
 *
 *  - Nessun prezzo nel codice: i prezzi della spec (D-16) sono PROPOSTI e vivranno nel
 *    provider di pagamento (P-04). Qui ci sono solo le capacità di ogni piano.
 *  - Gli entitlements di un piano sono DATI (tabella `SaasPlan`), validati con questo schema:
 *    un valore mancante o malformato vale "nessun accesso" (fail closed).
 *  - Nel pilota l'abbonamento è assegnato manualmente da un admin di piattaforma (C-03):
 *    nessuna sottoscrizione simulata, nessun pagamento finto.
 */
import { z } from 'zod';

export const PLAN_CODES = ['BASIC', 'PLUS'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

/** Piano applicato a una fioreria senza abbonamento attivo. */
export const DEFAULT_PLAN_CODE: PlanCode = 'BASIC';

export const SUBSCRIPTION_STATUSES = ['PILOT', 'TRIALING', 'ACTIVE', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Stati che danno accesso alle funzioni del piano (entro la fine del periodo, se presente). */
const GRANTING_STATUSES: readonly SubscriptionStatus[] = ['PILOT', 'TRIALING', 'ACTIVE'];

export const planEntitlementsSchema = z.object({
  /** Bouquet Builder (composizione guidata con prezzo deterministico). */
  bouquetBuilder: z.boolean().catch(false),
  /** Inventario: giacenze, movimenti e avvisi (ADR-060; nel Plus, domani Profesional, D-23). */
  inventory: z.boolean().catch(false),
  /**
   * Anteprime AI incluse al mese. Il consumo arriva con la pipeline AI (S1-12); la
   * politica sui tentativi falliti è la decisione aperta O-05.
   */
  aiPreviewsPerMonth: z.int().min(0).max(100_000).catch(0),
});
export type PlanEntitlements = z.infer<typeof planEntitlementsSchema>;

/** Entitlements booleani (funzioni on/off), utilizzabili con `requireEntitlement`. */
export const FEATURE_ENTITLEMENTS = ['bouquetBuilder', 'inventory'] as const;
export type FeatureEntitlement = (typeof FEATURE_ENTITLEMENTS)[number];

export const NO_ENTITLEMENTS: PlanEntitlements = Object.freeze({
  bouquetBuilder: false,
  inventory: false,
  aiPreviewsPerMonth: 0,
});

/** JSON del database → entitlements tipizzati; se non è un oggetto valido, nessun accesso. */
export function parseEntitlements(value: unknown): PlanEntitlements {
  const parsed = planEntitlementsSchema.safeParse(value);
  return parsed.success ? parsed.data : NO_ENTITLEMENTS;
}

export interface SubscriptionState {
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd: Date | null;
}

/** Un abbonamento dà accesso se lo stato lo consente e il periodo non è terminato. */
export function subscriptionGrantsAccess(
  subscription: SubscriptionState,
  now: Date = new Date(),
): boolean {
  if (!GRANTING_STATUSES.includes(subscription.status)) return false;
  return (
    subscription.currentPeriodEnd === null ||
    subscription.currentPeriodEnd.getTime() > now.getTime()
  );
}

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === 'string' && (PLAN_CODES as readonly string[]).includes(value);
}

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === 'string' && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}
