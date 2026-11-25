# Ordini, consegne e marketplace — piano

**Stato: PROPOSTO (23/11/2026)**, con le decisioni del founder indicate come DECISO (D-26, D-27).
Fonti: spec §5.5 (ORD-01), §9.1 (B2C-01), §6 (AI-BQ-10); `docs/V1_SCOPE.md`; `docs/ROADMAP.md`;
`docs/BUSINESS_MODEL.md` §4 (fee sugli ordini, D-24).

## 1. Decisioni del founder (23/11/2026)

- **Il marketplace per i clienti entra nella V1** (D-26). Supera D-15 ("B2C solo in seguito") e
  sposta dentro la V1 la tappa 3 della roadmap. Resta D-22: nessun cliente vero prima della V1
  completa.
- **Il cliente si registra prima di ordinare** (D-26): email verificata o Google, con il login che
  già esiste.
- **Pagamento diretto alla fioreria** (D-26): nessun pagamento online nella V1 e **nessun pagamento
  simulato** visibile (CLAUDE.md). Il fiorista registra a mano acconti e saldi; nel marketplace
  comunica al cliente come pagare (trasferimento, contanti alla consegna, link di pagamento).
- **Ruta del día gratuita** (D-27): ordine delle fermate calcolato da noi, navigazione con i link di
  Google Maps; nessun tracciamento in tempo reale.
- **Indirizzi con Google Places** (ADR-059, deciso dal founder il 23/11/2026): "Buscar dirección"
  quando c'è la chiave, altrimenti a mano come prima.

## 2. Tre parti, un solo ordine

Ordini del fiorista, consegne e marketplace condividono **lo stesso ordine** (`Order`, del tenant).
Cambia solo l'origine:

| Origine                                         | Chi lo crea | Fee (D-24) |
| ----------------------------------------------- | ----------- | ---------- |
| Banco, telefono, WhatsApp, preventivo accettato | il fiorista | no         |
| Pagina della fioreria aperta dal suo link       | il cliente  | no         |
| Ricerca di Gardelia (home, elenco per zona)     | il cliente  | sì         |

L'origine si registra sul cliente e sull'ordine (`AcquisitionSource`: `MERCHANT_DIRECT` /
`MARKETPLACE_B2C`), con la regola di attribuzione del §6.

## 3. Parte A — Ordini nel gestionale

### Pagine (sotto `/app/[tenantSlug]`)

- **Pedidos** (`/orders`): elenco con filtri rapidi (oggi, domani, questa settimana, da pagare,
  nuovi dal marketplace), stato, ricerca per numero, cliente o destinatario; paginazione.
