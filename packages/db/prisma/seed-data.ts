/**
 * Dati demo (fittizi) per sviluppo, test E2E e dimostrazioni commerciali.
 * Nomi, telefoni e indirizzi sono inventati; i prezzi sono valori INDICATIVI in MXN
 * (unità minime = centavos), non listini reali.
 */

export const DEMO_TENANT = {
  slug: 'las-camelias',
  displayName: 'Florería Las Camelias',
  builderLaborFeeMinor: 5000,
  legalName: 'Las Camelias Flores (demo)',
  contactEmail: 'hola@lascamelias.test',
  contactPhone: '+524495550101',
  location: {
    name: 'Tienda Centro',
    addressLine1: 'Av. Francisco I. Madero 314',
    neighborhood: 'Zona Centro',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    phone: '+524495550101',
    deliveryRadiusKm: 10,
  },
} as const;

/** Seconda fioreria: serve a dimostrare (e testare a mano) l'isolamento fra tenant. */
export const SECOND_TENANT = {
  slug: 'flores-del-valle',
  displayName: 'Flores del Valle',
  contactEmail: 'contacto@floresdelvalle.test',
  location: {
    name: 'Sucursal Norte',
    addressLine1: 'Blvd. Zacatecas Norte 1201',
    neighborhood: 'Trojes de Alonso',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20116',
    deliveryRadiusKm: 6,
  },
} as const;

export const DEMO_USERS = [
  {
    key: 'owner',
    email: 'duena@lascamelias.test',
    name: 'Lucía Hernández',
    tenant: 'demo',
    role: 'OWNER',
  },
  {
    key: 'manager',
    email: 'gerente@lascamelias.test',
    name: 'Jorge Martínez',
    tenant: 'demo',
    role: 'MANAGER',
  },
  {
    key: 'staff',
    email: 'staff@lascamelias.test',
    name: 'Ana Torres',
    tenant: 'demo',
    role: 'STAFF',
  },
  {
    key: 'other-owner',
    email: 'dueno@floresdelvalle.test',
    name: 'Raúl Medina',
    tenant: 'second',
    role: 'OWNER',
  },
] as const;

