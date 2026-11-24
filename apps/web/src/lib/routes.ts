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
  const orders = `${home}/orders`;
  const builder = `${home}/builder`;
  const inventory = `${home}/inventory`;
  const settings = `${home}/settings`;
  const subscriptions = `${home}/subscriptions`;
  const agenda = `${home}/agenda`;

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
      /** Import da CSV (ADR-070): caricamento del file, poi anteprima e risultato. */
      import: {
        new: `${customers}/import`,
        detail: (importId: string) => `${customers}/import/${segment(importId)}`,
      },
    },
    quotes: {
      list: (query?: QueryValues) => withQuery(quotes, query),
      /** Nuova cotización, eventualmente per un cliente o da un disegno del Diseñador. */
      new: (query?: { readonly customerId?: string; readonly configurationId?: string | null }) =>
        withQuery(`${quotes}/new`, query),
      detail: (quoteId: string) => `${quotes}/${segment(quoteId)}`,
      /** "Convertir en pedido": dati di consegna e tarjeta per un preventivo accettato. */
      toOrder: (quoteId: string) => `${quotes}/${segment(quoteId)}/order`,
      /** Immagine del ramo di una riga (`download`: si scarica, per allegarla su WhatsApp). */
      lineImage: (quoteId: string, lineId: string, options?: { readonly download?: boolean }) =>
        withQuery(`${quotes}/${segment(quoteId)}/lines/${segment(lineId)}/image`, {
          download: options?.download,
        }),
    },
    orders: {
      /** Elenco (`when`: upcoming, today, tomorrow, week, past, all, drafts; `status`; `unpaid`). */
      list: (query?: QueryValues) => withQuery(orders, query),
      /** "Nuevo pedido", eventualmente per un cliente o con il ramo di un disegno del Diseñador. */
      new: (query?: { readonly customerId?: string; readonly configurationId?: string | null }) =>
        withQuery(`${orders}/new`, query),
      /** Il giorno: ordini per fascia e Producción del día (`date` = AAAA-MM-GG, senza = oggi). */
      day: (query?: { readonly date?: string }) => withQuery(`${orders}/day`, query),
      /** Ruta del día: consegne in ordine di fascia (`mine`: solo le proprie). */
      route: (query?: { readonly date?: string; readonly mine?: boolean }) =>
        withQuery(`${orders}/route`, query),
      /** Producción del día da stampare. */
      production: (query?: { readonly date?: string }) => withQuery(`${orders}/production`, query),
      /** Il mese con gli ordini per giorno (`month` = AAAA-MM). */
      calendar: (query?: { readonly month?: string }) => withQuery(`${orders}/calendar`, query),
      /** Scheda dell'ordine; per un borrador `{ step: 'delivery' }` apre il passo della consegna. */
      detail: (orderId: string, query?: QueryValues) =>
        withQuery(`${orders}/${segment(orderId)}`, query),
      /** Foto del ramo finito (prova di consegna; `thumb` = miniatura). */
      photo: (orderId: string, options?: { readonly thumb?: boolean; readonly v?: string }) =>
        withQuery(`${orders}/${segment(orderId)}/photo`, {
          size: options?.thumb ? 'thumb' : undefined,
          v: options?.v,
        }),
      /** Tarjeta da stampare (formato biglietto). */
      card: (orderId: string) => `${orders}/${segment(orderId)}/card`,
      /** Immagine del ramo di una riga (`download`: si scarica, per allegarla su WhatsApp). */
      lineImage: (orderId: string, lineId: string, options?: { readonly download?: boolean }) =>
        withQuery(`${orders}/${segment(orderId)}/lines/${segment(lineId)}/image`, {
          download: options?.download,
        }),
    },
    /** Inventario (ADR-060): existencias, prodotti da controllare, scheda e movimenti. */
    inventory: {
      /** Existencias (`q`, `status`: LOW | OUT, `archived`, `page`). */
      list: (query?: QueryValues) => withQuery(inventory, query),
      /** "Elegir productos": prodotti del catalogo da cominciare a controllare. */
      start: (query?: QueryValues) => withQuery(`${inventory}/start`, query),
      item: (inventoryItemId: string, query?: QueryValues) =>
        withQuery(`${inventory}/${segment(inventoryItemId)}`, query),
      /** Tutti i movimenti (`kind`, `page`). */
      movements: (query?: QueryValues) => withQuery(`${inventory}/movements`, query),
      /** Compras al mayorista (ADR-061): elenco (`q`, `page`), nuova, scheda. */
      purchases: (query?: QueryValues) => withQuery(`${inventory}/purchases`, query),
      newPurchase: `${inventory}/purchases/new`,
      purchase: (entryId: string, query?: QueryValues) =>
        withQuery(`${inventory}/purchases/${segment(entryId)}`, query),
      /** Proveedores (`archived=1` per vedere anche gli archiviati). */
      suppliers: (query?: QueryValues) => withQuery(`${inventory}/suppliers`, query),
      /** Apartados (ADR-062): elenco (`view`, `q`, `page`), nuovo (`item` preselezionato), scheda. */
      reservations: (query?: QueryValues) => withQuery(`${inventory}/reservations`, query),
      newReservation: (query?: QueryValues) => withQuery(`${inventory}/reservations/new`, query),
      reservation: (reservationId: string, query?: QueryValues) =>
        withQuery(`${inventory}/reservations/${segment(reservationId)}`, query),
    },
    /** Floral Care (ADR-075): i contratti di cura delle piante con i clienti. */
    subscriptions: {
      /** Elenco (`view`: active, draft, closed; `q`; `page`). */
      list: (query?: QueryValues) => withQuery(subscriptions, query),
      /** Nuovo contratto (bozza) per un cliente. */
      new: (customerId: string) => withQuery(`${subscriptions}/new`, { customer: customerId }),
      detail: (subscriptionId: string, query?: QueryValues) =>
        withQuery(`${subscriptions}/${segment(subscriptionId)}`, query),
      /** Modifica della bozza (stesso modulo della creazione). */
      edit: (subscriptionId: string) => `${subscriptions}/${segment(subscriptionId)}/edit`,
    },
    /** Agenda dei lavori (ADR-075): il giorno con visite e consegne, il mese, le visite da riprogrammare. */
    agenda: {
      day: (query?: { readonly date?: string }) => withQuery(agenda, query),
      month: (query?: { readonly month?: string }) => withQuery(`${agenda}/month`, query),
      toReschedule: `${agenda}/reschedule`,
      /** Una visita: chi la fa, "Hecha" o "No se pudo", spostarla, cancellarla. */
      visit: (visitId: string) => `${agenda}/visits/${segment(visitId)}`,
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
      /** Foto vera del ramo di un disegno (ADR-052), stesse varianti di "Mis ramos". */
      photo: (photoId: string, size: ReferencePhotoSize = 'full') =>
        sized(`${builder}/photos/${segment(photoId)}`, size),
    },
    settings: {
      general: settings,
      team: `${settings}/team`,
      plan: `${settings}/plan`,
      /** "Mi tienda en línea" (ADR-065). */
      store: `${settings}/store`,
      /** Offerta di Floral Care: tariffe, servizi, fasce di uscita (ADR-075). */
      care: `${settings}/floral-care`,
      /** "Eliminar florería" (ADR-074), solo per il titolare. */
      deleteShop: `${settings}/delete`,
      /** Anteprima di logo o copertina nelle impostazioni (`v` = ID attuale, contro la cache). */
      storeImage: (kind: 'LOGO' | 'COVER', imageId: string) =>
        withQuery(`${settings}/store/image/${kind === 'LOGO' ? 'logo' : 'cover'}`, { v: imageId }),
    },
  } as const;
}

