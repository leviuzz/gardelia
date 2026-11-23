/**
 * Dati di prova per una fioreria (richiesta del founder, 23/11/2026): clienti con date speciali
 * (il calendario si riempie), prodotti del catalogo (fiori, verde, carte, nastri) e, se
 * richiesto, una foto per ogni fiore e verde. Solo CLI di piattaforma (ADR-021), lanciata a mano
 * dal workflow "Operazioni di piattaforma" (ADR-049).
 *
 * Passa dai servizi veri (validazione, audit, RLS) con il contesto dell'operatore, che deve
 * essere amministratore della piattaforma E proprietario o manager della fioreria: si riempie
 * solo una fioreria propria, e nel registro attività le modifiche risultano sue. Rilanciarla non
 * duplica nulla (codici `PRB-` per i prodotti, nomi per i clienti): aggiunge solo ciò che manca.
 */
import sharp from 'sharp';
import { getDb, withSystemContext, withTenantContext } from '@floral/db';
import {
  addDays,
  todayInTimeZone,
  type AcquisitionChannel,
  type CatalogColor,
  type OccasionType,
} from '@floral/domain';
import { hasPermission } from '../authorization';
import { resolveTenantContext, type TenantContext } from '../context';
import { ForbiddenError, NotFoundError } from '../errors';
import { logger } from '../logger';
import { createCatalogItem } from '../services/catalog';
import { addCatalogItemPhoto } from '../services/catalog-photos';
import { createCustomer } from '../services/customers';

/** Prefisso dei codici dei prodotti di prova: si riconoscono e non si creano due volte. */
export const TEST_SKU_PREFIX = 'PRB-';
/** Etichetta dei clienti di prova. */
export const TEST_CUSTOMER_TAG = 'prueba';

export interface TestCatalogItem {
  readonly sku: string;
  readonly type: 'CUT_FLOWER' | 'FOLIAGE' | 'PACKAGING' | 'ACCESSORY';
  readonly name: string;
  readonly variety: string | null;
  /** Specie (slug della tassonomia canonica), solo per fiori e verde. */
  readonly species: string | null;
  readonly colors: readonly CatalogColor[];
  readonly saleUnit: 'STEM' | 'BUNCH' | 'PIECE';
  readonly priceMinor: number;
  readonly costMinor: number;
  readonly heightCm: number | null;
  /** Soggetto della foto generata (in inglese, per il modello); null = niente foto. */
  readonly photo: string | null;
}

const flower = (
  sku: string,
  name: string,
  species: string,
  color: CatalogColor,
  priceMinor: number,
  costMinor: number,
  photo: string,
  options: { variety?: string; type?: 'CUT_FLOWER' | 'FOLIAGE'; heightCm?: number } = {},
): TestCatalogItem => ({
  sku: `${TEST_SKU_PREFIX}${sku}`,
  type: options.type ?? 'CUT_FLOWER',
  name,
  variety: options.variety ?? null,
  species,
  colors: [color],
  saleUnit: 'STEM',
  priceMinor,
  costMinor,
  heightCm: options.heightCm ?? 60,
  photo,
});