export const CANONICAL_FLOWERS = [
  {
    slug: 'rosa',
    scientificName: 'Rosa spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Rosa', 'it-IT': 'Rosa', 'en-US': 'Rose' },
    colors: ['red', 'pink', 'white', 'yellow', 'orange', 'peach', 'burgundy'],
  },
  {
    slug: 'tulipan',
    scientificName: 'Tulipa spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Tulipán', 'it-IT': 'Tulipano', 'en-US': 'Tulip' },
    colors: ['red', 'pink', 'white', 'yellow', 'purple', 'orange'],
  },
  {
    slug: 'girasol',
    scientificName: 'Helianthus annuus',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Girasol', 'it-IT': 'Girasole', 'en-US': 'Sunflower' },
    colors: ['yellow'],
  },
  {
    slug: 'lilium',
    scientificName: 'Lilium spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Lilium', 'it-IT': 'Giglio', 'en-US': 'Lily' },
    colors: ['white', 'pink', 'orange', 'yellow'],
  },
  {
    slug: 'gypsophila',
    scientificName: 'Gypsophila paniculata',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Nube (Gypsophila)', 'it-IT': 'Nebbiolina', 'en-US': "Baby's breath" },
    colors: ['white', 'pink'],
  },
  {
    slug: 'clavel',
    scientificName: 'Dianthus caryophyllus',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Clavel', 'it-IT': 'Garofano', 'en-US': 'Carnation' },
    colors: ['red', 'pink', 'white', 'yellow', 'purple'],
  },
  {
    slug: 'hortensia',
    scientificName: 'Hydrangea macrophylla',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Hortensia', 'it-IT': 'Ortensia', 'en-US': 'Hydrangea' },
    colors: ['blue', 'pink', 'white', 'purple'],
  },
  {
    slug: 'peonia',
    scientificName: 'Paeonia lactiflora',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Peonía', 'it-IT': 'Peonia', 'en-US': 'Peony' },
    colors: ['pink', 'white', 'coral', 'burgundy'],
  },
  {
    slug: 'alstroemeria',
    scientificName: 'Alstroemeria spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Astromelia', 'it-IT': 'Alstroemeria', 'en-US': 'Peruvian lily' },
    colors: ['pink', 'white', 'yellow', 'orange', 'purple'],
  },
  {
    slug: 'gerbera',
    scientificName: 'Gerbera jamesonii',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Gerbera', 'it-IT': 'Gerbera', 'en-US': 'Gerbera' },
    colors: ['red', 'pink', 'orange', 'yellow', 'white'],
  },
  {
    slug: 'eucalipto',
    scientificName: 'Eucalyptus spp.',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Eucalipto', 'it-IT': 'Eucalipto', 'en-US': 'Eucalyptus' },
    colors: ['green'],
  },
  {
    slug: 'ruscus',
    scientificName: 'Ruscus hypophyllum',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Ruscus', 'it-IT': 'Ruscus', 'en-US': 'Ruscus' },
    colors: ['green'],
  },
  {
    slug: 'orquidea-phalaenopsis',
    scientificName: 'Phalaenopsis spp.',
    category: 'PLANT',
    names: {
      'es-MX': 'Orquídea Phalaenopsis',
      'it-IT': 'Orchidea Phalaenopsis',
      'en-US': 'Moth orchid',
    },
    colors: ['white', 'purple', 'pink'],
  },
  {
    slug: 'monstera',
    scientificName: 'Monstera deliciosa',
    category: 'PLANT',
    names: { 'es-MX': 'Monstera', 'it-IT': 'Monstera', 'en-US': 'Monstera' },
    colors: ['green'],
  },
] as const;

type ItemType =
  | 'CUT_FLOWER'
  | 'FOLIAGE'
  | 'PLANT'
  | 'BOUQUET'
  | 'CONTAINER'
  | 'PACKAGING'
  | 'ACCESSORY'
  | 'SERVICE'
  | 'SERVICE_ADDON';
type Unit = 'STEM' | 'BUNCH' | 'PIECE' | 'SERVICE';
type Avail = 'AVAILABLE' | 'LIMITED' | 'OUT_OF_STOCK' | 'ON_REQUEST';

export interface SeedCatalogItem {
  readonly sku: string;
  readonly type: ItemType;
  readonly name: string;
  readonly variety?: string;
  readonly canonical?: string;
  readonly colors: readonly string[];
  readonly saleUnit: Unit;
  readonly priceMinor: number;
  readonly costMinor: number | null;
  readonly availability: Avail;
  readonly description?: string;
  readonly prepMinutes?: number;
  readonly heightCm?: number;
  readonly tags: readonly string[];
}

