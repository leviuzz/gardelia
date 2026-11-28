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
  /** M3-3: anche lo staff accetta e rifiuta gli ordini online (spento di default). */
  staffCanAccept: checkboxField(),
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

/**
 * «Completa la tua vetrina» (M1-2, ADR-087, PROPOSTO): i passi che rendono la vetrina utile a chi
 * compra. Non bloccano la pubblicazione (per quella valgono `storePublishBlockers`): dicono al
 * fiorista che cosa manca, e la pagina porta al punto dove si fa.
 */
export const STORE_READINESS_STEPS = [
  'images',
  'description',
  'products',
  'photos',
  'featured',
  'deliveryFee',
  'payment',
  'policies',
] as const;
export type StoreReadinessStep = (typeof STORE_READINESS_STEPS)[number];

/** Prodotti online consigliati (PROPOSTO): una riga piena di «Destacados» e una vetrina da sfogliare. */
export const STORE_READINESS_MIN_ITEMS = 8;

export interface StoreReadinessInput {
  readonly hasLogo: boolean;
  readonly hasCover: boolean;
  readonly hasDescription: boolean;
  readonly onlineItems: number;
  readonly onlineWithoutPhoto: number;
  readonly featuredItems: number;
  /** Chi compra vede un costo di consegna (non «por confirmar»). */
  readonly hasDeliveryFee: boolean;
  readonly paymentMethods: number;
  /** Politiche scritte (0–3). */
  readonly policies: number;
}

export interface StoreReadiness {
  readonly steps: readonly { readonly step: StoreReadinessStep; readonly done: boolean }[];
  /** Passi ancora da fare (0 = vetrina completa). */
  readonly missing: number;
}

export function storeReadiness(input: StoreReadinessInput): StoreReadiness {
  const done: Record<StoreReadinessStep, boolean> = {
    images: input.hasLogo && input.hasCover,
    description: input.hasDescription,
    products: input.onlineItems >= STORE_READINESS_MIN_ITEMS,
    // Senza prodotti online non c'è niente da fotografare: il passo resta da fare.
    photos: input.onlineItems > 0 && input.onlineWithoutPhoto === 0,
    featured: input.featuredItems > 0,
    deliveryFee: input.hasDeliveryFee,
    payment: input.paymentMethods > 0,
    policies: input.policies > 0,
  };
  const steps = STORE_READINESS_STEPS.map((step) => ({ step, done: done[step] }));
  return { steps, missing: steps.filter((entry) => !entry.done).length };
}

/** Immagini della tienda: logo (piccolo, accanto al nome) e copertina (larga, in alto). */
export const STORE_IMAGE_KINDS = ['LOGO', 'COVER'] as const;
export type StoreImageKind = (typeof STORE_IMAGE_KINDS)[number];

export function isStoreImageKind(value: unknown): value is StoreImageKind {
  return typeof value === 'string' && (STORE_IMAGE_KINDS as readonly string[]).includes(value);
}
