/**
 * "Mi tienda en línea" (marketplace, blocco C2): la pagina pubblica della fioreria con i prodotti
 * che sceglie di mostrare. Qui le regole pure: quali prodotti si possono mostrare, come si paga,
 * limiti dei testi.
 */
import { z } from 'zod';
import { checkboxField, multiValueField, optionalText, requiredInteger } from './validation';

/**
 * Tipi di prodotto che un cliente può volere dalla pagina pubblica: ramos, piante, fiori sciolti
 * e accessori (globo, peluche, chocolates). Non i materiali di lavoro (fogliame, carte,
 * contenitori) né i servizi interni.
 */
export const ONLINE_ITEM_TYPES = ['BOUQUET', 'PLANT', 'CUT_FLOWER', 'ACCESSORY'] as const;

export function canShowOnline(type: string): boolean {
  return (ONLINE_ITEM_TYPES as readonly string[]).includes(type);
}

/**
 * Come si paga alla fioreria (pagamento diretto, D-26): nessun pagamento passa da Gardelia. Sulla
 * pagina sono solo informazioni per il cliente.
 */
export const STORE_PAYMENT_METHODS = ['TRANSFER', 'CASH', 'CARD_IN_STORE', 'PAYMENT_LINK'] as const;
export type StorePaymentMethod = (typeof STORE_PAYMENT_METHODS)[number];

export const STORE_LIMITS = {
  description: 600,
  paymentInstructions: 500,
  /**
   * Prodotti online per fioreria (M1, PROPOSTO): si controlla quando se ne accende uno, così la
   * vetrina non ne taglia mai in silenzio (fino a M0 ne mostrava solo i primi 120 per nome).
   */
  onlineItems: 500,
  /** Prodotti in evidenza nella riga «Destacados» della vetrina (M1, PROPOSTO). */
  featured: 8,
  /** Ognuna delle politiche della fioreria (cambi, cancellazioni, sostituzioni). */
  policy: 1000,
} as const;

/** Modulo "Tienda en línea" delle impostazioni (la pubblicazione ha un pulsante a parte). */
export const onlineStoreFormSchema = z.object({
  description: optionalText(STORE_LIMITS.description),
  paymentMethods: multiValueField(
    z.enum(STORE_PAYMENT_METHODS, { error: 'invalid_option' }),
    STORE_PAYMENT_METHODS.length,
  ),
  paymentInstructions: optionalText(STORE_LIMITS.paymentInstructions),
});
export type OnlineStoreInput = z.infer<typeof onlineStoreFormSchema>;

/**
 * Politiche della fioreria verso chi compra (M1): testi suoi, facoltativi, mostrati nella vetrina e
 * nel riepilogo dell'ordine. Gardelia non scrive condizioni legali per la fioreria (PROFECO: DA
 * VALIDARE con un professionista, dalla fioreria).
 */
export const STORE_POLICY_FIELDS = [
  'policyChanges',
  'policyCancellations',
  'policySubstitutions',
] as const;
export type StorePolicyField = (typeof STORE_POLICY_FIELDS)[number];

export const storePoliciesSchema = z.object({
  policyChanges: optionalText(STORE_LIMITS.policy),
  policyCancellations: optionalText(STORE_LIMITS.policy),
  policySubstitutions: optionalText(STORE_LIMITS.policy),
});
export type StorePoliciesInput = z.infer<typeof storePoliciesSchema>;

/**
 * "Pedidos en línea" (ADR-067): se chi compra può ordinare dalla pagina e con quanti giorni di
 * anticipo (0 = anche per oggi).
 */
export const onlineOrderSettingsSchema = z.object({
  ordersEnabled: checkboxField(),
  minLeadDays: requiredInteger({ min: 0, max: 14 }),
});
export type OnlineOrderSettingsInput = z.infer<typeof onlineOrderSettingsSchema>;

/**
 * Cosa manca per ricevere ordini: chi compra deve sapere come pagare (il pagamento è diretto con
 * la fioreria) e poterla chiamare.
 */
export type OnlineOrdersBlocker = 'store_needs_payment' | 'store_needs_contact';

export function onlineOrdersBlockers(input: {
  readonly paymentMethods: readonly string[];
  readonly contactPhone: string | null;
}): OnlineOrdersBlocker[] {
  const blockers: OnlineOrdersBlocker[] = [];
  if (input.paymentMethods.length === 0) blockers.push('store_needs_payment');
  if (!input.contactPhone) blockers.push('store_needs_contact');
  return blockers;
}

/** Interruttore "Publicar mi tienda". */
export const storePublishSchema = z.object({ publish: checkboxField() });

/** Cosa manca per pubblicare (codici tradotti nella UI). */
export type StorePublishBlocker = 'store_needs_items' | 'store_needs_contact';

export function storePublishBlockers(input: {
  readonly onlineItems: number;
  readonly contactPhone: string | null;
}): StorePublishBlocker[] {
  const blockers: StorePublishBlocker[] = [];
  if (input.onlineItems === 0) blockers.push('store_needs_items');
  // Senza ordini online (fino a C4) il cliente scrive alla fioreria: serve il telefono.
  if (!input.contactPhone) blockers.push('store_needs_contact');
  return blockers;
}

/** Immagini della tienda: logo (piccolo, accanto al nome) e copertina (larga, in alto). */
export const STORE_IMAGE_KINDS = ['LOGO', 'COVER'] as const;
export type StoreImageKind = (typeof STORE_IMAGE_KINDS)[number];

export function isStoreImageKind(value: unknown): value is StoreImageKind {
  return typeof value === 'string' && (STORE_IMAGE_KINDS as readonly string[]).includes(value);
}
