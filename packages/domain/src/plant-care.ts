/**
 * Dati di cura delle piante in vaso (Floral Care, blocco 6, ADR-085): pochi valori qualitativi per
 * specie, che l'Asistente de plantas usa per rispondere e che l'app mostra così come sono.
 *
 *  - Mai intervalli fissi ("ogni 7 giorni"): dipendono dal posto, dal vaso e dalla stagione (spec
 *    §5.7). Si dice come capire quando serve, non ogni quanto.
 *  - La tossicità per cani e gatti viene da qui, non dal testo del modello: per ora dalla lista
 *    delle piante tossiche e non tossiche dell'ASPCA, con `reviewed: false` finché un fiorista (o un
 *    veterinario) non la conferma. DA VALIDARE (docs/FLORAL_CARE_PLAN.md §2).
 *  - I valori vivono in `packages/db/src/reference-data.ts` (colonna `CanonicalFlower.care`) e si
 *    allineano a ogni rilascio come il resto della tassonomia.
 */
import { z } from 'zod';
import { PLANT_LIGHT_LEVELS } from './floral-care';

/** Luce: LOW = tollera poca luce, lontano dalle finestre; MEDIUM = luce indiretta brillante; HIGH = sole diretto per parte del giorno. */
export const PLANT_CARE_LIGHT = PLANT_LIGHT_LEVELS;

/** Acqua: LITTLE = poca, lasciando asciugare del tutto; DRY_BETWEEN = quando i primi centimetri sono asciutti; SLIGHTLY_MOIST = terra appena umida, mai zuppa. */
export const PLANT_CARE_WATERING = ['LITTLE', 'DRY_BETWEEN', 'SLIGHTLY_MOIST'] as const;
export type PlantCareWatering = (typeof PLANT_CARE_WATERING)[number];

export const PLANT_CARE_HUMIDITY = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type PlantCareHumidity = (typeof PLANT_CARE_HUMIDITY)[number];

/**
 * Tossicità per cani e gatti. VARIES = gruppo di specie diverse (suculentas, cactus): dipende dalla
 * specie. MILD = solo disturbi lievi secondo la fonte.
 */
export const PET_TOXICITY = ['TOXIC', 'MILD', 'NON_TOXIC', 'VARIES'] as const;
export type PetToxicity = (typeof PET_TOXICITY)[number];

/** Fonti dei dati di tossicità (null = dato da confermare, senza una fonte). */
export const PET_TOXICITY_SOURCES = ['ASPCA'] as const;
export type PetToxicitySource = (typeof PET_TOXICITY_SOURCES)[number];

export const plantCareSchema = z
  .object({
    light: z.enum(PLANT_CARE_LIGHT),
    watering: z.enum(PLANT_CARE_WATERING),
    humidity: z.enum(PLANT_CARE_HUMIDITY),
    petToxicity: z.enum(PET_TOXICITY),
    toxicitySource: z.enum(PET_TOXICITY_SOURCES).nullable(),
    /** true solo dopo la revisione di un fiorista o di un veterinario. */
    reviewed: z.boolean(),
  })
  .strict();
export type PlantCare = z.infer<typeof plantCareSchema>;

/** I dati di cura letti dal database; null se mancano o non sono validi (mai un'eccezione). */
export function parsePlantCare(raw: unknown): PlantCare | null {
  const parsed = plantCareSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