export const DEMO_CATALOG: readonly SeedCatalogItem[] = [
  {
    sku: 'ROS-ROJ-FRE',
    type: 'CUT_FLOWER',
    name: 'Rosa roja',
    variety: 'Freedom',
    canonical: 'rosa',
    colors: ['red'],
    saleUnit: 'STEM',
    priceMinor: 3500,
    costMinor: 1400,
    availability: 'AVAILABLE',
    heightCm: 60,
    tags: ['clásico', 'san valentín'],
  },
  {
    sku: 'ROS-BLA-MON',
    type: 'CUT_FLOWER',
    name: 'Rosa blanca',
    variety: 'Mondial',
    canonical: 'rosa',
    colors: ['white'],
    saleUnit: 'STEM',
    priceMinor: 3800,
    costMinor: 1500,
    availability: 'AVAILABLE',
    heightCm: 60,
    tags: ['boda'],
  },
  {
    sku: 'TUL-ROS',
    type: 'CUT_FLOWER',
    name: 'Tulipán rosa',
    canonical: 'tulipan',
    colors: ['pink'],
    saleUnit: 'STEM',
    priceMinor: 5500,
    costMinor: 2500,
    availability: 'LIMITED',
    heightCm: 40,
    tags: ['primavera'],
  },
  {
    sku: 'GIR',
    type: 'CUT_FLOWER',
    name: 'Girasol',
    canonical: 'girasol',
    colors: ['yellow'],
    saleUnit: 'STEM',
    priceMinor: 4000,
    costMinor: 1600,
    availability: 'AVAILABLE',
    heightCm: 70,
    tags: ['alegre'],
  },
  {
    sku: 'LIL-BLA',
    type: 'CUT_FLOWER',
    name: 'Lilium blanco',
    canonical: 'lilium',
    colors: ['white'],
    saleUnit: 'STEM',
    priceMinor: 6000,
    costMinor: 2800,
    availability: 'ON_REQUEST',
    heightCm: 80,
    tags: ['elegante'],
  },
  // Costo volutamente NON compilato: dimostra il calcolo dei margini con dati mancanti.
  {
    sku: 'NUB',
    type: 'CUT_FLOWER',
    name: 'Nube (Gypsophila)',
    canonical: 'gypsophila',
    colors: ['white'],
    saleUnit: 'BUNCH',
    priceMinor: 5000,
    costMinor: null,
    availability: 'AVAILABLE',
    tags: ['relleno'],
  },
  {
    sku: 'EUC-BB',
    type: 'FOLIAGE',
    name: 'Eucalipto baby blue',
    canonical: 'eucalipto',
    colors: ['green'],
    saleUnit: 'BUNCH',
    priceMinor: 4500,
    costMinor: 1800,
    availability: 'AVAILABLE',
    tags: ['follaje'],
  },
  {
    sku: 'ORQ-PHA-BLA',
    type: 'PLANT',
    name: 'Orquídea Phalaenopsis en maceta',
    canonical: 'orquidea-phalaenopsis',
    colors: ['white'],
    saleUnit: 'PIECE',
    priceMinor: 65000,
    costMinor: 32000,
    availability: 'LIMITED',
    heightCm: 55,
    tags: ['regalo', 'oficina'],
  },
  {
    sku: 'PAP-KRA',
    type: 'PACKAGING',
    name: 'Papel coreano kraft',
    colors: [],
    saleUnit: 'PIECE',
    priceMinor: 3000,
    costMinor: 800,
    availability: 'AVAILABLE',
    tags: [],
  },
  {
    // Una sola voce con più colori: nel Diseñador si sceglie il colore (ADR-030).
    sku: 'PAP-COR',
    type: 'PACKAGING',
    name: 'Papel coreano',
    colors: ['pink', 'lilac', 'white', 'black'],
    saleUnit: 'PIECE',
    priceMinor: 3500,
    costMinor: 900,
    availability: 'AVAILABLE',
    tags: [],
  },
  {
    sku: 'LIS-ORG',
    type: 'ACCESSORY',
    name: 'Listón de organza',
    colors: ['white', 'gold', 'pink'],
    saleUnit: 'PIECE',
    priceMinor: 2000,
    costMinor: 400,
    availability: 'AVAILABLE',
    tags: [],
  },
  {
    sku: 'LIS-SAT',
    type: 'ACCESSORY',
    name: 'Listón de satín',
    colors: ['cream'],
    saleUnit: 'PIECE',
    priceMinor: 1500,
    costMinor: 300,
    availability: 'AVAILABLE',
    tags: [],
  },
  {
    sku: 'FLO-VID-CIL',
    type: 'CONTAINER',
    name: 'Florero de vidrio cilíndrico',
    colors: [],
    saleUnit: 'PIECE',
    priceMinor: 18000,
    costMinor: 7000,
    availability: 'AVAILABLE',
    heightCm: 25,
    tags: [],
  },
  {
    sku: 'SRV-MANT',
    type: 'SERVICE',
    name: 'Visita de mantenimiento de plantas',
    colors: [],
    saleUnit: 'SERVICE',
    priceMinor: 45000,
    costMinor: null,
    availability: 'AVAILABLE',
    prepMinutes: 60,
    description: 'Limpieza, poda ligera, revisión de sustrato y riego. Incluye reporte con fotos.',
    tags: ['floral care', 'empresas'],
  },
  {
    sku: 'RAM-12-ROJ',
    type: 'BOUQUET',
    name: 'Ramo Clásico 12 rosas',
    colors: ['red'],
    saleUnit: 'PIECE',
    priceMinor: 69000,
    costMinor: null,
    availability: 'AVAILABLE',
    prepMinutes: 25,
    description: 'Doce rosas rojas con eucalipto, envuelto en papel kraft.',
    tags: ['clásico', 'aniversario'],
  },
  {
    sku: 'RAM-PRIM',
    type: 'BOUQUET',
    name: 'Ramo Primavera',
    colors: ['pink', 'yellow'],
    saleUnit: 'PIECE',
    priceMinor: 59000,
    costMinor: null,
    availability: 'AVAILABLE',
    prepMinutes: 30,
    description: 'Tulipanes rosas y girasoles con nube.',
    tags: ['primavera', 'cumpleaños'],
  },
];