/** Prezzi INDICATIVI in MXN (unità minime), per provare preventivi e Diseñador. */
export const TEST_CATALOG: readonly TestCatalogItem[] = [
  flower(
    'ROSA-ROJA',
    'Rosa roja',
    'rosa',
    'red',
    3800,
    1500,
    'a single fresh deep red rose with a short green stem and two leaves, open bloom seen from the front',
    { variety: 'Freedom' },
  ),
  flower(
    'ROSA-BLANCA',
    'Rosa blanca',
    'rosa',
    'white',
    3800,
    1500,
    'a single fresh pure white rose with a short green stem and two leaves, open bloom seen from the front',
    { variety: 'Mondial' },
  ),
  flower(
    'ROSA-ROSA',
    'Rosa rosa',
    'rosa',
    'pink',
    3800,
    1500,
    'a single fresh soft pink rose with a short green stem and two leaves, open bloom seen from the front',
  ),
  flower(
    'TULIPAN',
    'Tulipán amarillo',
    'tulipan',
    'yellow',
    6500,
    3000,
    'a single fresh yellow tulip with a short green stem and one leaf, bloom seen from the front',
    { heightCm: 45 },
  ),
  flower(
    'GIRASOL',
    'Girasol',
    'girasol',
    'yellow',
    4500,
    1800,
    'a single fresh sunflower head with a short green stem and one leaf, flower seen from the front',
    { heightCm: 70 },
  ),
  flower(
    'LILIUM',
    'Lilium blanco',
    'lilium',
    'white',
    9000,
    4000,
    'a single stem of white oriental lily (Lilium) with two open blooms and one bud',
    { heightCm: 80 },
  ),
  flower(
    'GERBERA',
    'Gerbera naranja',
    'gerbera',
    'orange',
    2500,
    900,
    'a single fresh orange gerbera daisy with a short green stem, flower seen from the front',
    { heightCm: 50 },
  ),
  flower(
    'CLAVEL',
    'Clavel rojo',
    'clavel',
    'red',
    1800,
    600,
    'a single fresh red carnation with a short green stem, ruffled bloom seen from the front',
    { heightCm: 55 },
  ),
  flower(
    'HORTENSIA',
    'Hortensia azul',
    'hortensia',
    'blue',
    9500,
    4500,
    'a single fresh blue hydrangea flower head with a short green stem and two leaves',
    { heightCm: 50 },
  ),
  flower(
    'LISIANTHUS',
    'Lisianthus morado',
    'lisianthus',
    'purple',
    5500,
    2400,
    'a single stem of purple lisianthus with three open blooms and a few buds',
    { heightCm: 65 },
  ),
  flower(
    'ALSTROEMERIA',
    'Alstroemeria rosa',
    'alstroemeria',
    'pink',
    3000,
    1200,
    'a single stem of pink alstroemeria (Peruvian lily) with several open blooms',
  ),
  flower(
    'MARGARITA',
    'Margarita blanca',
    'margarita',
    'white',
    2000,
    700,
    'a single stem of white daisy chrysanthemum with several small white blooms with yellow centers',
    { heightCm: 50 },
  ),
  flower(
    'NUBE',
    'Nube (Gypsophila)',
    'gypsophila',
    'white',
    4000,
    1600,
    "a small bunch of fresh white baby's breath (gypsophila) stems with many tiny white flowers",
  ),
  flower(
    'EUCALIPTO',
    'Eucalipto baby blue',
    'eucalipto',
    'green',
    3000,
    1000,
    'a single stem of baby blue eucalyptus with round silver-green leaves',
    { type: 'FOLIAGE' },
  ),
  flower(
    'RUSCUS',
    'Ruscus italiano',
    'ruscus',
    'green',
    1500,
    500,
    'a single stem of Italian ruscus foliage with small glossy dark green leaves',
    { type: 'FOLIAGE' },
  ),
  {
    sku: `${TEST_SKU_PREFIX}PAPEL-COREANO`,
    type: 'PACKAGING',
    name: 'Papel coreano',
    variety: null,
    species: null,
    colors: ['white', 'pink', 'lilac', 'black'],
    saleUnit: 'PIECE',
    priceMinor: 3000,
    costMinor: 900,
    heightCm: null,
    photo: null,
  },
  {
    sku: `${TEST_SKU_PREFIX}PAPEL-KRAFT`,
    type: 'PACKAGING',
    name: 'Papel kraft',
    variety: null,
    species: null,
    colors: ['brown'],
    saleUnit: 'PIECE',
    priceMinor: 2000,
    costMinor: 600,
    heightCm: null,
    photo: null,
  },
  {
    sku: `${TEST_SKU_PREFIX}LISTON-SATIN`,
    type: 'ACCESSORY',
    name: 'Listón de satín',
    variety: null,
    species: null,
    colors: ['red', 'white', 'pink', 'gold'],
    saleUnit: 'PIECE',
    priceMinor: 1500,
    costMinor: 400,
    heightCm: null,
    photo: null,
  },
];