- **Nuevo pedido** (`/orders/new`), procedura a passi come quella del Diseñador:
  1. **Cliente**: cerca o crea (stesso componente dei preventivi).
  2. **Qué lleva**: ramos del catalogo (ricette), disegni del Diseñador (fiori, carta, nastro e
     colori), articoli singoli (vaso, peluche, globo), righe libere; quantità e sconto.
  3. **Entrega o recoge**: data, fascia oraria (dalle fasce della fioreria), indirizzo (uno di
     quelli del cliente o nuovo), destinatario con nome e telefono, note per la consegna ("llamar
     antes", "es sorpresa").
  4. **Tarjeta**: messaggio, firma oppure "anónimo".
  5. **Pago**: acconto facoltativo con metodo.
  6. **Riepilogo**: fiori e articoli, armado, consegna, sconto, totale, pagato, da pagare.
- **Scheda dell'ordine** (`/orders/[id]`): stato con il prossimo passo in evidenza, righe,
  consegna, tarjeta, pagamenti, cronologia; azioni: avanzare di stato, registrare un pagamento,
  stampare comanda e tarjeta, inviare via WhatsApp (link precompilato), annullare.
- **Dal preventivo**: "Convertir en pedido" sul preventivo accettato, senza ricopiare cliente e righe.
- **Link pubblici** con token a scadenza: stato dell'ordine per il cliente e preventivo con
  accettazione (già approvato il 21/11).

### Stati

`PENDING_ACCEPTANCE` (solo ordini del marketplace) → `CONFIRMED` → `IN_PREPARATION` → `READY` →
`OUT_FOR_DELIVERY` → `DELIVERED`; per il ritiro `READY` → `PICKED_UP`. Ramo `CANCELLED` con motivo;
un ordine del marketplace non accettato in tempo passa a `CANCELLED` con motivo "sin respuesta".
Ogni cambio va nella cronologia (`OrderStatusEvent`) e nel registro di audit.

### Pagamenti

Registrati a mano: importo, metodo (`CASH`, `TRANSFER`, `CARD_TERMINAL`, `PAYMENT_LINK`, `OTHER`),
acconto o saldo, data, riferimento facoltativo. Stato calcolato: `UNPAID`, `PARTIAL`, `PAID`. Un
pagamento sbagliato si storna con una riga di rettifica, non si cancella. Regola del marketplace:
finché l'ordine è `UNPAID` la scheda lo segnala ("Pendiente de pago") e il fiorista decide se
preparare.

### Prezzi

Dalla distinta come già oggi: prezzo unitario di fiori, carta, nastro, vaso; armado
(`builderLaborFeeMinor`); costo di consegna dalle regole della fioreria; sconto. Tutto calcolato
**sul server** e congelato nell'ordine (snapshot), come nei preventivi.

## 4. Parte B — Consegne

- **Impostazioni**: orari della fioreria, fasce di consegna (es. 9–12, 12–15, 15–18), giorni di
  chiusura, costo di consegna per distanza (fasce in km) e raggio massimo (`Location.deliveryRadiusKm`
  esiste già), preavviso minimo per ordinare.
- **Calendario delle consegne**: le stesse viste del calendario delle date speciali (mese, settimana,
  giorno, agenda) con gli ordini per stato.
- **Hoy salen**: il giorno raggruppato per fascia, con "En camino" ed "Entregado" (foto del ramo e
  nome di chi riceve).
- **Producción del día**: cosa preparare e il **totale dei fiori** del giorno dalle distinte di tutti
  gli ordini, stampabile: è la lista per il mercato all'ingrosso.
- **Ruta del día** (D-27): fermate ordinate per fascia e, dentro la fascia, per vicinanza a partire
  dalla sede (coordinate degli indirizzi, calcolo nostro, gratis); "Abrir en Google Maps" con le
  fermate in ordine, divise in tratti perché un link accetta poche fermate (circa 3 dal browser del
  telefono, 9 altrimenti); "Ir" su ogni fermata. Senza coordinate (indirizzi a mano, niente Places)
  le fermate restano ordinate per fascia e il link usa l'indirizzo scritto.
- **Repartidor**: l'ordine si assegna a un membro della squadra, che dal telefono vede solo le sue
  consegne del giorno.

## 5. Parte C — Marketplace per i clienti

### Pagine pubbliche (es-MX predefinito, it-IT ed en-US)

- **`/`** — home per chi compra: "¿A dónde enviamos?", occasioni (cumpleaños, aniversario,
  10 de mayo), come funziona.
- **`/floristas`** — landing per i fioristi (il contenuto della landing di oggi), con accesso e
  registrazione al gestionale.
- **`/buscar`** — fiorerie che consegnano all'indirizzo scelto, ordinate per distanza e prima fascia
  disponibile; elenco (la mappa più avanti, perché costa).
- **`/f/[slug]`** — pagina della fioreria: logo, zona, orari, costi di consegna, ramos pubblicati
  con foto e prezzo "desde"; su ogni ramo misura, colori di carta e nastro, extra.
- **Ordine del cliente** (`/f/[slug]/pedido`): ramo e opzioni → consegna (data, fascia, indirizzo,
  destinatario) → tarjeta → riepilogo → invio. Richiede il login (D-26): chi non ha un account si
  registra a metà strada e torna al punto in cui era.
- **`/cuenta`** — conto del cliente: ordini con stato, indirizzi salvati, sue date speciali con
  promemoria, dati e privacy.
- **`/pedido/[token]`** — stato dell'ordine, uguale per cliente del fiorista e del marketplace.

### Accesso

Un solo sistema di identità (Better Auth). Dopo il login: chi ha una fioreria va al gestionale, chi
compra va a `/cuenta` o torna all'ordine. La registrazione oggi porta a creare una fioreria: va
divisa in "registrazione cliente" (pagine pubbliche) e "registrazione fioreria" (`/floristas`).

### Lato fiorista

- **"Mi tienda en línea"** nelle impostazioni: pubblicata sì/no, descrizione, logo, foto, ramos da
  mostrare (interruttore "visible en línea" su ricette e articoli), metodi di pagamento accettati con
  le istruzioni (es. CLABE), tempo massimo per accettare.
- Un ordine dal marketplace arriva come **"Nuevo pedido en línea"** (`PENDING_ACCEPTANCE`): il
  fiorista lo accetta (e il cliente riceve le istruzioni di pagamento) o lo rifiuta con un motivo.
- Il cliente entra nel CRM della fioreria (o si collega a quello esistente con la stessa email) con
  origine e consenso registrati.

### Cosa serve decidere in un ADR prima di costruire

- **Dati di chi compra**: il conto cliente non appartiene a una fioreria. Tabelle di piattaforma
  (profilo e indirizzi del cliente) con una regola di sicurezza per utente, al posto di quella per
  tenant (eccezione motivata alla regola 4.1 di CLAUDE.md).
- **Ordine creato da fuori**: il cliente crea un ordine dentro una fioreria di cui non è membro. Serve
  un contesto pubblico ristretto (solo "crea ordine" e "leggi il mio ordine"), senza
  `withSystemContext` dal web.
- **Catalogo pubblico**: lettura dei soli campi pubblicabili, solo per fiorerie e articoli pubblicati.

### Legale e fiscale prima del lancio

Termini per i consumatori (PROFECO: cancellazioni, rimborsi, responsabilità della fioreria e della
piattaforma), aviso de privacidad per chi compra (Gardelia titolare del conto cliente, la fioreria
dei dati dell'ordine), domanda al contador sugli obblighi delle piattaforme di intermediazione con
il pagamento diretto (O-02, `docs/BUSINESS_MODEL.md` §6).

## 6. Attribuzione della fee (D-24)

Il cliente che arriva dalla ricerca di Gardelia porta l'origine `MARKETPLACE_B2C` sull'ordine; chi
apre il link della fioreria (`/f/[slug]` da fuori, senza passare dalla ricerca) porta
`MERCHANT_DIRECT`. Durata dell'attribuzione per i riordini dello stesso cliente: da decidere con
O-10. Nella V1 la fee si calcola e si mostra al fiorista ma non si incassa: l'incasso arriva con il
billing.

## 7. Modello dati (sintesi)

Tabelle del tenant, con `tenantId`, RLS e FK composite (CLAUDE.md §4):

- `Order`: numero per tenant (`PED-0001`, `TenantCounter`), cliente, preventivo d'origine
  facoltativo, stato, modalità (`DELIVERY`/`PICKUP`), data e fascia, indirizzo di consegna copiato
  nell'ordine (con coordinate facoltative), destinatario, tarjeta (messaggio, firma, anonimo), note,
  costo di consegna, totali in unità minime, stato del pagamento, origine, repartidor assegnato,
  token pubblico (hash) e scadenza, cliente-utente del marketplace facoltativo.
- `OrderLine`: come `QuoteLine` (articolo, ricetta o disegno del Diseñador con snapshot di prezzi e
  distinta).
- `OrderPayment`, `OrderStatusEvent`, foto di consegna (archivio privato come le altre immagini).
- Impostazioni di consegna della fioreria: fasce, costi per distanza, giorni di chiusura.

Tabelle di piattaforma (marketplace, ADR dedicato): profilo del cliente, indirizzi del cliente,
collegamento cliente-utente ↔ cliente del CRM di ogni fioreria.

Coordinate (`latitude`, `longitude`, `placeId`) facoltative su `Location`, `CustomerAddress` e
sull'indirizzo dell'ordine: si riempiono con Google Places (ADR-059), le coordinate per 30 giorni.

## 8. Ordine di lavoro

| Blocco | Contenuto                                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | ✅ Ordini nel gestionale: modello dati, regole, servizi, Pedidos, Nuevo pedido, scheda, pagamenti, preventivo → ordine (ADR-054)              |
| **A2** | ✅ Impostazioni di consegna: fasce, chiusure e costo proposto (ADR-055); coordinate con Google Places (ADR-059); costo per distanza (ADR-069) |
| **A3** | ✅ Stampa di comanda e tarjeta; link pubblici di ordine e preventivo (con accettazione); WhatsApp con il link (ADR-056)                       |
| **B1** | ✅ Calendario delle consegne, Hoy salen, Producción del día (ADR-057)                                                                         |
| **B2** | ✅ Ruta del día, repartidor e prova di consegna (foto del ramo e chi riceve) (ADR-058)                                                        |
| **C1** | ✅ Conto del cliente: registrazione per chi compra, accesso che porta a `/cuenta`, telefono e indirizzi (ADR-064)                             |
| **C2** | ✅ Mi tienda en línea e pagina pubblica della fioreria con i prodotti, logo e copertina, contatto WhatsApp (ADR-065)                          |
| **C3** | ✅ Home per chi compra, `/floristas` e ricerca delle fiorerie per città o indirizzo (ADR-066)                                                 |
| **C4** | ✅ Ordine del cliente, accettazione del fiorista, pagamento diretto, stato, email, scadenza e attribuzione (ADR-067)                          |
| **C5** | ✅ Pagine legali (bozze da rivedere) per chi compra e privacy nell'app: scaricare i dati ed eliminare il conto (ADR-068)                      |
| **M0** | ✅ Correzioni subito: telefono del cliente online, canale «online», testi, errori, link di stato                                              |
| **M1** | ⬜ Vetrina che vende: categorie, ricerca, evidenza, info in alto, galleria, carrello, anteprima e QR (M1-1 fatto)                             |
| **M3** | ⬜ Ordine tutto nell'app: messaggi, avvisi a ogni passo, cambi accettati dal cliente, prova di pagamento                                      |
| **M5** | ⬜ Servizi della fioreria in vetrina e richieste con preventivo accettato nell'app                                                            |
| **M6** | ⬜ Floral Care prenotabile: prezzo dalle piante dichiarate, fasce libere, assistente                                                          |
| **M2** | ⬜ Opzioni ed extra (misure, colori, vasi, globos), «Armalo en ramo», upsell nell'ordine                                                      |
| **M9** | ⬜ Disegna il tuo ramo per il cliente, con l'IA sui crediti della fioreria e limiti                                                           |
| **M4** | ⬜ Calendario e capienza: giorni pieni e chiusi, festivi, ora limite, raggio                                                                  |
| **M8** | ⬜ Clienti e marketing (consenso, date speciali, promo online, recensioni) e report online                                                    |
| **M7** | ⬜ Fiori ogni settimana come abbonamento con ordini automatici                                                                                |

I blocchi M0–M9 (25/11/2026, D-30, ADR-086) vengono dallo studio del giro completo di chi compra e
di chi vende in `docs/MARKETPLACE_FLOWS.md`, nell'ordine scritto lì.

Ogni blocco segue la definizione di finito di CLAUDE.md §7 (test con isolamento A↔B, testi in tre
lingue, 320 px, CI verde) e va su staging quando è finito. Dopo la V1: "Diseña tu ramo" pubblico,
ordini mandati alle fiorerie in zona con priorità, pagamenti online.