export const DEMO_RECIPES = [
  {
    bouquetSku: 'RAM-12-ROJ',
    laborCostMinor: 6000,
    styleTags: ['clásico', 'romántico'],
    substitutionPolicy: 'ASK_CUSTOMER',
    notes: 'Espiral clásica; eucalipto alrededor.',
    lines: [
      { sku: 'ROS-ROJ-FRE', quantity: 12 },
      { sku: 'EUC-BB', quantity: 1 },
      { sku: 'PAP-KRA', quantity: 1 },
      { sku: 'LIS-SAT', quantity: 1 },
    ],
  },
  {
    bouquetSku: 'RAM-PRIM',
    laborCostMinor: null,
    styleTags: ['campestre', 'colorido'],
    substitutionPolicy: 'SIMILAR_ALLOWED',
    notes: null,
    lines: [
      { sku: 'TUL-ROS', quantity: 5 },
      { sku: 'GIR', quantity: 3 },
      { sku: 'NUB', quantity: 1 },
      { sku: 'PAP-KRA', quantity: 1 },
      { sku: 'LIS-SAT', quantity: 1 },
    ],
  },
] as const;

export const DEMO_CUSTOMERS = [
  {
    type: 'PERSON',
    displayName: 'María Fernanda López',
    email: 'mafer.lopez@example.test',
    phone: '+524495550142',
    preferences: 'Le encantan los tonos pastel y las peonías.',
    restrictions: null,
    tags: ['frecuente'],
    acquisitionChannel: 'instagram',
    marketingConsent: true,
  },
  {
    type: 'COMPANY',
    displayName: 'Hotel Casa Fuentes',
    email: 'compras@casafuentes.test',
    phone: '+524495550177',
    preferences: 'Arreglos para recepción cada lunes; colores blancos y verdes.',
    restrictions: 'Evitar lilium en áreas comunes (olor fuerte).',
    tags: ['empresa', 'recurrente'],
    acquisitionChannel: 'referido',
    marketingConsent: false,
  },
  {
    type: 'COMPANY',
    displayName: 'Despacho Ruiz & Asociados',
    email: 'recepcion@ruizasociados.test',
    phone: '+524495550188',
    preferences: 'Plantas de interior de bajo mantenimiento.',
    restrictions: null,
    tags: ['empresa', 'floral care'],
    acquisitionChannel: 'visita',
    marketingConsent: false,
  },
] as const;