/** Descrizione completa della foto: un fiore, fondo neutro (per lo scontorno), niente testo. */
export function testPhotoPrompt(item: TestCatalogItem): string {
  const background = item.colors.includes('white') ? 'light grey' : 'pure white';
  return [
    `Studio product photo of ${item.photo ?? item.name}`,
    `centered, isolated on a plain ${background} seamless background`,
    'soft even studio lighting, natural texture with small natural imperfections, sharp focus',
    'florist catalog photo, no vase, no wrapping, no text, no watermark',
  ].join(', ');
}

interface TestOccasion {
  readonly type: OccasionType;
  /** Fra quanti giorni cade (dalla data di oggi della fioreria): il calendario si riempie. */
  readonly inDays?: number;
  /** Oppure un giorno fisso dell'anno (il 10 maggio, festa della mamma in Messico). */
  readonly on?: { readonly month: number; readonly day: number };
  readonly year?: number;
  readonly label?: string;
  readonly personName?: string;
}

interface TestCustomer {
  readonly name: string;
  readonly type: 'PERSON' | 'COMPANY';
  readonly preferences?: string;
  readonly channel: AcquisitionChannel;
  readonly occasions: readonly TestOccasion[];
}

/** Clienti inventati (nomi, telefoni 555 e email @example.com, che non esistono). */
export const TEST_CUSTOMERS: readonly TestCustomer[] = [
  {
    name: 'María José Ramírez',
    type: 'PERSON',
    channel: 'instagram',
    preferences: 'Le encantan las rosas rosas y el lisianthus.',
    occasions: [{ type: 'BIRTHDAY', inDays: 2, year: 1988 }],
  },
  {
    name: 'Fernanda Castillo',
    type: 'PERSON',
    channel: 'whatsapp',
    occasions: [
      { type: 'BIRTHDAY', inDays: 5, year: 1992 },
      { type: 'ANNIVERSARY', inDays: 140, year: 2016 },
    ],
  },
  {
    name: 'Alejandro Gutiérrez',
    type: 'PERSON',
    channel: 'referral',
    preferences: 'Siempre pide girasoles para su esposa.',
    occasions: [{ type: 'ANNIVERSARY', inDays: 6, year: 2012 }],
  },
  {
    name: 'Hotel Quinta Real Aguascalientes',
    type: 'COMPANY',
    channel: 'walk_in',
    occasions: [{ type: 'CUSTOM', label: 'Aniversario del hotel', inDays: 8, year: 2004 }],
  },
  {
    name: 'Daniela Morales',
    type: 'PERSON',
    channel: 'instagram',
    occasions: [{ type: 'BIRTHDAY', inDays: 9, year: 1995 }],
  },
  {
    name: 'Ricardo Vega',
    type: 'PERSON',
    channel: 'whatsapp',
    occasions: [{ type: 'BIRTHDAY', inDays: 11, personName: 'Doña Carmen (su mamá)' }],
  },
  {
    name: 'Sofía Herrera',
    type: 'PERSON',
    channel: 'facebook',
    occasions: [
      { type: 'BIRTHDAY', inDays: 14, year: 2001 },
      { type: 'CUSTOM', label: 'Graduación', inDays: 200 },
    ],
  },
  {
    name: 'Valeria Navarro',
    type: 'PERSON',
    channel: 'instagram',
    preferences: 'Prefiere tonos pastel; alérgica al lilium.',
    occasions: [{ type: 'ANNIVERSARY', inDays: 17, year: 2019 }],
  },
  {
    name: 'Carlos Domínguez',
    type: 'PERSON',
    channel: 'whatsapp',
    occasions: [{ type: 'BIRTHDAY', inDays: 19, personName: 'Ana (su esposa)' }],
  },
  {
    name: 'Gabriela Ríos',
    type: 'PERSON',
    channel: 'referral',
    occasions: [{ type: 'BIRTHDAY', inDays: 23, year: 1979 }],
  },
  {
    name: 'Luis Fernando Ortiz',
    type: 'PERSON',
    channel: 'walk_in',
    occasions: [{ type: 'ANNIVERSARY', inDays: 27, year: 2009 }],
  },
  {
    name: 'Andrea Salinas',
    type: 'PERSON',
    channel: 'instagram',
    occasions: [{ type: 'BIRTHDAY', inDays: 31, year: 1990 }],
  },
  {
    name: 'Restaurante La Huerta',
    type: 'COMPANY',
    channel: 'walk_in',
    occasions: [{ type: 'CUSTOM', label: 'Aniversario del restaurante', inDays: 33, year: 2011 }],
  },
  {
    name: 'Jorge Luna',
    type: 'PERSON',
    channel: 'whatsapp',
    occasions: [{ type: 'BIRTHDAY', inDays: 38, year: 1984 }],
  },
  {
    name: 'Mariana Cortés',
    type: 'PERSON',
    channel: 'instagram',
    occasions: [{ type: 'BIRTHDAY', inDays: 45, year: 1997 }],
  },
  {
    name: 'Roberto Flores',
    type: 'PERSON',
    channel: 'referral',
    occasions: [
      { type: 'ANNIVERSARY', inDays: 52, year: 2014 },
      { type: 'BIRTHDAY', inDays: 260, year: 1982 },
    ],
  },
  {
    name: 'Patricia Mendoza',
    type: 'PERSON',
    channel: 'whatsapp',
    occasions: [
      {
        type: 'CUSTOM',
        label: 'Día de las madres',
        on: { month: 5, day: 10 },
        personName: 'Su mamá',
      },
    ],
  },
  {
    name: 'Ximena Aguilar',
    type: 'PERSON',
    channel: 'facebook',
    occasions: [{ type: 'BIRTHDAY', inDays: 60, year: 2003 }],
  },
  {
    name: 'Eduardo Peña',
    type: 'PERSON',
    channel: 'walk_in',
    occasions: [{ type: 'BIRTHDAY', inDays: 75, personName: 'Lucía (su hija)' }],
  },
  {
    name: 'Paola Ibarra',
    type: 'PERSON',
    channel: 'instagram',
    occasions: [{ type: 'BIRTHDAY', inDays: 95, year: 1993 }],
  },
  {
    name: 'Diego Cárdenas',
    type: 'PERSON',
    channel: 'whatsapp',
    occasions: [{ type: 'ANNIVERSARY', inDays: 120, year: 2021 }],
  },
  {
    name: 'Despacho Arellano y Asociados',
    type: 'COMPANY',
    channel: 'referral',
    occasions: [{ type: 'CUSTOM', label: 'Aniversario del despacho', inDays: 180, year: 1999 }],
  },
  {
    name: 'Colegio Montessori del Valle',
    type: 'COMPANY',
    channel: 'walk_in',
    occasions: [{ type: 'CUSTOM', label: 'Fin de curso', inDays: 220 }],
  },
];

