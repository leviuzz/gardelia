/**
 * Sostituto quando manca un fiore (ADR-081, CAT-01): in un pedido confermato un ingrediente di un
 * ramo è agotado nel catalogo o non basta in inventario. Si propongono prodotti simili disponibili
 * e si cambia SOLO come dice la regola del ramo, mai in silenzio (spec §6.4). Il prezzo del pedido
 * resta quello concordato: cambia la distinta (e quindi cosa esce dall'inventario e il costo).
 */
import { z } from 'zod';
import type { Availability, CatalogItemType, RecordStatus, SaleUnit } from './catalog';
import type { SubstitutionPolicy } from './recipe';
import { checkboxField, toTrimmedString } from './validation';

/** Come si può cambiare un ingrediente di una riga. */
export type SubstitutionMode = 'ALLOWED' | 'ASK_CUSTOMER' | 'NOT_ALLOWED';

/**
 * La regola della riga: i ramos del catalogo seguono la loro politica; i disegni del Diseñador li
 * ha scelti il cliente, quindi si chiede sempre.
 */
export function substitutionMode(
  line: { readonly kind: 'CATALOG_ITEM' | 'BUILDER' },
  policy: SubstitutionPolicy | null,
): SubstitutionMode {
  if (line.kind === 'BUILDER') return 'ASK_CUSTOMER';
  if (policy === 'NOT_ALLOWED') return 'NOT_ALLOWED';
  if (policy === 'SIMILAR_ALLOWED') return 'ALLOWED';
  return 'ASK_CUSTOMER';
}

/** Un prodotto del catalogo come candidato (o come ingrediente che manca). */
export interface SubstituteItem {
  readonly id: string;
  readonly type: CatalogItemType;
  readonly name: string;
  readonly variety: string | null;
  readonly canonicalFlowerId: string | null;
  readonly colors: readonly string[];
  readonly saleUnit: SaleUnit;
  readonly priceMinor: number;
  readonly availability: Availability;
  readonly status: RecordStatus;
}

/** Perché un prodotto è proposto: stessa specie, stesso colore, o stesso tipo (verde, materiali). */
export type SubstituteReason = 'SAME_SPECIES' | 'SAME_COLOR' | 'SAME_KIND';

export interface RankedSubstitute {
  readonly item: SubstituteItem;
  readonly reason: SubstituteReason;
}

/** Tipi in cui un altro prodotto dello stesso tipo è già un buon sostituto (non i fiori). */
const KIND_IS_ENOUGH: readonly CatalogItemType[] = [
  'FOLIAGE',
  'CONTAINER',
  'PACKAGING',
  'ACCESSORY',
];

export const SUBSTITUTE_LIMIT = 4;

/**
 * Un prodotto può prendere il posto dell'ingrediente? Stesso tipo e stessa unità (12 tallos restano
 * 12 tallos), attivo, non agotado e non già nella distinta. Vale per i proposti e per il server.
 */
export function canSubstitute(
  missing: Pick<SubstituteItem, 'id' | 'type' | 'saleUnit'>,
  candidate: SubstituteItem,
  inRecipe: ReadonlySet<string>,
): boolean {
  return (
    candidate.id !== missing.id &&
    !inRecipe.has(candidate.id) &&
    candidate.status === 'ACTIVE' &&
    candidate.availability !== 'OUT_OF_STOCK' &&
    candidate.type === missing.type &&
    candidate.saleUnit === missing.saleUnit
  );
}

function reasonFor(missing: SubstituteItem, candidate: SubstituteItem): SubstituteReason | null {
  if (missing.canonicalFlowerId && candidate.canonicalFlowerId === missing.canonicalFlowerId) {
    return 'SAME_SPECIES';
  }
  if (missing.colors.some((color) => candidate.colors.includes(color))) return 'SAME_COLOR';
  return KIND_IS_ENOUGH.includes(missing.type) ? 'SAME_KIND' : null;
}

const REASON_ORDER: Record<SubstituteReason, number> = {
  SAME_SPECIES: 0,
  SAME_COLOR: 1,
  SAME_KIND: 2,
};

/**
 * I sostituti proposti, i migliori prima: stessa specie (un'altra varietà), poi stesso colore, poi
 * (per verde e materiali) stesso tipo; a parità il prezzo più vicino, poi il nome. `enough` dice
 * se c'è merce per la quantità che serve (false = scartato; undefined = non controllato).
 */
export function rankSubstitutes(
  missing: SubstituteItem,
  candidates: readonly SubstituteItem[],
  options: {
    readonly inRecipe: ReadonlySet<string>;
    readonly enough?: (itemId: string) => boolean;
    readonly limit?: number;
  },
): RankedSubstitute[] {
  const ranked: RankedSubstitute[] = [];
  for (const candidate of candidates) {
    if (!canSubstitute(missing, candidate, options.inRecipe)) continue;
    if (options.enough && !options.enough(candidate.id)) continue;
    const reason = reasonFor(missing, candidate);
    if (reason) ranked.push({ item: candidate, reason });
  }
  return ranked
    .sort(
      (a, b) =>
        REASON_ORDER[a.reason] - REASON_ORDER[b.reason] ||
        Math.abs(a.item.priceMinor - missing.priceMinor) -
          Math.abs(b.item.priceMinor - missing.priceMinor) ||
        a.item.name.localeCompare(b.item.name, 'es') ||
        (a.item.variety ?? '').localeCompare(b.item.variety ?? '', 'es'),
    )
    .slice(0, options.limit ?? SUBSTITUTE_LIMIT);
}

/** Il nome di un fiore come lo legge il cliente: nome e varietà. */
export function substituteItemLabel(item: {
  readonly name: string;
  readonly variety: string | null;
}): string {
  return item.variety ? `${item.name} ${item.variety}` : item.name;
}

/**
 * La domanda di «Chiedi nell'app» (M3-2): la stessa proposta del messaggio di WhatsApp, nel filo
 * dell'ordine e nella lingua del mercato come gli altri testi scritti per chi compra (V1: Messico).
 * La scrive il servizio con i nomi del database, mai il browser.
 */
export function substitutionQuestionText(input: {
  readonly bouquet: string;
  readonly from: string;
  readonly to: string;
}): string {
  return `Para tu pedido de ${input.bouquet} se nos acabó ${input.from}. ¿Te parece si usamos ${input.to}? El precio no cambia.`;
}

/** Il form "Cambiar flor": riga, ingrediente che manca, sostituto e, se serve, l'ok del cliente. */
export const orderSubstitutionSchema = z.object({
  lineId: z.preprocess(toTrimmedString, z.uuid({ error: 'invalid_option' })),
  fromItemId: z.preprocess(toTrimmedString, z.uuid({ error: 'invalid_option' })),
  toItemId: z.preprocess(
    toTrimmedString,
    z
      .string()
      .min(1, { error: 'substitute_required' })
      .pipe(z.uuid({ error: 'invalid_option' })),
  ),
  customerAgreed: checkboxField(),
});
export type OrderSubstitutionInput = z.infer<typeof orderSubstitutionSchema>;

/** «Chiedi nell'app»: la riga, il fiore che manca e quello proposto (il testo lo scrive il server). */
export const orderSubstitutionQuestionSchema = orderSubstitutionSchema.pick({
  lineId: true,
  fromItemId: true,
  toItemId: true,
});
export type OrderSubstitutionQuestionInput = z.infer<typeof orderSubstitutionQuestionSchema>;
