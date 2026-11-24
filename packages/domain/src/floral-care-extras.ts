/**
 * Floral Care, blocco 2b (ADR-078): visite extra, piante morte e cambio di stagione. Regole pure,
 * senza I/O:
 *  - una visita extra (lavoro in più, reposición, installazione o ritiro di stagione) si fissa in
 *    un orario di visita, e conta i posti, oppure a un'ora libera (decisione del founder del
 *    24/11/2026);
 *  - il costo lo calcola il server: la tariffa per visita del contratto con il suo sovrapprezzo per
 *    distanza, niente, o dentro una cotización legata al contratto;
 *  - una cotización nata da un contratto: cambio di stagione, reposición o lavoro extra.
 */
import { z } from 'zod';
import {
  checkCarePlacement,
  carePlacementShape,
  toCarePlacement,
  type DeadPlantPolicy,
} from './floral-care';
import { optionalUuidField } from './order';
import { optionalText, toTrimmedString } from './validation';

/** Perché si fa una visita in più delle programmate. */
export const CARE_EXTRA_KINDS = [
  'EXTRA',
  'REPLACEMENT',
  'SEASONAL_INSTALL',
  'SEASONAL_PICKUP',
] as const;
export type CareExtraKind = (typeof CARE_EXTRA_KINDS)[number];

/**
 * Quanto costa: la tariffa per visita del contratto (con il viaggio), niente, oppure è dentro una
 * cotización del contratto (si paga lì, non con il canone).
 */
export const CARE_EXTRA_FEES = ['VISIT_FEE', 'FREE', 'QUOTE'] as const;
export type CareExtraFee = (typeof CARE_EXTRA_FEES)[number];

export const CARE_EXTRA_LIMITS = {
  /** Nota della visita extra per chi la fa. */
  note: 200,
  /** Orari con posto proposti: i prossimi 21 giorni, come per spostare una visita. */
  optionDays: 21,
} as const;

/** Cotizaciones nate da un contratto (il titolo proposto lo dice). */
export const CARE_QUOTE_PURPOSES = ['SEASONAL', 'REPLACEMENT', 'EXTRA'] as const;
export type CareQuotePurpose = (typeof CARE_QUOTE_PURPOSES)[number];

/**
 * Il costo di una visita extra, in unità minime. La tariffa è quella firmata nel contratto, con il
 * sovrapprezzo per distanza: è quanto costa ogni visita prima delle piante e dei servizi.
 */
export function careExtraFeeMinor(
  fee: CareExtraFee,
  contract: { readonly visitFeeMinor: number; readonly travelSurchargeMinor: number },
): number {
  return fee === 'VISIT_FEE' ? contract.visitFeeMinor + contract.travelSurchargeMinor : 0;
}

/**
 * Il costo proposto nel modulo: una reposición secondo la regola della fioreria, il cambio di
 * stagione nella sua cotización (se c'è), il resto con la tariffa per visita.
 */
export function suggestedCareExtraFee(
  kind: CareExtraKind,
  policy: DeadPlantPolicy,
  hasQuote: boolean,
): CareExtraFee {
  if (kind === 'REPLACEMENT') {
    if (policy === 'INCLUDED') return 'FREE';
    return hasQuote ? 'QUOTE' : 'VISIT_FEE';
  }
  if (kind === 'SEASONAL_INSTALL' || kind === 'SEASONAL_PICKUP') {
    return hasQuote ? 'QUOTE' : 'VISIT_FEE';
  }
  return 'VISIT_FEE';
}

function requiredEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(toTrimmedString, z.enum(values, { error: 'required' }));
}

/**
 * Nuova visita extra: tipo, giorno con fascia o ora libera, costo (con la cotización se è "en la
 * cotización"), nota e persona. `followUpId`: l'avviso di una pianta morta che questa visita
 * risolve ("Reposición sin costo").
 */
export const careExtraVisitSchema = z
  .object({
    kind: requiredEnum(CARE_EXTRA_KINDS),
    ...carePlacementShape,
    fee: requiredEnum(CARE_EXTRA_FEES),
    quoteId: optionalUuidField,
    note: optionalText(CARE_EXTRA_LIMITS.note),
    assignee: optionalUuidField,
    followUpId: optionalUuidField,
  })
  .superRefine((value, ctx) => {
    checkCarePlacement(value, ctx);
    if (value.fee === 'QUOTE' && !value.quoteId) {
      ctx.addIssue({ code: 'custom', path: ['quoteId'], message: 'required' });
    }
  })
  .transform((value) => ({
    kind: value.kind,
    placement: toCarePlacement(value),
    fee: value.fee,
    quoteId: value.fee === 'QUOTE' ? value.quoteId : null,
    note: value.note,
    assignee: value.assignee,
    followUpId: value.followUpId,
  }));
export type CareExtraVisitInput = z.infer<typeof careExtraVisitSchema>;

/** "Cotizar" da un contratto: per cosa, e l'avviso che risolve (se nasce da un avviso). */
export const careQuoteSchema = z.object({
  purpose: requiredEnum(CARE_QUOTE_PURPOSES),
  followUpId: optionalUuidField,
});
export type CareQuoteInput = z.infer<typeof careQuoteSchema>;