/** Il cliente di prova con l'email dell'operatore: riceve davvero la promo (ADR-047). */
export const TEST_SELF_CUSTOMER = 'Cliente de prueba (tú)';

function emailFor(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `${slug}@example.com`;
}

export type TestPhotoSource = (item: TestCatalogItem) => Promise<Uint8Array>;

export interface FillTestShopInput {
  readonly operatorEmail: string;
  readonly tenantSlug: string;
  /**
   * Foto di un fiore o verde (byte di un'immagine; se lancia, quel prodotto resta senza foto).
   * Senza questa funzione non si aggiungono foto.
   */
  readonly photo?: TestPhotoSource;
  readonly now?: Date;
}

export interface FillTestShopResult {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly customers: { readonly created: number; readonly existing: number };
  readonly dates: number;
  readonly items: { readonly created: number; readonly existing: number };
  readonly photos: { readonly added: number; readonly existing: number; readonly failed: number };
}

/** Contesto dell'operatore nella fioreria: amministratore della piattaforma e membro che scrive. */
async function operatorContext(operatorEmail: string, slug: string): Promise<TenantContext> {
  const operator = await withSystemContext(
    getDb(),
    { reason: `platform: dati di prova per ${slug}` },
    (tx) =>
      tx.user.findFirst({
        where: { email: operatorEmail, platformRole: 'SUPER_ADMIN', status: 'ACTIVE' },
        select: { id: true },
      }),
  );
  if (!operator) throw new ForbiddenError('platform_admin_required');
  const ctx = await resolveTenantContext({
    userId: operator.id,
    slug,
    request: { requestId: 'platform-cli:test-data' },
  });
  // Solo una fioreria di cui l'operatore è membro: mai i dati di un'altra persona.
  if (!ctx) throw new NotFoundError('Tenant');
  if (!hasPermission(ctx, 'catalog:write') || !hasPermission(ctx, 'customers:write')) {
    throw new ForbiddenError('owner_or_manager_required');
  }
  return ctx;
}