export type TenantRoutes = ReturnType<typeof tenantRoutes>;

/** Conto del cliente del marketplace (blocco C1): di piattaforma, senza fioreria nel percorso. */
/** Ingresso nell'app del fiorista: scelta della fioreria e fiorerie in eliminazione (ADR-074). */
export const appRoutes = {
  home: '/app',
} as const;

export const accountRoutes = {
  home: '/cuenta',
  /** "Descargar mis datos" (diritto di accesso, ADR-068). */
  data: '/cuenta/datos',
  /** Conferma della cancellazione dal link dell'email (`token`). */
  deleteConfirm: (token?: string) => withQuery('/cuenta/eliminar', { token }),
  /** Dopo la cancellazione: pagina pubblica (non c'è più una sessione). */
  deleted: '/cuenta-eliminada',
} as const;

/** Documenti legali (bozze finché non li rivede un avvocato, ADR-068). */
export const legalRoutes = {
  privacy: '/privacidad',
  terms: '/terminos',
  buyerTerms: '/terminos/compradores',
} as const;

/**
 * La destinazione dopo l'accesso è del conto cliente: login e registrazione parlano a chi compra
 * invece che alla fioreria.
 */
export function isAccountPath(path: string): boolean {
  return (
    path === accountRoutes.home ||
    path.startsWith(`${accountRoutes.home}/`) ||
    // "Hacer pedido" in una tienda en línea (ADR-067): chi accede sta comprando.
    /^\/f\/[^/]+\/pedido(?:[/?]|$)/.test(path)
  );
}

/**
 * Pagina pubblica della fioreria (marketplace, ADR-065): per chi compra, senza sessione. Vive fuori
 * da `/app`, quindi non sta in `tenantRoutes`.
 */
export function publicStoreRoutes(slug: string) {
  const home = `/f/${segment(slug)}`;
  const item = (itemId: string) => `${home}/p/${segment(itemId)}`;
  return {
    home,
    item,
    /** Logo o copertina della tienda: l'ID attuale è nell'indirizzo. */
    image: (kind: 'LOGO' | 'COVER', imageId: string) =>
      `${home}/imagen/${kind === 'LOGO' ? 'logo' : 'portada'}/${segment(imageId)}`,
    /** "Hacer pedido" (ADR-067); `producto` = un prodotto già scelto. */
    checkout: (query?: QueryValues) => withQuery(`${home}/pedido`, query),
    /** Foto di un prodotto visibile (`thumb` = miniatura). */
    photo: (itemId: string, photoId: string, options?: { readonly thumb?: boolean }) =>
      withQuery(`${item(itemId)}/foto/${segment(photoId)}`, {
        size: options?.thumb ? 'thumb' : undefined,
      }),
  };
}

/** Pagine per chi compra (marketplace, ADR-066): home, ricerca e la pagina per i fioristi. */
export const buyerRoutes = {
  home: '/',
  florists: '/floristas',
  /** Ricerca: `ciudad`, oppure `lat`/`lng` (+ `dir` da mostrare), oppure `direccion` salvata. */
  search: (query?: QueryValues) => withQuery('/buscar', query),
  /**
   * Dalla ricerca alla tienda: segna che chi compra è arrivato da Gardelia (origine degli ordini,
   * fee D-24) e porta alla pagina della fioreria.
   */
  fromSearch: (slug: string) => `/buscar/ir/${segment(slug)}`,
} as const;
