/**
 * Percorsi dell'app (fase 0, PLATFORM_PLAN §5): ogni URL della fioreria si scrive QUI, una volta
 * sola, e serve per link, redirect, revalidate e immagini. Così un percorso che cambia si cambia
 * in un punto e nessun link resta indietro.
 *
 * Modulo puro (client e server, nessuna dipendenza): gli ID vanno nel percorso codificati, i
 * valori della query passano da `URLSearchParams`.
 */

/** Valori della query: `undefined`, `null`, `false` e `''` non compaiono; `true` diventa `1`. */
export type QueryValues = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** Aggiunge la query al percorso (nell'ordine delle chiavi), solo se c'è qualcosa da aggiungere. */
export function withQuery(path: string, query?: QueryValues): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === false || value === '') continue;
    params.set(key, value === true ? '1' : String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/** Varianti delle foto del catalogo (`lib/image-response.ts`, ADR-033). */
export type CatalogPhotoSize = 'full' | 'thumb' | 'cutout' | 'cutout-thumb';
/** Varianti delle foto di "Mis ramos". */
export type ReferencePhotoSize = 'full' | 'thumb';

const segment = encodeURIComponent;

/** Percorso della variante: la versione grande non porta `?size`. */
function sized(path: string, size: string): string {
  return size === 'full' ? path : withQuery(path, { size });
}

/** Tutti i percorsi di una fioreria, a partire dallo slug dell'URL. */
export function tenantRoutes(slug: string) {
  const home = `/app/${segment(slug)}`;
  const catalog = `${home}/catalog`;
  const customers = `${home}/customers`;
  const quotes = `${home}/quotes`;
  const builder = `${home}/builder`;
  const settings = `${home}/settings`;

  return {
    home,
    catalog: {
      list: (query?: QueryValues) => withQuery(catalog, query),
      new: `${catalog}/new`,
      /** Passi dopo la creazione guidata: foto, poi "listo" (`{ step: 'done' }`). */
      added: (itemId: string, query?: { readonly step?: 'done' }) =>
        withQuery(`${catalog}/new/${segment(itemId)}`, query),
      item: (itemId: string, query?: QueryValues) =>
        withQuery(`${catalog}/${segment(itemId)}`, query),
      photo: (photoId: string, size: CatalogPhotoSize = 'full') =>
        sized(`${catalog}/photos/${segment(photoId)}`, size),
    },
    /** Calendario delle date speciali dei clienti (`view`: month, week, day, agenda). */
    calendar: (query?: { readonly view?: string; readonly date?: string }) =>
      withQuery(`${home}/calendar`, query),
    promotions: {
      /** Promo delle date speciali: sconto dell'email automatica (ADR-047). */
      home: `${home}/promotions`,
      /** Registro degli sconti inviati, con ricerca per codice (ADR-048). */
      discounts: (query?: QueryValues) => withQuery(`${home}/promotions/discounts`, query),
    },
    customers: {
      list: (query?: QueryValues) => withQuery(customers, query),
      new: `${customers}/new`,
      detail: (customerId: string, query?: QueryValues) =>
        withQuery(`${customers}/${segment(customerId)}`, query),
    },
    quotes: {
      list: (query?: QueryValues) => withQuery(quotes, query),
      /** Nuova cotización, eventualmente per un cliente o da un disegno del Diseñador. */
      new: (query?: { readonly customerId?: string; readonly configurationId?: string | null }) =>
        withQuery(`${quotes}/new`, query),
      detail: (quoteId: string) => `${quotes}/${segment(quoteId)}`,
      /** Immagine del ramo di una riga (`download`: si scarica, per allegarla su WhatsApp). */
      lineImage: (quoteId: string, lineId: string, options?: { readonly download?: boolean }) =>
        withQuery(`${quotes}/${segment(quoteId)}/lines/${segment(lineId)}/image`, {
          download: options?.download,
        }),
    },
    builder: {
      list: (query?: QueryValues) => withQuery(builder, query),
      new: `${builder}/new`,
      design: (configurationId: string, query?: QueryValues) =>
        withQuery(`${builder}/${segment(configurationId)}`, query),
      /** Boceto del disegno: `version` cambia con il boceto, quindi la cache del browser è sicura. */
      sketch: (configurationId: string, version: string | number) =>
        withQuery(`${builder}/${segment(configurationId)}/sketch`, { v: version }),
      preview: (jobId: string) => `${builder}/previews/${segment(jobId)}`,
      references: `${builder}/references`,
      referencePhoto: (referenceId: string, size: ReferencePhotoSize = 'full') =>
        sized(`${builder}/references/${segment(referenceId)}`, size),
    },
    settings: {
      general: settings,
      team: `${settings}/team`,
      plan: `${settings}/plan`,
    },
  } as const;
}

export type TenantRoutes = ReturnType<typeof tenantRoutes>;