async function fillCatalog(ctx: TenantContext) {
  const { existingSkus, species } = await withTenantContext(getDb(), ctx, async (tx) => {
    const items = await tx.catalogItem.findMany({
      where: { tenantId: ctx.tenantId, sku: { in: TEST_CATALOG.map((item) => item.sku) } },
      select: { sku: true },
    });
    const flowers = await tx.canonicalFlower.findMany({
      where: { slug: { in: TEST_CATALOG.flatMap((item) => (item.species ? [item.species] : [])) } },
      select: { id: true, slug: true },
    });
    return {
      existingSkus: new Set(items.map((item) => item.sku)),
      species: new Map(flowers.map((flower) => [flower.slug, flower.id])),
    };
  });
  let created = 0;
  for (const item of TEST_CATALOG) {
    if (existingSkus.has(item.sku)) continue;
    await createCatalogItem(ctx, {
      type: item.type,
      name: item.name,
      description: null,
      sku: item.sku,
      canonicalFlowerId: item.species ? (species.get(item.species) ?? null) : null,
      variety: item.variety,
      colors: [...item.colors],
      saleUnit: item.saleUnit,
      priceMinor: item.priceMinor,
      costMinor: item.costMinor,
      availability: 'AVAILABLE',
      prepMinutes: null,
      heightCm: item.heightCm,
      widthCm: null,
      tags: [TEST_CUSTOMER_TAG],
    });
    created += 1;
  }
  return { created, existing: TEST_CATALOG.length - created };
}

async function fillPhotos(ctx: TenantContext, photo: TestPhotoSource) {
  const withPhoto = TEST_CATALOG.filter((item) => item.photo !== null);
  const rows = await withTenantContext(getDb(), ctx, (tx) =>
    tx.catalogItem.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        sku: { in: withPhoto.map((item) => item.sku) },
      },
      select: {
        id: true,
        sku: true,
        _count: { select: { photos: { where: { status: 'ACTIVE' } } } },
      },
    }),
  );
  const bySku = new Map(rows.map((row) => [row.sku, row]));
  let added = 0;
  let existing = 0;
  let failed = 0;
  for (const item of withPhoto) {
    const row = bySku.get(item.sku);
    if (!row) continue;
    if (row._count.photos > 0) {
      existing += 1;
      continue;
    }
    try {
      const bytes = await photo(item);
      await addCatalogItemPhoto(ctx, row.id, bytes, {
        view: 'FRONT',
        color: item.colors[0] ?? null,
      });
      added += 1;
    } catch (error) {
      // Una foto che non riesce non ferma le altre (si può caricare a mano dall'app).
      failed += 1;
      logger.warn(
        { err: error, tenantId: ctx.tenantId, sku: item.sku },
        'foto di prova non aggiunta',
      );
    }
  }
  return { added, existing, failed };
}

async function fillCustomers(ctx: TenantContext, operatorEmail: string, now: Date) {
  const today = todayInTimeZone(ctx.timezone, now);
  const names = [...TEST_CUSTOMERS.map((customer) => customer.name), TEST_SELF_CUSTOMER];
  const existing = await withTenantContext(getDb(), ctx, (tx) =>
    tx.customer.findMany({
      where: { tenantId: ctx.tenantId, displayName: { in: names } },
      select: { displayName: true },
    }),
  );
  const known = new Set(existing.map((customer) => customer.displayName));
  const occasionInput = (occasion: TestOccasion) => {
    const date = occasion.on ?? addDays(today, occasion.inDays ?? 0);
    return {
      type: occasion.type,
      label: occasion.label ?? null,
      personName: occasion.personName ?? null,
      month: date.month,
      day: date.day,
      year: occasion.year ?? null,
      remindDaysBefore: 7,
      notes: null,
    };
  };
  const base = {
    legalName: null,
    taxId: null,
    notes: 'Cliente de prueba (datos inventados).',
    restrictions: null,
    tags: [TEST_CUSTOMER_TAG],
  };
  let created = 0;
  let dates = 0;
  for (const [index, customer] of TEST_CUSTOMERS.entries()) {
    if (known.has(customer.name)) continue;
    await createCustomer(ctx, {
      ...base,
      type: customer.type,
      displayName: customer.name,
      email: emailFor(customer.name),
      phone: `+52449555${String(2001 + index).padStart(4, '0')}`,
      preferences: customer.preferences ?? null,
      acquisitionChannel: customer.channel,
      // Email inventate: nessun consenso, così la promo non prova a scrivere a indirizzi falsi.
      marketingConsent: false,
      occasions: customer.occasions.map(occasionInput),
    });
    created += 1;
    dates += customer.occasions.length;
  }
  if (!known.has(TEST_SELF_CUSTOMER)) {
    await createCustomer(ctx, {
      ...base,
      type: 'PERSON',
      displayName: TEST_SELF_CUSTOMER,
      email: operatorEmail,
      phone: null,
      preferences: null,
      acquisitionChannel: 'walk_in',
      // È l'operatore stesso: con la promo attiva riceve l'email vera, col suo codice.
      marketingConsent: true,
      occasions: [occasionInput({ type: 'BIRTHDAY', inDays: 3 })],
    });
    created += 1;
    dates += 1;
  }
  return { created, existing: names.length - created, dates };
}

export async function fillTestShop(input: FillTestShopInput): Promise<FillTestShopResult> {
  const operatorEmail = input.operatorEmail.trim().toLowerCase();
  const slug = input.tenantSlug.trim().toLowerCase();
  const ctx = await operatorContext(operatorEmail, slug);
  const now = input.now ?? new Date();

  const items = await fillCatalog(ctx);
  const customers = await fillCustomers(ctx, operatorEmail, now);
  // Per ultime: sono la parte lenta (una generazione per foto) e quella che può fallire.
  const photos = input.photo
    ? await fillPhotos(ctx, input.photo)
    : { added: 0, existing: 0, failed: 0 };

  const result: FillTestShopResult = {
    tenantId: ctx.tenantId,
    tenantSlug: ctx.tenantSlug,
    customers: { created: customers.created, existing: customers.existing },
    dates: customers.dates,
    items,
    photos,
  };
  logger.info(
    {
      tenantId: ctx.tenantId,
      customers: customers.created,
      items: items.created,
      photos: photos.added,
    },
    'dati di prova aggiunti',
  );
  return result;
}

/** Hex dei colori usati dai prodotti di prova (foto segnaposto). */
const PLACEHOLDER_HEX: Readonly<Partial<Record<CatalogColor, string>>> = {
  red: '#c0392b',
  white: '#fafaf8',
  pink: '#f2a7b9',
  yellow: '#f6c945',
  orange: '#ef8a3c',
  blue: '#5b8def',
  purple: '#7e57c2',
  green: '#5f8f5a',
};

/**
 * Foto segnaposto (cerchio del colore del prodotto su fondo neutro): SOLO sviluppo locale e test,
 * per provare il flusso delle foto senza generatore. Mai online (la CLI lo impedisce).
 */
export async function placeholderTestPhoto(item: TestCatalogItem): Promise<Uint8Array> {
  const color = item.colors[0] ?? 'green';
  const fill = PLACEHOLDER_HEX[color] ?? '#5f8f5a';
  const background = color === 'white' ? '#d6d6d6' : '#ffffff';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${background}"/><rect x="497" y="560" width="30" height="380" fill="#4f7a43"/><circle cx="512" cy="430" r="230" fill="${fill}"/></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer());
}
