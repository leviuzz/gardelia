# Registro delle decisioni — Floral OS

Ultimo aggiornamento: 26 novembre 2026 (marketplace M3, l'ordine tutto nell'app, ADR-088, con M3-2 «Cambi da confermare»; Floral Care, Asistente de plantas, ADR-085; Floral Care, cargos e pagamenti, ADR-082; catalogo completo e sostituto, ADR-081; reportes, ADR-080; esportazione dei dati, ADR-079; Floral Care, la visita dal telefono e le visite extra, ADR-078; sicurezza del conto, ADR-077; vigencia, orario e logo nelle stampe, ADR-076; Floral Care, blocco 1, ADR-075; eliminare una fioreria, ADR-074; dominio gardelia.co, ADR-073; scarico dell'inventario dagli ordini, ADR-071; clienti completi, ADR-070; home e ricerca per chi compra, ADR-066; tienda en línea, ADR-065; conto del cliente, ADR-064; Google Places, ADR-059; inventario, ADR-060…063; organizzazioni per le catene, D-28).

**Legenda stati**

| Stato        | Significato                                                                    |
| ------------ | ------------------------------------------------------------------------------ |
| **DECISO**   | Confermato dai founder (spec §2).                                              |
| **ADOTTATO** | Decisione tecnica presa nello Sprint 0. Reversibile, ma solo con un nuovo ADR. |
| **PROPOSTO** | Suggerimento da approvare: non va trattato come definitivo.                    |
| **APERTO**   | Richiede input dei founder o di professionisti (fiscale, legale, provider).    |

---

## 1. Decisioni di prodotto (dalla spec) e loro impatto tecnico

| ID         | Decisione                                                                                                                                                                                                                                                                                                                         | Stato                                                                                                    | Come si riflette nel codice (Sprint 0)                                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01       | Prodotto principale = gestionale SaaS per fioristi                                                                                                                                                                                                                                                                                | DECISO                                                                                                   | Moduli gestionali prima del marketplace.                                                                                                                                                                        |
| D-02       | Primo mercato Aguascalientes, poi Italia (niente pilota su un prodotto incompleto: D-22)                                                                                                                                                                                                                                          | DECISO                                                                                                   | UI es-MX; mercato `MX` abilitato, `IT` predisposto ma disattivato (`packages/domain/src/markets.ts`).                                                                                                           |
| D-03       | Nessun acquisto/rivendita diretta di fiori                                                                                                                                                                                                                                                                                        | DECISO                                                                                                   | Nessun magazzino centrale: catalogo e stock sono sempre del tenant.                                                                                                                                             |
| D-04       | Bouquet Builder con il gestionale, piano superiore                                                                                                                                                                                                                                                                                | DECISO                                                                                                   | Distinta (BOM) e costi già pronti; Builder nello Sprint 2.                                                                                                                                                      |
| D-05       | Differenza Basic/Plus ≈ 7 €/mese                                                                                                                                                                                                                                                                                                  | ~~DECISO (strategia)~~ superata da D-23 (founder, 23/11/2026)                                            | Quote AI da modellare nel billing (Sprint 4), ora sui livelli di D-23.                                                                                                                                          |
| D-06/07/08 | Floral Network B2B come addon, fee sui contratti procurati                                                                                                                                                                                                                                                                        | DECISO                                                                                                   | Enum `AcquisitionSource` già presente su `Customer`/`Quote`: base per l'attribuzione delle fee.                                                                                                                 |
| D-09/10/11 | Flora Studio addon separato, **dopo il lancio della V1** (founder, 22/11/2026); video in fase successiva                                                                                                                                                                                                                          | DECISO                                                                                                   | Enum `AiFeature.ROOM_PREVIEW` predisposto; nessuna implementazione.                                                                                                                                             |
| D-12/13/14 | Floral Care, rinnovi, vasi autoirriganti                                                                                                                                                                                                                                                                                          | DECISO                                                                                                   | Tipi catalogo `SERVICE`, `SERVICE_ADDON`, `CONTAINER`, `ACCESSORY` già disponibili.                                                                                                                             |
| D-15       | B2C e accessori solo in seguito                                                                                                                                                                                                                                                                                                   | DECISO; per il B2C superata da D-26 (founder, 23/11/2026), gli accessori restano dopo                    | Nessun modulo; nessun pulsante in UI.                                                                                                                                                                           |
| D-16/17    | Prezzi e fee                                                                                                                                                                                                                                                                                                                      | PROPOSTO, aggiornati da D-23, D-24, D-25                                                                 | **Nessun prezzo nel codice.** Saranno letti dal DB (sprint billing).                                                                                                                                            |
| D-18       | Stack Next.js/TypeScript/Prisma/PostgreSQL                                                                                                                                                                                                                                                                                        | PROPOSTO → ADOTTATO                                                                                      | Vedi ADR-002.                                                                                                                                                                                                   |
| D-19       | Vendita iniziale tramite contatto diretto                                                                                                                                                                                                                                                                                         | PROPOSTO                                                                                                 | Onboarding self-service + tenant `DEMO` per le dimostrazioni.                                                                                                                                                   |
| D-20       | Unica piattaforma multi-tenant                                                                                                                                                                                                                                                                                                    | DECISO                                                                                                   | Vedi ADR-003.                                                                                                                                                                                                   |
| D-21       | Costi AI: quota mensile inclusa nel Plus + pacchetti extra pagati alla piattaforma                                                                                                                                                                                                                                                | DECISO (founder, 21/11/2026)                                                                             | Nessun collegamento di account/chiavi AI del fiorista; vedi ADR-024.                                                                                                                                            |
| D-22       | Ai clienti veri arriva solo un **prodotto finito**, non un pilota: prima della V1 lo usano solo founder e tester                                                                                                                                                                                                                  | DECISO (founder, 22/11/2026)                                                                             | Perimetro e criterio di "finito" in `docs/V1_SCOPE.md`; la roadmap non ha più una fase pilota.                                                                                                                  |
| D-23       | Listino a **tre livelli** (Esencial, Profesional, Premium) più add-on (Studio, crediti AI, utenti e sedi extra, WhatsApp a consumo), al posto di Basic/Plus. Prezzi 699 / 1.199 / 1.899 MXN + IVA; immagini AI incluse 15 nel Profesional e 30 nel Premium; crediti 169 / 299 / 549 MXN; al lancio solo Esencial e Profesional    | Struttura DECISA (founder, 23/11/2026); prezzi, quote e lancio a due livelli PROPOSTI                    | `SaasPlan`/entitlements (`packages/domain/src/plans.ts`) da rifare sui livelli nello sprint billing; dettagli e conti in `docs/BUSINESS_MODEL.md` §1–3                                                          |
| D-24       | Fee sugli ordini: **nessuna** sui clienti propri del fiorista (spec §3.2); **10–15%** sugli ordini portati da Gardelia, privati compresi, a carico del fiorista; **1–2%** sui pagamenti online tramite Gardelia, dopo la V1                                                                                                       | Regole DECISE (founder, 23/11/2026); percentuali PROPOSTE                                                | `AcquisitionSource` distingue gli ordini portati da Gardelia; all'inizio la fee va sulla fattura mensile del fiorista, senza soldi che passano dalla piattaforma (`docs/BUSINESS_MODEL.md` §4)                  |
| D-25       | Aziende: per ora solo il marketplace per i clienti e gli ordini; poi **intermediario** (fee del 10% sulle fatture pagate, fiorista titolare più riserve, ricetta standard del cliente, pagamento per consegna confermata); il **servizio gestito** (fattura unica, margine) parte solo dopo che l'intermediario ha portato ricavi | Ordine e condizione DECISI (founder, 23/11/2026); fee e modalità PROPOSTE (il founder aveva indicato 7%) | Nessun codice ora (Network dopo la V1); `NetworkContract` (una sola offerta accettata, spec §12.2) andrà esteso con assegnazioni per consegna e riserve (`docs/BUSINESS_MODEL.md` §5)                           |
| D-26       | **Marketplace per i clienti nella V1**: pagine pubbliche, ricerca per indirizzo, pagina di ogni fioreria con i suoi ramos, ordine del cliente. Il cliente **si registra prima di ordinare**; **pagamento diretto alla fioreria** (nessun pagamento online e nessun pagamento simulato nella V1)                                   | DECISO (founder, 23/11/2026); l'Asistente si paga con crediti della fioreria, non dei clienti: ADR-085   | Un solo `Order` per ordini del fiorista e del marketplace; piano in `docs/ORDERS_MARKETPLACE_PLAN.md`; dati del cliente in ADR-064, catalogo pubblico in ADR-065; ADR da scrivere per l’'ordine creato da fuori |
| D-27       | **Ruta del día gratuita**: fermate ordinate per fascia oraria e vicinanza con un calcolo nostro, navigazione con i link di Google Maps; niente tracciamento in tempo reale né ottimizzazione a pagamento                                                                                                                          | DECISO (founder, 23/11/2026)                                                                             | Coordinate facoltative negli indirizzi; senza coordinate solo ordine per fascia (`docs/ORDERS_MARKETPLACE_PLAN.md` §4)                                                                                          |
| D-28       | **Organizzazioni per le catene**: un account crea organizzazioni e sotto ognuna più fiorerie, gestite dall'organizzazione                                                                                                                                                                                                         | DECISO come direzione (founder, 23/11/2026), da progettare dopo la V1                                    | Oggi più fiorerie indipendenti per account; inventario per fioreria (ADR-060). Da progettare: ruoli, catalogo condiviso, trasferimenti, report (spec §8.6)                                                      |
| D-29       | **Fase di prova senza piani** (founder, 24/11/2026): con poche fiorerie tester ognuna ha **tutte le funzioni** (`PLAN_FEATURES_ENFORCED`); le **anteprime con IA si pagano sempre**, con crediti assegnati dalla piattaforma dopo il pagamento, chiesti su WhatsApp. I livelli di D-23 tornano prima della produzione             | DECISO come direzione (founder, 23/11/2026), da progettare dopo la V1                                    | Oggi più fiorerie indipendenti per account; inventario per fioreria (ADR-060). Da progettare: ruoli, catalogo condiviso, trasferimenti, report (spec §8.6)                                                      |
| D-30       | **Marketplace completo** (founder, 25/11/2026): tutto nell'app per chi compra e chi vende; servizi della fioreria in vetrina (Floral Care, eventi e matrimoni, decorazione di locali, fiori ogni settimana, più i suoi); Floral Care prenotabile col prezzo dalle piante dichiarate                                               | DECISO (founder, 25/11/2026)                                                                             | Studio e blocchi M0–M9 in `docs/MARKETPLACE_FLOWS.md` (ADR-086)                                                                                                                                                 |

---

## 2. ADR tecnici (Sprint 0 e Sprint 1)

### ADR-001 — Monorepo pnpm con 4 package — ADOTTATO

- **Contesto:** la spec propone 9 package (§13.3) come ipotesi, il repo era vuoto.
- **Decisione:** `apps/web`, `packages/domain` (logica pura), `packages/db` (Prisma + RLS), `packages/core` (casi d'uso). I package esportano sorgenti TypeScript ("internal packages", nessuna build intermedia). Niente Turborepo per ora.
- **Perché:** servono confini netti (il worker AI dello Sprint 2 riuserà `core`/`db` senza Next.js) senza la complessità di 9 package. `ui`, `ai`, `payments` e `worker` si aggiungono quando hanno un secondo consumatore o un processo dedicato.
- **Conseguenze:** la logica di business non può vivere nelle pagine; `domain` non può fare I/O.

### ADR-002 — Versioni dello stack — ADOTTATO

- Node 22 LTS, pnpm 10, **Next.js 16.4** (App Router, Turbopack, `proxy.ts`), React 19.3, **TypeScript 6.0** (non 7: `typescript-eslint` supporta TS < 6.1), **Prisma 7.10** (il tag `latest` punta a una RC 8.0: scartata), PostgreSQL 16, Tailwind CSS 4.3, componenti stile shadcn/ui scritti a mano su Radix (il registry shadcn non era raggiungibile), Better Auth 1.7, next-intl 4.15, Zod 4.6, Vitest 5, Playwright 1.63 (allineato al browser preinstallato in CI locale).
- **ESLint 9** (non 10): i plugin di `eslint-config-next` dichiarano compatibilità fino a ESLint 9. Da rivalutare quando l'ecosistema Next supporterà ESLint 10.
- Versioni **fissate** (senza `^`) e lockfile committato: aggiornamenti deliberati, mai impliciti.

### ADR-003 — Isolamento dei tenant: RLS + FK composite + filtri espliciti — ADOTTATO

- **Decisione:** difesa in profondità su tre livelli.
  1. **Servizi:** ogni query filtra `tenantId` dal `TenantContext` (mai dal client).
  2. **PostgreSQL Row-Level Security** su tutte le tabelle tenant (`FORCE ROW LEVEL SECURITY`), con contesto impostato per transazione (`set_config('app.tenant_id', …, true)`). Senza contesto le tabelle risultano vuote (fail closed).
  3. **FK composite** `(tenantId, id)`: il DB rifiuta riferimenti fra tenant anche con la RLS aggirata.
- **Ruoli DB:** `floral_owner` (migrazioni) e `floral_app` (runtime, non superuser, non BYPASSRLS). All'avvio l'app verifica il ruolo e in produzione si rifiuta di partire se può aggirare la RLS.
- **Bypass:** solo con `withSystemContext({ reason })`, loggato, consentito da ESLint in pochi file (seed, accettazione invito via token, verifiche di sicurezza).
- **Minaccia coperta:** bug applicativi (filtro dimenticato, ID manomessi). Non copre codice malevolo dentro l'app.
- **Tabelle senza RLS (motivato):** `User`, `Session`, `Account`, `Verification`, `RateLimit` (gestite da Better Auth prima che esista un contesto tenant), `_prisma_migrations`. Un test fallisce se compare una nuova tabella senza RLS fuori da questa lista.
- **Alternative scartate:** schema/database per tenant (sproporzionato per fiorerie piccole); solo filtri applicativi (nessuna rete di sicurezza).

### ADR-004 — Autenticazione con Better Auth, autorizzazione nel dominio — ADOTTATO

- Better Auth gestisce **solo l'identità**: email/password, verifica email **obbligatoria**, reset password (revoca delle sessioni), sessioni su DB (30 giorni, refresh giornaliero, cookie cache 5 minuti), rate limiting su database (condiviso fra istanze), telemetria disattivata, ID UUIDv7.
- Tenant, membership, ruoli e inviti sono tabelle **nostre** (`Tenant`, `Membership`, `Invitation`): la tenancy non dipende dalla libreria (sostituibile senza migrare i dati di business).
- I form di login/registrazione usano il client Better Auth (`/api/auth/*`): il rate limiting si applica solo alle richieste HTTP, non alle chiamate server `auth.api.*`.
- Anti-enumerazione: registrazione con email esistente e "password dimenticata" rispondono in modo identico.
- Login con Google: adottato il 21/11/2026 (ADR-036). 2FA: proposto per la fase 1 (P-09).

### ADR-005 — Routing per tenant: `/app/[tenantSlug]` — ADOTTATO

- URL esplicito per fioreria (stesso schema di Shopify admin): più schede su fiorerie diverse, link condivisibili, nessuno stato "fioreria attiva" nascosto in un cookie.
- Ogni pagina **e ogni server action** risolve di nuovo il contesto dallo slug. Utente non membro → **404** (non 403), senza rivelare l'esistenza della fioreria. Gli accessi negati a fiorerie esistenti diventano eventi di sicurezza.
- Il proxy (`src/proxy.ts`) fa solo un redirect "ottimistico" al login: la verifica autorevole è nel server.

### ADR-006 — Identificativi UUID v7 — ADOTTATO

Generati lato applicazione (`newId()`), ordinabili nel tempo (buona località degli indici), tipo nativo `uuid`. Il `tenantId` di una nuova fioreria è noto prima dell'INSERT, così la policy RLS di creazione (`id = app.tenant_id`) funziona senza bypass.

### ADR-007 — Denaro in unità minime intere — ADOTTATO

`Int` (32 bit) in unità minime + valuta ISO 4217 su ogni riga monetaria; tetto applicativo di 10.000.000,00 per singolo importo. Parsing rigido degli input (separatore decimale `.` o `,`, niente migliaia, massimo 2 decimali). Calcoli e arrotondamenti solo lato server. Le aggregazioni future (report) useranno `bigint`/SQL.

### ADR-008 — Internazionalizzazione — ADOTTATO

next-intl senza prefisso di lingua nell'URL (app autenticata). **es-MX completo e unica lingua attiva**; it-IT ed en-US predisposti (`SUPPORTED_LOCALES`) ma non attivabili finché le traduzioni non sono complete. Gli errori di validazione sono **codici** tradotti nella UI. Fuso orario di visualizzazione = fuso del tenant; date salvate in UTC.

### ADR-009 — Server Action per la UI, servizi condivisi — ADOTTATO

Le mutazioni della UI passano da Server Action sottili (contesto → validazione → servizio → revalidate). Le API REST/Route Handler arriveranno per client esterni e webhook (pagamenti, Network), chiamando **gli stessi servizi** di `@floral/core`. Gli argomenti legati con `.bind()` sono considerati input non affidabile.

### ADR-010 — Email transazionali tramite adattatore SMTP — ADOTTATO

`SmtpMailer` (qualsiasi provider: Resend, Postmark, SES, Mailgun; Mailpit in locale), `ConsoleMailer` solo in sviluppo senza SMTP (dichiara esplicitamente che non invia), `MemoryMailer` nei test. **In produzione senza `SMTP_URL` l'app non parte.** Template es-MX con escape HTML. Gli E2E usano un pozzo SMTP locale e seguono i link reali di verifica e invito.

### ADR-011 — Registro di audit append-only — ADOTTATO

`AuditLog` scritto nella stessa transazione della modifica, con diff dei campi cambiati. La RLS non concede UPDATE/DELETE al ruolo applicativo: il registro è append-only per costruzione. Gli eventi di sicurezza (accesso negato, tentativo cross-tenant) sono a livello piattaforma (`tenantId NULL`), visibili solo agli admin. Nessun dato fiscale in chiaro nei metadati.

### ADR-012 — Header di sicurezza e CSP con nonce — ADOTTATO

CSP per richiesta con nonce (`script-src 'nonce-…' 'strict-dynamic'`), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; HSTS e `upgrade-insecure-requests` solo quando `APP_URL` è HTTPS. Conseguenza: tutte le pagine sono renderizzate dinamicamente (accettabile per un'app autenticata). `style-src 'unsafe-inline'` resta necessario per gli stili inline dei componenti Radix.

### ADR-013 — Ruoli e permessi — ADOTTATO (alcuni punti da confermare, vedi O-08)

Matrice unica in `packages/domain/src/permissions.ts`. **OWNER:** tutto (dati fiscali, ruoli, billing futuro). **MANAGER:** catalogo, ricette, impostazioni operative, inviti solo per STAFF. **STAFF:** consultazione catalogo e ricette **senza costi né margini**, nessun accesso al team. Deve restare sempre almeno un OWNER attivo (lock sulle righe); nessuno modifica il proprio ruolo.

### ADR-014 — Modello di catalogo — ADOTTATO

- 9 tipologie: `CUT_FLOWER`, `FOLIAGE`, `PLANT`, `BOUQUET`, `CONTAINER`, `PACKAGING`, `ACCESSORY`, `SERVICE`, `SERVICE_ADDON` (la spec unisce "packaging/accessorio": li separiamo perché sensori, kit d'irrigazione e nastri non sono imballaggi).
- Unità di vendita vincolate alla tipologia; disponibilità a 4 stati (`AVAILABLE`, `LIMITED`, `OUT_OF_STOCK`, `ON_REQUEST`); colori da vocabolario controllato; SKU facoltativo e univoco per tenant.
- **Tipologia immutabile** dopo la creazione (evita distinte incoerenti). Nessuna cancellazione: archiviazione/ripristino.
- `CanonicalFlower`: tassonomia globale (non tenant), leggibile da tutti, scrivibile solo dal sistema. Base per Builder e matching del Network.
- Rimandati (YAGNI, aggiunta non distruttiva): flag "abilitato nel Builder", visibilità pubblica, immagini, fornitori.

### ADR-015 — Distinta base e costi — ADOTTATO

Ogni bouquet nasce con una distinta vuota; righe con quantità intere positive (CHECK nel DB), un solo record per ingrediente, massimo 40 righe. Il calcolo (`computeRecipeCosting`) è deterministico: valore componenti a listino, costo materiali, manodopera facoltativa, margini in basis point. **Se manca anche un solo costo, i margini sono `null`** e la UI lo dichiara (spec §5.8). Ingredienti archiviati o esauriti restano nella distinta e vengono segnalati.

### ADR-016 — Modalità DEMO dei tenant — ADOTTATO

`Tenant.mode = DEMO | LIVE` (spec §13.4). I tenant del seed sono `DEMO` e mostrano un banner. Quando esisteranno comunicazioni verso i clienti finali, i tenant `DEMO` non dovranno inviarle.

### ADR-017 — Form e reset automatico di React 19 — ADOTTATO

React 19 azzera i campi dei `<form action={fn}>` anche quando l'action restituisce errori di validazione (verificato nel sorgente di react-dom 19.3). Tutti i form con campi usano `preserveOnSubmit`: il submit è gestito in una transizione, `useFormStatus` continua a funzionare e i dati dell'utente non si perdono.

### ADR-018 — Strategia di test — ADOTTATO

- **Unit** (Vitest): regole pure di `domain`.
- **Integrazione** (Vitest): servizi e DB contro un **PostgreSQL reale con RLS attiva** e ruolo applicativo; database di test separato (il setup rifiuta nomi senza "test").
- **E2E** (Playwright): app in modalità produzione, seed demo, pozzo SMTP; flussi reali di registrazione, verifica email, inviti, permessi e isolamento.

### ADR-019 — CRM: origine del cliente, ruoli e audit senza dati personali — ADOTTATO (Sprint 1)

- I clienti creati dal fiorista hanno sempre `acquisitionSource = MERCHANT_DIRECT`: le origini
  di piattaforma (`NETWORK_B2B`, `MARKETPLACE_B2C`) generano commissioni e non sono impostabili
  dal merchant. L'origine si propaga ai preventivi (attribuzione delle fee future).
- Lo STAFF legge clienti e preventivi (serve per le consegne) ma non li modifica; ragione sociale
  e RFC sono visibili solo a chi può modificare i clienti.
- Nell'audit dei clienti solo ID, tipo e **nomi** dei campi cambiati (`changedFields`), mai i valori.

### ADR-020 — Preventivi: prezzi lato server, snapshot e stati — ADOTTATO (Sprint 1)

- Prezzi, costi e distinta delle righe da catalogo arrivano **sempre dal DB** del tenant; il client
  invia solo ID e quantità. Ogni riga salva uno **snapshot** (prezzo, costo, distinta, disponibilità,
  versione del motore `quote-v1`): un cambio di listino non altera i preventivi esistenti (ORD-01).
- `taxMode = PRICES_FINAL`: i prezzi sono finali al cliente, **senza scorporo IVA** finché O-06
  non è validata da un contador (la UI lo dichiara). Nessuna aliquota inventata.
- Sconto solo a livello di preventivo, fisso, ≤ subtotale (ridotto automaticamente se le righe calano).
  Stesso articolo aggiunto due volte = quantità sommata; articoli `OUT_OF_STOCK` non quotabili.
- Numerazione `COT-0001` con `TenantCounter` (upsert atomico nella stessa transazione, P-08).
- Ogni modifica blocca la riga del preventivo (`SELECT … FOR UPDATE`) e ricalcola i totali; i CHECK
  del DB garantiscono `total = subtotal − discount + tax` e `lineTotal = quantity × unitPrice`.
- Stati: `DRAFT → SENT → ACCEPTED | REJECTED`, `SENT → DRAFT` (riapertura), `CANCELLED` da bozza o
  inviato; `ACCEPTED` è terminale finché non esistono gli ordini. `EXPIRED` è calcolato in modo
  "pigro" (inviato oltre `validUntil`, nel calendario del tenant) e consolidato alla lettura.
- Condivisione: stampa/PDF dal browser e link WhatsApp (`wa.me`) con testo generato sul server;
  costi e margini non compaiono mai in stampa né nel messaggio.

### ADR-021 — Piani ed entitlements v0, operazioni di piattaforma — ADOTTATO (Sprint 1)

- `SaasPlan` (dati di piattaforma: `BASIC`, `PLUS`, entitlements JSON validati con Zod, nessun
  prezzo perché D-16 è PROPOSTO) e `TenantSubscription` (una per tenant, stati
  `PILOT | TRIALING | ACTIVE | CANCELLED`, fonte `MANUAL`).
- RLS: i piani sono leggibili da tutti e scrivibili solo in bypass; l'abbonamento è leggibile solo dal
  proprio tenant e **non modificabile dal merchant** (nessuna policy di scrittura fuori dal bypass).
- Senza abbonamento valido (assente, cancellato, periodo terminato) si applica `BASIC`: le funzioni
  extra si spengono, i dati restano. `requireEntitlement(ctx, feature)` si chiama nei servizi dopo
  `requirePermission` e lancia `PlanRequiredError` (la UI propone l'upgrade, non un divieto).
- Assegnazione nel pilota (C-03): CLI `pnpm platform:assign-plan`, operatore con
  `platformRole = SUPER_ADMIN` obbligatorio, audit `subscription.assigned` nel tenant.
- **Nuova eccezione al bypass RLS**: `packages/core/src/platform/**` (esportato come
  `@floral/core/platform`). ESLint vieta di importarlo da `apps/web`: le operazioni di piattaforma non
  sono raggiungibili da pagine o server action. Una UI di amministrazione richiederà un ADR dedicato
  (autenticazione forte, audit, separazione dal pannello merchant).
- La quota mensile di anteprime AI è un entitlement (`aiPreviewsPerMonth`, 0 finché la pipeline AI
  non esiste); il conteggio dei consumi e i pacchetti extra arrivano con S1-12 (ADR-024).

### ADR-022 — Feedback delle azioni: toast alla fine dell'azione — ADOTTATO (Sprint 1)

- `useToastActionState` mostra il toast quando la server action termina, non in un effetto del
  componente: il messaggio arriva anche se il re-render smonta il componente (riga rimossa, form
  chiuso, pulsante di uno stato non più disponibile). `useActionToast` resta per i componenti che
  restano montati e per le action con redirect.
- Errori per campo (aggiornato il 23/11): restano accanto ai campi e diventano un toast solo se la
  pagina non li mostra. Il controllo "è visibile?" gira **dopo il commit** dello stato che li porta
  (effetto di `useActionToast`; in `useToastActionState` un effetto sullo stato, con il risultato in
  attesa in un ref), non dopo un numero fisso di frame: con due frame, su un telefono lento o in CI
  lo stesso messaggio compariva anche come toast. Se il componente si smonta prima del commit, gli
  errori diventano un toast: una validazione non resta mai silenziosa.

### ADR-023 — Bouquet Builder deterministico — ADOTTATO (Sprint 1)

- **Prezzo:** `priceBouquet` (dominio puro) = Σ quantità × prezzo di listino dei componenti
  (packaging incluso) + **cargo per armado** fisso del tenant (`builderLaborFeeMinor`, 0 di default).
  La stessa funzione calcola l'anteprima nel browser e il valore autorevole sul server, che rilegge
  prezzi, costi e disponibilità dal DB: il client invia solo ID e quantità. Nessuna AI nel prezzo.
- **Componenti:** solo articoli `ACTIVE` con `isBuilderEnabled` e tipo fiore reciso, follaje,
  packaging/base o accessorio (mai bouquet, piante in vaso o servizi). Per i nuovi articoli di questi
  tipi il flag è attivo di default (la migrazione l'ha attivato anche per quelli esistenti); il
  fiorista può disattivarlo dalla scheda dell'articolo.
- **Regole:** almeno un fiore; al massimo un packaging, in quantità 1; ≤ 30 componenti, quantità
  1–300. `OUT_OF_STOCK` non selezionabile; un disegno con componenti non più disponibili va rivisto
  a mano (mai sostituzioni silenziose); `LIMITED`/`ON_REQUEST` mostrano avvisi che arrivano fino al
  preventivo.
- **Disegni (`BouquetConfiguration`):** totali salvati come snapshot "al salvataggio"; l'editor
  mostra sempre i prezzi attuali e avvisa se sono cambiati. Archiviazione, nessuna cancellazione.
- **Preventivo dal disegno:** nuova riga `BUILDER` (FK composita al disegno, CHECK sul tipo di riga)
  con prezzo **ricalcolato al momento** e distinta esatta nello snapshot; il costo stimato è quello
  dei materiali (l'armado è ricavo).
- **Ruoli e piano:** `builder:use` per tutti i ruoli (lo staff compone al banco senza vedere i costi);
  creare il preventivo richiede `quotes:write`. Tutto il Builder richiede l'entitlement
  `bouquetBuilder` (Plus); per Basic c'è solo l'invito all'upgrade. Da confermare con O-08.
- Fuori ambito ora: anteprime AI (Sprint 2), Builder pubblico per i clienti finali (AI-BQ-10, P1),
  aggiunta di un disegno a un preventivo già esistente.

### ADR-024 — Modello di costo delle anteprime AI: quota inclusa + pacchetti — DECISO (21/11/2026)

Decisione del founder (D-21): **il fiorista non collega il proprio account o la propria chiave AI**
(valutati e scartati: "Sign in with ChatGPT" con uso del piano, OpenRouter, chiave API propria:
attrito alto per il fiorista, costo per lui superiore al sovrapprezzo Plus, Plus senza valore).
La piattaforma paga il provider e rivende l'uso:

- **Quota mensile inclusa** nel piano Plus (`SaasPlan.entitlements.aiPreviewsPerMonth`), che si
  rinnova il giorno 1 del mese nel fuso orario della fioreria: **25 anteprime** (DECISO).
- **Pacchetti extra** pagati dal fiorista alla piattaforma. Nel pilota il pagamento avviene fuori
  dall'app (nessun pagamento finto in UI) e la piattaforma **sblocca X anteprime** con una CLI
  auditata, come per i piani (ADR-021); con il billing (P-04) l'acquisto diventerà self-service.
  Pacchetti (PROPOSTO, delegato dal founder): **25, 50 e 100 anteprime**; prezzo = almeno 3× il
  costo reale per anteprima riuscita misurato nel benchmark, arrotondato in MXN, con sconto sul
  pacchetto grande (indicativo, con un costo ≈ 0,05 USD: 79 / 139 / 249 MXN). I prezzi restano
  fuori dal codice: la CLI registra solo il numero di anteprime sbloccate.
  La fatturazione dei pacchetti in Messico (IVA, CFDI) va validata con il contador (O-02, O-06).
- **Ordine di consumo:** prima la quota mensile, poi i crediti extra. I crediti extra **non scadono**
  (DECISO) e non si azzerano a fine mese.
- **Cosa consuma:** solo le anteprime riuscite. Fallimenti e tentativi interni non consumano. Le
  generazioni in corso "prenotano" un credito, così richieste concorrenti non superano il saldo.
- **Cache (idea del founder):** un ramo **identico** (stessi prodotti, quantità, empaque, stile e
  tamaño) già generato **dalla stessa fioreria** si riusa per qualsiasi suo cliente senza consumare
  crediti né rifare l'immagine. Il prompt contiene solo la composizione, mai nome del disegno, note
  o dati del cliente: il riuso fra clienti non rivela nulla. **Mai fra fiorerie diverse** (spec 6.5
  e 6.6: l'immagine appartiene al tenant; prodotti e foto di riferimento sono del fiorista).
- **Tetto globale di spesa: 50 USD/mese nel pilota** (DECISO), su due livelli: credito prepagato
  sull'account del provider + limite applicativo (`AI_MONTHLY_BUDGET_USD`) che smette di accettare
  generazioni quando la spesa stimata del mese lo raggiunge.
- Implementazione prevista con la pipeline AI (S1-12): registro `AiCreditGrant` (letto dal tenant,
  scritto solo dalla piattaforma, come `TenantSubscription`), origine del credito su ogni `AiJob`,
  CLI `platform:grant-ai-credits`, contatore visibile in "Plan y funciones" e nel Diseñador solo
  quando le anteprime funzionano davvero.
- **Aggiornamento del 23/11/2026 (PROPOSTO, D-23):** l'anteprima esatta (ADR-034) costa circa
  0,11 USD con i tentativi, non 0,05: ai prezzi indicativi 79 / 139 / 249 MXN il pacchetto lascia
  solo il 12–25% dopo AI e Stripe. Stessa regola (almeno 3 volte il costo, sconto sul grande) sul
  costo nuovo: **169 / 299 / 549 MXN**. La quota inclusa passa dai livelli di D-23 (15 nel
  Profesional, 30 nel Premium) quando il billing sarà rifatto; fino ad allora resta 25 nel Plus.
  Conti in `docs/BUSINESS_MODEL.md` §2.

### ADR-025 — Pipeline delle anteprime AI: coda, worker, archivio, provider — ADOTTATO (Sprint 2)

- **Coda (P-01):** nessun servizio aggiuntivo. La coda è la tabella `AiJob` stessa (stati
  `QUEUED → RUNNING → SUCCEEDED | FAILED`), prelevata con `FOR UPDATE SKIP LOCKED` da una funzione
  SQL `SECURITY DEFINER` (`app_claim_ai_job`): il worker non usa il bypass RLS e lavora ogni job nel
  contesto del suo tenant. Lease con scadenza per recuperare i job di un processo caduto; retry
  limitati con attesa crescente. Il credito si prenota nella stessa transazione che crea il job.
- **Worker:** nel pilota gira nello stesso processo dell'app web (avviato da `instrumentation.ts`
  se un provider è configurato); si potrà separare in un processo dedicato senza cambiare il codice.
- **Archivio (P-02):** interfaccia `ObjectStorage` con due implementazioni: **Cloudflare R2**
  (S3-compatibile) in produzione e **filesystem locale** in sviluppo/test. Chiavi
  `tenants/{tenantId}/…`; le immagini si servono da una route dell'app che verifica tenant e
  permessi (nessun URL pubblico, nessuna modifica alla CSP).
- **Provider (O-01):** interfaccia `AiImageProvider`. In sviluppo/test esiste un provider
  **simulato**, ammesso solo con `APP_URL` locale e sempre etichettato "simulación" in UI; in
  produzione l'app rifiuta di avviarsi con il provider simulato. Il provider reale si sceglie con la
  procedura di `docs/AI_BENCHMARK.md` (classifiche pubbliche per la rosa dei candidati, prova
  gratuita sui nostri ramos, poi account diretto con ~10 € prepagati) e si aggiunge con la chiave.
  **Scelto e collegato: fal.ai con Nano Banana 2 (ADR-026).**
- **Spesa:** la spesa stimata del mese di tutta la piattaforma si legge con una funzione SQL
  `SECURITY DEFINER` che restituisce solo il totale (nessun dato dei tenant esposto).

### ADR-026 — Provider reale delle anteprime: fal.ai con Nano Banana 2 — DECISO (21/11/2026)

- **Scelta:** account **fal.ai** del founder (10 € prepagati) con **Nano Banana 2**
  (`fal-ai/nano-banana-2`, 1024 × 1024 JPEG) come modello predefinito e **GPT Image 2**
  (`fal-ai/gpt-image-2`, quality medium) come alternativa selezionabile con `AI_MODEL`. Nel
  confronto sui 5 ramos demo (`docs/AI_BENCHMARK.md`) Nano Banana 2 ha i conteggi più fedeli e
  ~10 s di attesa; GPT Image 2 ha qualità simile ma è 3 volte più lento; FLUX.2 pro è escluso
  (girasoli in più, un'etichetta tipo logo). Un modello nuovo entra solo dopo la stessa prova.
- **Integrazione:** `FalImageProvider` (`packages/core/src/ai/fal.ts`): `POST
https://fal.run/<endpoint>` sincrono con `sync_mode`, così l'immagine torna nella risposta (data
  URI) invece che come URL del CDN. Configurazione: `AI_PROVIDER=fal`, `AI_MODEL` (facoltativa),
  `FAL_KEY` (segreto, solo nell'hosting). L'app non parte senza chiave o con un modello non provato.
- **La risposta è un dato non fidato:** il tipo si ricava dai byte (PNG/JPEG/WebP), massimo
  10 MB; un eventuale URL si scarica solo in https da `*.fal.media`, senza redirect. La chiave è
  un campo privato della classe: non compare in log, errori o serializzazioni.
- **Errori:** moderazione del modello → `content_rejected`; 4xx (parametri, chiave, saldo
  esaurito) → `invalid_request`: entrambi FAILED subito, senza consumare crediti. 408/429/5xx/rete
  → `provider_error` e scadenza → `timeout`: nuovi tentativi (massimo 3, attesa crescente).
- **Costo:** fal non restituisce il costo nella risposta: come costo del job si registra la stima
  da listino (0,08 USD Nano Banana 2 a 1K; 0,06 USD GPT Image 2), che alimenta il tetto mensile
  (ADR-024). Il credito prepagato di fal resta il limite rigido. La stima si riconcilia con la
  fattura di fal nella prova da ~100 immagini prima del pilota.
- **Cache:** l'impronta del ramo include provider e modello: cambiando `AI_MODEL` non si
  riusano immagini dell'altro modello.
- **Limiti noti:** i modelli contano in modo approssimativo e a volte aggiungono un elemento (nella
  prima anteprima reale: 8 rose invece di 7 e un fiocco non in distinta). L'avvertenza "el ramo
  real puede variar" resta obbligatoria e prezzo e distinta non dipendono mai dall'immagine. Un
  worker con un modello diverso da quello del job lo chiude come FAILED (`provider cambiato`):
  con più istanze, il modello si cambia aggiornandole tutte insieme (nel pilota l'istanza è una).
- **Privacy:** il prompt contiene solo la composizione (nomi di catalogo, colori, stile, misura),
  mai dati di clienti o della fioreria.

### ADR-027 — Prompt v2: conteggi espliciti e nome comune dalla tassonomia — ADOTTATO (21/11/2026)

- Il prompt (`bouquet-preview-v2`) dichiara il totale e il numero esatto per tipo ("exactly 3 red
  roses"), chiede fiori ben separati e contabili, usa il nome comune inglese della tassonomia
  canonica quando l'articolo vi è collegato (altrimenti l'etichetta del catalogo), riporta i
  colori di carta e nastro e vieta nastri, fiocchi e spago se non sono in distinta. I fiori venduti
  a mazzo (es. gypsophila) sono riempitivo e non entrano nel conteggio.
- Prova del 21/11/2026 (`docs/AI_BENCHMARK.md`): ramos da 1–2 tipi esatti in 2 casi su 3 (v1:
  0 su 3); con 3 tipi resta inesatto. La versione nuova cambia la chiave di cache.
- **v3** (stesso giorno, osservazione del founder sulle immagini troppo simmetriche): aspetto
  "fatto a mano, leggermente asimmetrico" con altezze e orientamenti diversi, tranne lo stile
  clásico che resta rotondo e bilanciato; nella prova i conteggi non peggiorano.

### ADR-028 — Conteggio esatto nell'anteprima — REQUISITO DEL FOUNDER (21/11/2026), approccio ADOTTATO (ADR-034)

- **Requisito (founder):** il fiorista carica foto dei singoli fiori (più angolazioni); il
  cliente compone il ramo, sceglie colore di carta e nastro, e l'immagine deve mostrare
  **esattamente** i fiori scelti (es. 3 rose + 3 margherite). Rafforza la spec §6.4, che oggi
  accetta conteggi approssimati con avvertenza: finché il controllo sotto non è in produzione,
  l'avvertenza resta.
- **Perché non basta il prompt:** i modelli generativi sbagliano i conteggi oltre 1–2 tipi di
  fiore, anche con foto di riferimento (prove del 21/11/2026).
- **Approccio proposto (in linea con AI-BQ-07/08 e §6.3 della spec):**
  1. foto dei fiori del fiorista nel catalogo (R2), più angolazioni, scontornate in automatico;
  2. **composizione deterministica**: il codice posiziona esattamente N ritagli per tipo, con
     carta e nastro del colore scelto: anteprima immediata, gratuita ed esatta per costruzione;
  3. su richiesta, **foto realistica** generata partendo dalla composizione (prova: esatta al
     primo colpo) e consumo di un credito solo se riesce;
  4. **controllo automatico** dei conteggi con un modello di visione prima di mostrarla; se non
     coincide si ritenta una volta, poi si mostra la composizione esatta (mai un'immagine con
     numeri sbagliati presentata come fedele).
- **Foto anche per carte e nastri (founder, 21/11/2026):** ogni tipo (papel coreano, kraft,
  papel de seda, celofán, listón de satín, organza, yute…) è un articolo del catalogo con le sue
  foto; i colori sono varianti dell'articolo, con una foto per colore quando c'è.
- **Stile del fiorista senza addestramento:** il fiorista carica 5–10 foto dei suoi ramos migliori
  (con consenso, O-07); a ogni generazione il sistema ne sceglie 1–2 simili e le passa al modello
  come riferimento di stile (ambiente, luce, tecnica di incarto). Prova del 21/11/2026: stile
  ripreso senza copiare carta e fiori del riferimento. Prova successiva sui conteggi: non
  attivato per ora (ADR-031).
- **Addestramento (fine-tuning) per fioreria: non ora.** I modelli migliori nei conteggi non si
  possono addestrare; quelli addestrabili (es. FLUX) erano i peggiori; un modello addestrato tende
  a ripetere i ramos tipici del fiorista (fiori non ordinati); servono 20–50 foto, costo e
  riaddestramento per ogni fioreria, e la spec §6.4 lo vieta senza accordo esplicito. Da
  rivalutare dopo il pilota solo se i riferimenti non bastano.
- **Da decidere:** consenso del fiorista sull'uso delle sue foto come riferimento (O-07).

### ADR-029 — Foto del catalogo e "Mis ramos" — ADOTTATO (21/11/2026)

- **Cosa:** foto per articolo del catalogo (fiori e follaje con vista: de frente, de lado, desde
  arriba, detalle; carte, vasi e nastri con il colore scelto fra quelli dell'articolo; massimo 12
  attive) e "Mis ramos", le foto dei ramos della fioreria come riferimento di stile (massimo 30,
  piano Plus). Servizi e consegne non hanno foto.
- **Consenso:** "Mis ramos" registra per ogni foto chi ha autorizzato e quando (`consentAt`,
  `consentById`); senza la casella spuntata non si salva nulla. Testo in UI: mai usate per
  addestrare modelli né condivise con altre fiorerie. Il testo legale definitivo resta O-07.
- **Elaborazione (sharp, nel core):** tipo riconosciuto dai byte (JPEG/PNG/WebP), massimo 4 MB
  (8 MB fino al 22/11/2026, ridotto per Vercel: ADR-038) e 50 megapixel, lato corto ≥ 320 px;
  orientamento EXIF applicato e **tutti i metadati eliminati** (niente GPS né dati del telefono);
  si salvano un JPEG da 1600 px e una miniatura da 480 px. Il browser riduce le foto a 2048 px
  prima dell'invio solo per velocità: il server rivalida sempre.
- **Caricamento:** una foto per richiesta (server action con limite 5 MB; dal 22/11/2026 il browser
  non invia una foto che resta oltre 4 MB dopo la riduzione e lo dice), con avanzamento visibile;
  una foto sbagliata non blocca le altre.
- **Archivio e accesso:** stesso `ObjectStorage` delle anteprime (R2/filesystem), chiavi
  `tenants/{tenantId}/catalog-photos|style-references/{id}[-thumb].jpg`; un CHECK nel database
  impone che la chiave stia sotto il tenant della riga. Le immagini si servono da route private
  che verificano tenant, permessi e piano (cache privata, CSP `sandbox`); un ID di un'altra
  fioreria risponde 404 e registra un evento di sicurezza.
- **Limiti e concorrenza:** `FOR UPDATE` sull'articolo (foto del catalogo) e advisory lock per
  tenant ("Mis ramos"), così caricamenti simultanei non superano i massimi.
- **Permessi:** `catalog:read` per vedere, `catalog:write` per caricare e togliere;
  `builder:use` + piano per vedere "Mis ramos", `builder:references:write` (proprietario e
  gerente) per caricare e togliere.
- **Nessuna cancellazione fisica:** le foto tolte si archiviano; la politica di conservazione
  dei file archiviati va decisa con O-07.
- **Non ancora:** uso delle foto nelle anteprime AI (riferimenti e composizione, ADR-028),
  scontorno automatico, scelta della copertina e ordinamento.

### ADR-030 — Colore di carta, vaso e nastro nel Diseñador — ADOTTATO (21/11/2026)

- **Modello:** un articolo del catalogo per ogni TIPO di carta, vaso o nastro (papel coreano,
  listón de organza…) con i suoi colori (fino a 12); nel Diseñador si sceglie il colore della
  riga. Il colore non cambia il prezzo: se un colore costa diverso, è un articolo a parte.
- **Regola unica** (`resolveLineColor` nel dominio, uguale in browser e server): un solo colore →
  scelto in automatico; più colori → obbligatorio e solo fra quelli ATTUALI dell'articolo; fiori e
  follaje non hanno colore di riga (ogni colore di fiore è un articolo con prezzo e disponibilità).
- **Salvataggio:** `BouquetConfigurationLine.color` (CHECK sulla forma); il server lo rivalida a
  ogni salvataggio, preventivo e anteprima. Se il fiorista toglie quel colore dal catalogo, il
  disegno va rivisto (preventivo: `builder_configuration_outdated`; anteprima: "revisa el
  diseño"), mai un colore inventato.
- **Preventivo:** la distinta salvata nello snapshot include il colore ("1 × Papel coreano
  (lila)").
- **Anteprima AI:** il prompt usa solo il colore scelto (non tutti quelli dell'articolo); colori
  diversi danno chiavi di cache diverse.
- **UI:** il selettore mostra la foto di quel colore se il fiorista l'ha caricata (ADR-029),
  altrimenti il campione; salvataggio bloccato finché manca un colore obbligatorio.
- **Vocabolario:** aggiunti i colori tipici di carte e nastri: negro, dorado, plateado, café,
  transparente.

### ADR-031 — Foto di "Mis ramos" come riferimento nelle anteprime: NON attivate (21/11/2026)

- **Criterio (concordato col founder):** attivare solo se i conteggi dei fiori non peggiorano.
- **Prova** (`docs/AI_BENCHMARK.md`, 9 immagini): con una foto di stile passata al modello i ramos
  esatti scendono da 1 su 3 a 1 su 6 e in 4 immagini su 6 compare un oggetto della foto di stile
  (il vaso di vetro) che non è nella distinta. Ambiente e luce del negozio invece vengono ripresi
  bene.
- **Decisione:** le anteprime restano senza foto di riferimento. Le foto di "Mis ramos" restano
  salvate (con consenso) e la pagina continua a dire che l'uso arriverà più avanti.
- **Prossime opzioni:** (a) descrivere a parole lo stile di ogni foto con un modello di visione
  (una volta per foto, ~0,005 USD) e usare solo il testo nel prompt — **adottata, ADR-032**;
  (b) usarle insieme alla composizione esatta (ADR-028), dove posizioni e numeri li fissa il
  codice.

### ADR-032 — Stile di "Mis ramos" descritto a parole nelle anteprime — ADOTTATO (21/11/2026)

- **Prova** (`docs/AI_BENCHMARK.md`): con lo stile a parole ramos esatti 4 su 6 (1 su 3 senza
  stile, 1 su 6 con la foto), nessun oggetto copiato; criterio del founder rispettato.
- **Scelta della foto:** fra le foto attive di "Mis ramos" della fioreria, la prima caricata con
  lo stesso stile del disegno, altrimenti la prima caricata. Scelta stabile e deterministica: la
  foto scelta entra nella descrizione del ramo e quindi nella chiave di cache
  (`styleReferenceId`); nuove foto non cambiano le anteprime già fatte.
- **Descrizione:** un modello di visione (Claude Sonnet 4.5 via `fal-ai/any-llm/vision`, ~0,006
  USD) descrive la miniatura UNA volta, alla prima anteprima che la usa: inglese per il prompt,
  spagnolo per il fiorista (`StyleReferencePhoto.styleDescription*`, con modello e data). Il
  testo passa da `cleanStyleDescription`, che scarta le frasi su vasi, nastri, fiori, persone,
  scritte o istruzioni. Il modello delle immagini riceve solo quel testo, mai la foto.
- **Mai un motivo di fallimento:** se la descrizione non riesce, l'anteprima si genera senza
  stile (registrato nel job: `output.styleApplied`); il costo della descrizione si somma a
  quello del job per il tetto di spesa.
- **Trasparenza:** "Mis ramos" mostra sotto ogni foto lo stile riconosciuto (o "se describirá
  en la próxima vista previa"); l'anteprima dice "Con el estilo de tus fotos de «Mis ramos»".
- **Privacy:** solo foto con consenso, solo della stessa fioreria; nessun addestramento.
- **Prompt:** versione `bouquet-preview-v4` (nuova chiave di cache).

### ADR-033 — Scontorno automatico delle foto del catalogo — ADOTTATO (21/11/2026)

- **Richiesta del founder:** togliere il fondo alle foto di fiori, carte, nastri e ramos che il
  fiorista carica nel catalogo, chiedendogli di fotografare su un fondo liso che contrasti.
- **Perché serve:** catalogo più pulito e uniforme e, soprattutto, il materiale per l'anteprima
  esatta (ADR-028): fiori ritagliati che il codice posiziona con i numeri della distinta.
- **Confronto** (`docs/AI_BENCHMARK.md`, 3 foto: rosa sul tavolo del negozio, carta su un
  tavolo, ramo in negozio): BiRefNet v2 e Bria RMBG 2.0 (entrambi via fal) danno ritagli
  equivalenti anche su fondi non lisi; un algoritmo locale (colore del bordo) funziona solo su
  fondo liso.
- **Scelta:** BiRefNet v2 (`fal-ai/birefnet/v2`, modello "General Use (Heavy)", PNG), fatturato a
  tempo di calcolo (1–2 s): stima ~0,002 USD a foto, circa un decimo di Bria (0,018 USD). Con 30
  foto a fioreria ≈ 0,06 USD. Stessa chiave fal e stesso `AI_PROVIDER` delle anteprime: nessuna
  nuova variabile. Il costo reale va riconciliato con la fattura fal nella prova prima del pilota.
- **remove.bg scartato:** costa di più (~0,07–0,23 USD a immagine via API, secondo il piano) e,
  se fosse il fiorista a usarlo a mano, aggiungerebbe un passaggio e foto incoerenti.
- **Come funziona:** la foto si salva subito come prima (originale + miniatura) e nella stessa
  transazione si accoda un job `PHOTO_CUTOUT` nella coda AI esistente (ADR-025). Il worker
  ritaglia l'originale, controlla il risultato (`judgeCutout`: scartato se restano meno del 2% o
  più del 97% dei pixel), rifila i margini trasparenti e salva PNG (≤ 1600 px) e miniatura
  (480 px) accanto all'originale (`tenants/{tenantId}/catalog-photos/{photoId}-cutout.png`),
  serviti dalla stessa route privata (`?size=cutout` / `cutout-thumb`). Stati sulla foto:
  `PENDING` → `READY` | `FAILED` (con codice). L'originale resta sempre: copertina del catalogo e
  Diseñador continuano a usarlo.
- **Costi e crediti:** costo della piattaforma, mai crediti del fiorista (`quotaSource` nullo,
  consumo zero); entra nel tetto di spesa mensile (ADR-024): a tetto raggiunto la foto si salva
  senza ritaglio.
- **Errori:** problema del servizio → "Reintentar", al massimo 3 richieste per foto (contro i
  loop); ritaglio scartato dal controllo → niente nuovo tentativo sulla stessa foto (darebbe lo
  stesso risultato), ma il consiglio di rifarla su un fondo liso.
- **Indicazioni al fiorista:** fondo liso che contrasti (cartulina bianca o grigia, nera per i
  fiori bianchi), senza ombre forti né altri oggetti. "Quitamos el fondo de cada foto
  automáticamente" compare solo se lo scontorno è attivo.
- **"Mis ramos" escluso:** lì il fondo fa parte dello stile (ADR-032) e si conserva; la pagina
  lo dice.
- **Sviluppo e test:** con `AI_PROVIDER=simulated` (solo in locale) lavora l'algoritmo locale
  (`ChromaKeyBackgroundRemover`): ritaglio reale ma valido solo su fondi lisi, nessun costo.
- **Limiti noti:** un solo worker nel processo web, quindi 12 foto caricate insieme si ritagliano
  in fila (1–2 s l'una) e un'anteprima accodata dopo aspetta; la pagina si aggiorna da sola per
  al massimo 2 minuti. Se il ritaglio non piace, per ora si toglie la foto e se ne carica
  un'altra (nessuna opzione "usa l'originale").

### ADR-034 — Anteprima esatta: boceto dai ritagli, foto realistica, conteggio verificato — ADOTTATO (21/11/2026)

- **Requisito (ADR-028):** l'immagine deve avere esattamente i fiori della distinta (es. 3 rose
  e 3 margherite), con carta e nastro del colore scelto. Delegato dal founder ("vai").
- **1. Boceto esatto (gratis, immediato, senza IA).** Se ogni fiore contato (venduto a stelo)
  ha una foto senza fondo (ADR-033), il server disegna un ritaglio per stelo: disposizione
  deterministica (`layoutBouquetSketch`: stessa distinta → stesso boceto), fiori ben separati
  e interi, carta (fino a due fogli) o contenitore, steli, fiocco per i nastri riconosciuti dal
  nome, follaje e fiori di riempimento se hanno foto. I ritagli si specchiano a caso, così con
  una sola foto i fiori non sembrano identici. Si usa la foto "de frente" se c'è. Massimo 24
  steli.
- **2. Foto realistica (su richiesta).** `fal-ai/nano-banana-2/edit` riceve il boceto e il
  prompt `bouquet-preview-v5`: mantenere fiori, posizioni e numeri, rendere vera la carta e il
  nastro, stile della fioreria a parole (ADR-032).
- **3. Controllo dei conteggi.** Claude Sonnet 4.5 (via `fal-ai/any-llm/vision`) elenca i fiori
  dell'immagine per tipo; riceve i tipi ma non le quantità attese. Si accetta solo se ogni tipo
  coincide e non ci sono fiori estranei; altrimenti un secondo tentativo. Se nemmeno quello
  coincide: nessuna immagine, nessun credito (`count_mismatch`) e il boceto, esatto, resta
  visibile. Dopo 2 richieste scartate per lo stesso ramo non si riprova (ogni tentativo lo paga
  la piattaforma). Se il controllo non risponde, la foto si mostra come anteprima normale, non
  verificata, con l'avvertenza di sempre.
- **Quando non si applica:** fiori senza foto (il Diseñador elenca quali fotografare, con il
  link alla scheda), più di 24 steli, modello senza variante "edit" (GPT Image 2): anteprima
  descritta a parole come prima, con l'avvertenza.
- **Prove** (`docs/AI_BENCHMARK.md`): 3 ramos di prova (3 rose + 3 margherite, 12 rose, 3
  girasoli + 5 margherite) e uno nell'app (5 rose + 2 girasoli, eucalipto, carta rosa, listón,
  stile di "Mis ramos"): 4 su 4 esatti al primo tentativo, confermati anche a occhio; ~13 s per
  la foto e ~5 s per il controllo.
- **Costi (stima da listino):** ~0,09 USD per anteprima (foto 0,08 + controllo ~0,01), fino a
  ~0,18 con il secondo tentativo; un credito della fioreria solo se la foto supera il controllo.
  Il costo reale va riconciliato con la fattura fal nella prova prima del pilota.
- **Cache:** la chiave include modalità, ritaglio scelto per ogni fiore e versione del boceto
  (`sketch-v1`); nell'anteprima a parole i ritagli non entrano nella chiave.
- **Sicurezza:** boceto servito da una route privata (membri della fioreria con il piano Plus);
  ritagli letti solo da foto attive, con ritaglio pronto, della stessa fioreria; nomi del
  catalogo neutralizzati nei prompt; il contatore riceve solo l'immagine generata e i tipi.
- **Limiti noti:** tutti i fiori hanno la stessa dimensione nel boceto (un girasole grande
  quanto una rosa); il contatore è un cancello, non una garanzia (su immagini difficili 4/6 il
  21/11); contenitori (caja, florero) disegnati come un rettangolo; il "tamaño" del ramo non
  cambia il boceto.
- **Revisione v2 (stesso giorno, dopo il giudizio del founder: "sembra un collage, troppo
  finto").** La v1 metteva fiori sparsi su steli dritti e il modello li copiava alla lettera.
  Confronto su 3 ramos (`docs/AI_BENCHMARK.md`): solo testo 1/3 esatti, testo + foto dei fiori
  1/3, boceto nuovo 3/3; chiedere al modello di "reinventare" ogni fiore lo rende più vario ma
  rompe i conteggi (1/3). Adottato:
  - **boceto `sketch-v2`:** solo le corolle (il core toglie gli steli dai ritagli: erosione
    della maschera, componente più grande), fitte a cupola come in un ramo vero, le esterne
    dietro e più piccole, le centrali davanti; steli nascosti nella carta; fino a 3 angolazioni
    dello stesso fiore alternate, con piccole differenze di luce, rotazione e specchio;
  - **prompt `bouquet-preview-v6`:** "foto vera di un ramo fatta in negozio", stessi fiori nei
    stessi punti, profondità e ombre, carta con pieghe;
  - **controllo in due passi:** Claude conta per primo (~5 s); solo se non ritrova i numeri
    decide una seconda opinione, Gemini 2.5 Pro che individua ogni fiore con un riquadro
    (~20–40 s, ~0,03 USD). Sulla dozzina Claude sbagliava di uno 1 volta su 6, Gemini Pro 0 su 6:
    così una foto giusta non si scarta per un errore di conteggio. Gemini Flash scartato
    (10–19 rose contate su 12).
  - Verifica nell'app con fal: 12 rose in carta nera con eucalipto, esatte, 18,6 s.
- **v3 (stesso giorno): proporzioni vere fra tipi di fiore.** Diametro tipico della corolla
  riconosciuto dal nome (spagnolo o inglese, anche senza tassonomia): girasole 15 cm, lilium 14,
  peonía 12, gerbera 10, rosa 8, tulipán e clavel 6, margarita 5…; i fiori grandi al centro, i
  piccoli intorno, la carta davanti sotto ogni corolla. Prova: 3 girasoli + 5 margherite in carta
  kraft, esatti (decisi dalla seconda opinione: Claude ne vedeva 4), 3 rose + 3 margherite
  esatte. Boceto `sketch-v3`.
- **Avviso "fiori senza specie" (22/11/2026).** Prova del founder su staging: quattro rose
  chiamate "Fiore 1", senza specie, sono diventate ortensie nella foto realistica (il modello
  riceve solo il nome; il boceto le disegnava di grandezza media). Il Diseñador ora elenca, con
  il link alla scheda, i fiori senza specie collegata e con un nome fatto solo di parole
  generiche (segnaposto, colori, misure, numeri: `nameSaysWhichFlower` in
  `domain/exact-preview.ts`). È un avviso, non blocca: la tassonomia globale ha solo 14 specie,
  quindi un fiore vero fuori elenco ("Iris", "Nube") non lo fa scattare, altrimenti il fiorista
  non potrebbe toglierlo. Il riconoscimento delle grandezze ora capisce anche i nomi italiani
  (ortensia, giglio, garofano, ranuncolo, margherita, camomilla).
- **Perché la foto non si mostra (23/11/2026).** Il founder su staging: "non va la generazione
  AI". Dai log il job era arrivato in fondo (riga informativa, non un errore): con ogni
  probabilità foto scartata per numeri diversi, ma né lo schermo né il log dicevano quali. Ora,
  quando la foto si scarta, il Diseñador mostra cosa ha contato il controllo nell'ultima foto:
  per ogni fiore a stelo "trovati di attesi" (in grassetto quelli diversi) e i fiori che non sono
  nel ramo. I dati erano già salvati in ogni job (`output.checks`), quindi si vedono anche per i
  job già scartati, ricaricando la pagina. La regola di accettazione non cambia. Il log della foto
  scartata riporta gli stessi numeri: tipo della distinta, attesi e trovati, mai nomi.
- **v4 (23/11/2026): ogni fiore resta visibile.** Caso del founder su staging: 3 rose rosse aperte
  e 2 boccioli rosa. Nel boceto i boccioli finivano quasi del tutto dietro le rose, la foto
  realistica li perdeva e il controllo, giustamente, scartava la foto. Il boceto controllava solo
  la distanza fra i centri, non quanto di ogni fiore resta in vista. Ora il core misura sulle forme
  vere dei ritagli la parte dei petali di ogni corolla rimasta visibile (foglie e sepali verdi
  esclusi, fuori dal quadro = nascosto). Sotto il 60% ridisegna con corolle più piccole del 7% e
  più distanziate, al massimo 4 volte (`SKETCH_CROWDING`): il ramo resta fitto quando si può.
  Inoltre il bordo inclinato della carta davanti non sale più sopra il centro delle corolle più
  basse. Boceto `sketch-v4`: cambia la chiave di cache, quindi i ramos già scartati si possono
  rigenerare. **Da osservare:** il controllo dei conteggi ignora i "boccioli chiusi", quindi un
  prodotto fotografato in bocciolo (rose) potrebbe non essere contato. Se succede, si cambia il
  prompt dopo una prova vera.
- **Colore dalla foto nel controllo (23/11/2026).** Secondo tentativo del founder, con il boceto
  v4: tutti i fiori erano visibili, ma il controllo ha contato "Fiore 1: 0 su 3" più "3 fiori che
  non sono nel ramo". Il modello di visione riceve i tipi come nome e colore del catalogo, e "Fiore
  1" (nome generico, senza specie e senza colore) non gli diceva che erano rose rosse. Ora il core
  misura il colore medio dei petali sulla foto di ogni fiore, cioè quella del boceto, foglie verdi
  escluse. Se il catalogo non ha colore, il tipo diventa `"Fiore 1" (red)`; se ne ha un altro, si
  scrivono entrambi ("looks red in the photo"). La regola di accettazione non cambia.
- **v7 (23/11/2026): foto naturale e correzione dei fiori in più.** Con i numeri finalmente giusti
  il founder ha bocciato l'aspetto: "la direzione dei fiori non è naturale, mantiene la posizione
  della bozza". Ora il boceto dice solo quali fiori e quanti, e il modello dispone il ramo come un
  fiorista (altezze e direzioni diverse, tre quarti) e alla fine ricontrolla i numeri. Se il
  controllo trova solo fiori in più dei tipi della distinta, una seconda passata sulla stessa foto
  li toglie lasciando il resto com'è (`buildCountFixPrompt`); se mancano fiori o ce ne sono di
  estranei, si rifà la foto. Al massimo 3 immagini per richiesta (`generationsPerJob`), ognuna
  controllata, e ci si ferma alla prima giusta (`renderVerifiedPhoto`). Prova sul ramo del founder:
  4 richieste su 4 verificate e naturali, 0,22–0,26 USD a richiesta (prima ~0,09), dettagli in
  `docs/AI_BENCHMARK.md`. Il credito del fiorista resta uno solo e solo a successo; il costo in più
  è della piattaforma. Prompt `bouquet-preview-v7`: cambia la chiave di cache.
- **v8 (23/11/2026): fiori visti da angolazioni diverse.** Con la v7 il founder: "non ci siamo
  ancora con la direzione delle rose", cioè quasi tutte rivolte verso la fotocamera. Causa: il
  collage mostra ogni corolla di fronte e la frase "fai ogni fiore come nel collage" spingeva il
  modello a copiarne anche l'angolazione. Ora il prompt chiede stesso tipo, colore e apertura del
  collage, ma visti come in un ramo vero: quasi tutti di lato o di tre quarti e al massimo circa uno
  su quattro rivolto verso la fotocamera, almeno uno (`maxFacingCamera`). Prove: 3 rose + 2
  tulipani, 3 su 3 verificate al primo colpo con una sola rosa di fronte; 12 rose, 6 su 6
  verificate (dettagli in `docs/AI_BENCHMARK.md`). Prompt `bouquet-preview-v8`: cambia la chiave
  di cache.
- **v9 (23/11/2026): niente collage al modello, solo le foto dei fiori.** Il founder sulla v8: "i
  fiori sono orizzontali, non sono naturali". Guardate a piena risoluzione, le rose centrali erano
  teste girate di lato e ammucchiate, staccate dai loro steli: da v6 a v8 il modello partiva dal
  collage, dove ogni corolla è vista di fronte, e le frasi sulle angolazioni le spostavano senza
  attaccarle a uno stelo. Ora il modello riceve le foto scontornate dei fiori del catalogo, una per
  tipo (al massimo 8: prima i fiori contati, poi riempitivi e verde con foto), e compone un ramo
  vero in cui ogni corolla sta sul suo stelo e ne segue la direzione, fotografato di fronte e un
  po' dall'alto. Carta, nastro e contenitore sono descritti a parole. Il boceto resta l'anteprima
  esatta gratuita, ma non va più al modello. Il numero esatto resta garantito dal controllo e dalla
  correzione dei fiori in più. Prova: 6 rami naturali su 6 con i numeri verificati, contro 3 su 6
  partendo dal collage descritto come vista dall'alto (`docs/AI_BENCHMARK.md`). Costo uguale.
  Prompt `bouquet-preview-v9`: cambia la chiave di cache.
- **Correzione ripetuta (23/11/2026).** Primo test del founder con la v9 (4 rose + 3 tulipani):
  scartata, "Rosa roja: 5 su 4". Prova con 6 richieste: il controllo conta giusto, è il modello che
  aggiunge spesso un fiore; la correzione lo toglie, ma la regola "una correzione non si corregge"
  faceva rifare la foto da capo, che aveva di nuovo un fiore in più, e i 3 tentativi finivano. Ora
  una foto con soli fiori in più si corregge anche se è già una correzione, purché l'ultima
  correzione ne abbia tolto almeno uno (`extraFlowerCount`); se non ne ha tolto nessuno, o mancano
  fiori, si rifà da capo. Sempre al massimo 3 immagini: costo massimo invariato.

### ADR-035 — Immagine del ramo nel preventivo — ADOTTATO (21/11/2026)

- **Cosa:** quando un preventivo nasce da un disegno del Builder, la riga BUILDER si aggancia
  all'anteprima RIUSCITA del ramo così com'è in quel momento (`QuoteLine.previewJobId`, FK
  composita sul tenant, CHECK: solo righe BUILDER). Se poi il disegno cambia, il preventivo già
  fatto tiene la sua immagine (mostra ciò che è stato quotato); un preventivo nuovo la ha solo
  dopo aver generato l'anteprima della nuova composizione.
- **Dove si vede:** nella pagina del preventivo e nella stampa/PDF, con l'avviso "Imagen
  ilustrativa" (o, se verificata, "con el número exacto de flores de la receta") e il bollino
  "Número de flores verificado"; "Simulación" con il provider simulato.
- **WhatsApp:** un link `wa.me` porta solo testo, quindi "Descargar imagen para WhatsApp" scarica
  il file da allegare a mano al messaggio. Nessun link pubblico all'immagine.
- **Accesso:** route privata `/quotes/[id]/lines/[lineId]/image` con il permesso di lettura dei
  preventivi (anche lo staff), 404 per le altre fiorerie; l'immagine resta visibile anche se la
  fioreria scende a Basic (è già stata pagata).
- **Prossimo:** link per il cliente (pagina pubblica del preventivo con token, scadenza e
  revoca), da decidere insieme alla privacy (O-07).

---

### ADR-036 — Login con Google — ADOTTATO (21/11/2026, decisione del founder)

- **Cosa:** "Continuar con Google" in accesso, registrazione e inviti, con Better Auth (provider
  `google`: flusso con codice e PKCE, scope `openid email profile`, `prompt=select_account` per i
  dispositivi condivisi della fioreria). Email e password restano.
- **Attivazione:** solo con `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` entrambe impostate
  (validate all'avvio: una sola e l'app non parte). Senza chiavi il pulsante non compare: nessun
  pulsante finto.
- **Regole di sicurezza:**
  - L'email deve essere verificata da Google (`requireEmailVerification`): altrimenti nessuna
    sessione e link di conferma per email, come per la registrazione con password.
  - Collegamento automatico a un account esistente con la stessa email **solo** se l'email è
    verificata sia da Google sia nel nostro account (`requireLocalEmailVerified`). Chi registra
    con password l'indirizzo di un altro, senza confermarlo, non si "aggancia" l'account Google
    del vero titolare (CVE-2026-53516, corretto in Better Auth 1.6.11; usiamo 1.7.27): la pagina
    chiede di confermare prima l'email.
  - Al collegamento non cambiano email né nome (`updateUserInfoOnLink: false`); email diverse non
    si collegano. Gli utenti sospesi restano fuori (stesso controllo all'apertura della sessione).
  - Rate limit su `/sign-in/social` (10 al minuto per IP). I codici d'errore del ritorno da Google
    si traducono in chiavi note: il testo dell'URL non arriva mai nella pagina.
- **Dati:** salviamo nome, email e l'ID dell'account Google; **non** la foto del profilo
  (minimizzazione). Non chiamiamo API di Google; i token che Better Auth conserva sono cifrati
  (`encryptOAuthTokens`).
- **Tenancy invariata:** Google fornisce solo l'identità. Fiorerie, ruoli e inviti restano tabelle
  nostre; un invito si accetta solo con la stessa email (Google propone l'account dell'invito con
  `login_hint`).
- **Test:** unità (configurazione, errori, percorsi) ed E2E sul flusso reale, con l'endpoint dei
  token di Google simulato nel solo server di test (`e2e/support/google-oauth-mock.mjs`, caricato da
  Playwright): nuovo utente → onboarding → fioreria e secondo accesso; collegamento a un account
  confermato; rifiuto del collegamento a un account mai confermato; email non verificata da
  Google; annullamento; invito accettato con Google.
- **Ambienti:** un client OAuth per ambiente, perché Google accetta solo URI di reindirizzamento
  esatti. Le anteprime per PR hanno URL variabili: lì Google resta spento (in futuro,
  eventualmente, con il plugin `oAuthProxy` di Better Auth).
- **Configurazione (founder, con dominio e account aziendale: O-02, O-03).** Le voci della console
  Google cambiano spesso: i passi vanno ricontrollati al momento.
  1. Progetto Google Cloud dell'azienda → "Google Auth Platform" (ex "schermata di consenso
     OAuth"): nome "Floral OS", email di supporto, dominio autorizzato, link ad aviso de
     privacidad e termini. Pubblico "Esterno", stato "In produzione". Gli scope di base non
     richiedono la revisione di sicurezza; per mostrare logo e nome dell'app Google chiede la
     verifica del marchio.
  2. Client → "Applicazione web" → URI di reindirizzamento autorizzato
     `https://<dominio dell'app>/api/auth/callback/google`. Client separati per staging
     (`https://<dominio di staging>/api/auth/callback/google`) e sviluppo
     (`http://localhost:3000/api/auth/callback/google`).
  3. ID client e segreto nelle variabili d'ambiente della piattaforma, mai nel repository né in chat.
- **Privacy:** l'aviso de privacidad deve citare Google come metodo di accesso e i dati ricevuti
  (nome, email): da validare con un legale messicano insieme a O-07.

---

### ADR-037 — Job AI su funzioni (Vercel) — ADOTTATO (22/11/2026)

- **Problema:** su Vercel non esiste un processo sempre acceso: il worker nel processo (ADR-025)
  non può girare. La coda resta in Postgres (stati, crediti, tentativi, lease: fonte di verità).
- **Motore** (`AI_WORKER_MODE`): `inline` = ciclo nel processo, come prima (locale, test E2E,
  container); `serverless` = funzione `/api/internal/ai/drain` avviata a richiesta. Predefinito
  `serverless` quando c'è la variabile `VERCEL`.
- **Chi avvia la funzione:** il server appena accoda un job (segnale di core, collegato all'avvio
  con `after`, quindi dopo la risposta all'utente); le pagine che aspettano un job in coda o in
  corso (al massimo una volta ogni 15 s per istanza: un job rimasto a metà riparte senza attese);
  Vercel Cron come rete di sicurezza (una volta al giorno, il massimo del piano Hobby).
- **Dove va l'avvio** (aggiunto il 22/11/2026, primo deploy con un `APP_URL` diverso dal dominio
  vero): la richiesta porta `CRON_SECRET`, quindi su Vercel va sempre al dominio di produzione
  del progetto (`VERCEL_PROJECT_PRODUCTION_URL`, impostata da Vercel), mai ad `APP_URL`: un
  `APP_URL` sbagliato non può mandare il segreto a un sito non nostro. Fuori da Vercel `APP_URL`.
  Se quel dominio rimanda a un altro (es. `gardelia.vercel.app` → `gardelia-staging.vercel.app`,
  oppure dominio principale → `www`), il rimando si segue a mano, una volta sola e solo verso
  l'host di `APP_URL` in https: `fetch` lo seguirebbe togliendo il segreto, e un rimando verso un
  sito esterno non deve riceverlo.
- **La funzione** risponde subito 202 e svuota la coda per al massimo 290 s (durata massima
  Hobby: 300 s); smette di prendere job quando il tempo rimasto non basta a finirne uno (riserva
  200 s). Protetta da `CRON_SECRET` (confronto in tempo costante); senza segreto valido, 404.
- **Limite globale di job in corso** (`AI_MAX_CONCURRENT_JOBS`, predefinito 8, sotto le 10
  richieste contemporanee di fal): in `app_claim_ai_job`, con un lock transazionale che rende
  atomici conteggio e prelievo anche con molte funzioni insieme.
- **Segnale:** l'emettitore sta su `globalThis`, perché Next.js può caricare `@floral/core` in più
  pacchetti dello stesso processo.
- **Test:** svuotamento fino a coda vuota, stop per tempo, limite di job in corso, segreto, ritmo
  dei riavvii, regole di configurazione; E2E: la funzione risponde solo con il segreto.
- **Limiti noti:** le anteprime di prova (URL variabili) non lavorano job AI; una generazione
  eccezionalmente lunga (oltre 5 minuti) sul piano Hobby si interrompe e riparte alla scadenza
  del lease. Con Pro la durata massima della funzione sale a 800 s.

### ADR-038 — Rilascio su Vercel e operazioni di piattaforma da GitHub — ADOTTATO (22/11/2026)

- **Migrazioni:** le applica la build, solo nei deploy di produzione (`VERCEL_ENV=production`),
  con il ruolo proprietario (`DATABASE_MIGRATION_URL`, URL diretto di Neon), prima di
  `next build` (`apps/web/scripts/vercel-build.mjs`). Senza quella variabile la build si ferma. Le
  anteprime per ramo non toccano mai il database. Le migrazioni restano "espandi e contrai"
  (PLATFORM_PLAN §4): la versione in linea continua a funzionare mentre arriva la nuova.
- **Dati di riferimento** (aggiunto il 22/11/2026, scoperto dalla prima CI su un database vuoto):
  la tassonomia dei fiori la caricava solo il seed demo, che in produzione non gira; online gli
  articoli non si sarebbero collegati alla tassonomia e anteprime e boceto avrebbero perso nomi e
  misure. Ora sta in `packages/db/src/reference-data.ts` e si allinea a ogni rilascio dopo le
  migrazioni (`pnpm db:deploy` = migrazioni + dati di riferimento, anche nella build di Vercel) e
  prima dei test di integrazione; l'allineamento è idempotente.
- **Ruoli del database su Neon:** `neondb_owner` per le migrazioni; `gardelia_app`, creato una volta
  con `packages/db/scripts/setup-hosted-db.sql` (stessi privilegi del locale), per l'app. Il
  controllo all'avvio ora rifiuta anche un ruolo **proprietario delle tabelle** (o che può
  diventarlo con `SET ROLE`), oltre a superuser e BYPASSRLS: chi possiede una tabella può
  toglierle la RLS. Così l'app non parte se per errore riceve l'URL del proprietario.
- **Runtime fissato:** Node 22 come in CI (`engines` di `apps/web`, letto da Vercel) e pnpm del
  repository via Corepack (`ENABLE_EXPERIMENTAL_COREPACK=1` nel progetto).
- **Operazioni di piattaforma** (ADR-021: mai dal web): un workflow GitHub lanciato a mano
  (`.github/workflows/platform-ops.yml`) esegue le CLI sull'ambiente online con il ruolo dell'app
  (segreto `PLATFORM_DATABASE_URL`). Il founder non deve installare nulla sul proprio computer.
  **Corretto il 23/11:** il repository è pubblico e GitHub stampa in chiaro le variabili `env:` di
  ogni passo, quindi l'email dell'operatore finiva nei log visibili a tutti. Ora gli input si
  leggono dal file dell'evento (`$GITHUB_EVENT_PATH`, con `jq`), mai da `env:` né interpolati nello
  script. Email, fioreria e nota si mascherano (`::add-mask::`) prima di qualsiasi output; in
  `env:` restano solo i segreti, che GitHub mostra come `***`.
- **Primo amministratore:** `pnpm platform:bootstrap-admin --email` nomina il primo
  `SUPER_ADMIN`, una sola volta (si rifiuta se ne esiste già uno, con un lock contro due esecuzioni
  insieme); l'utente deve essere attivo e con l'email confermata; resta nel registro di audit.
- **Caricamenti:** foto fino a 4 MB, sotto il limite di 4,5 MB per richiesta delle funzioni di
  Vercel, così l'errore è il nostro (chiaro, in spagnolo) e non quello della piattaforma.
- **Guida per il founder:** `docs/DEPLOY_VERCEL.md` (account, valori, verifiche).

### ADR-039 — Ossatura unica delle server action e percorsi in un solo file — ADOTTATO (22/11/2026)

- **Problema:** 39 server action ripetevano lo stesso scheletro (contesto, try/catch, revalidate,
  traduzione del messaggio, redirect) e 75 percorsi `/app/${slug}/…` erano scritti a mano in 32
  file: facile dimenticare il contesto in un'azione nuova o lasciare indietro un link.
- **Azioni:** `runTenantAction(slug, work)` (`apps/web/src/lib/tenant-action.ts`), con un ordine
  fisso: contesto della fioreria (fuori dal try, così login e 404 di Next si propagano), lavoro
  dell'azione (validazione con `parseForm`, servizio), errori → stato del form (`actionError`);
  solo se il lavoro riesce: pagine da ricaricare → redirect → messaggio. L'azione restituisce
  `{ revalidate, redirectTo, success | warning }`; i messaggi sono chiavi complete di es-MX (o una
  funzione col traduttore). `warning`: la modifica c'è ma il toast è un errore (invito creato,
  email non partita). Le firme restano funzioni esplicite: `.bind()` e `useActionState` invariati.
- **Percorsi:** `tenantRoutes(slug)` (`apps/web/src/lib/routes.ts`), modulo puro (client e
  server): pagine, query con `URLSearchParams` (valori vuoti omessi), varianti delle immagini, ID
  codificati in un solo segmento. Nelle azioni i percorsi vengono dal contesto, mai dallo slug
  inviato dal client.
- **Guardia:** `apps/web/test/conventions.test.ts` fallisce se un file `'use server'` della
  fioreria esporta altro che funzioni, se un'azione non restituisce `runTenantAction(slug, …)` o se
  compare un `` `/app/${…}` `` fuori da `routes.ts` (provato con un file volutamente sbagliato).
- **Per l'utente non cambia nulla:** stessi messaggi, redirect e pagine ricaricate (E2E invariati).

### ADR-040 — Scadenze calcolate in lettura, salvate da un lavoro giornaliero — ADOTTATO (22/11/2026)

- **Problema:** aprire l'elenco o il dettaglio dei preventivi, o la pagina del team, faceva un
  UPDATE (inviati scaduti → EXPIRED, inviti scaduti → EXPIRED): letture che scrivono, transazioni
  di scrittura su ogni pagina, stato che cambia solo se qualcuno guarda.
- **Lettura:** lo stato scaduto si calcola con le regole del dominio (`effectiveQuoteStatus`,
  scaduto dal giorno dopo `validUntil` nel calendario della fioreria): nei DTO, nei filtri
  ("Enviadas" esclude gli scaduti, "Vencidas" li include) e nei cambi di stato (un inviato scaduto
  non si accetta). Il team elenca solo gli inviti ancora validi. Nessuna lettura scrive.
- **Salvataggio:** la funzione SQL `app_expire_overdue()` (SECURITY DEFINER, come
  `app_claim_ai_job`) chiude in un colpo preventivi e inviti scaduti di tutte le fiorerie, ognuna
  nel suo fuso orario; `runDailyMaintenance` (core) la chiama. Su Vercel la avvia Vercel Cron
  ogni giorno alle 06:07 UTC, poco dopo la mezzanotte del Messico (`/api/internal/maintenance`,
  protetta da `CRON_SECRET`, che ora serve su Vercel anche senza AI); altrove un ciclo nel
  processo (dopo 30 s e ogni 6 ore). È idempotente.
- **Audit:** come prima, la scadenza automatica non scrive righe di audit (resta
  `statusChangedAt`); da rivedere se servirà lo storico per report.
- **Test:** letture senza scritture, filtri e cambi di stato sullo stato effettivo, scadenza per
  fuso orario (l'ultimo giorno di validità resta valido) su due fiorerie, inviti; E2E: l'endpoint
  risponde solo con il segreto.

### ADR-041 — Rami `staging` e `prod`; online va solo il ramo di produzione di ogni progetto — ADOTTATO (22/11/2026)

- **Decisione del founder:** due rami stabili. `staging` è l'ambiente di prova (progetto Vercel
  `gardelia-staging`); `prod` è la produzione (progetto `gardelia-production`, dal lancio). I rami
  di lavoro (es. `claude/…`) non vanno mai online.
- **Flusso:** ramo di lavoro → `staging` quando un blocco è finito e tutti i controlli sono verdi
  (avanzamento allo stesso commit già provato dalla CI) → `prod` solo con il via libera esplicito
  del founder.
- **Vercel:** ogni progetto pubblica il proprio ramo di produzione. `apps/web/vercel.json` spegne i
  deploy dei rami `claude/**` (`git.deploymentEnabled`): il lavoro in corso non va mai online né
  gira contro il database di prova. Le anteprime per PR (PLATFORM_PLAN §4) torneranno con un
  database proprio. **Tolto il 22/11/2026:** un `ignoreCommand` che saltava ogni build non di
  produzione (`[ "$VERCEL_ENV" != production ]`): su Vercel annullava anche i deploy del ramo di
  produzione (deploy del rilascio firmato annullato con "Ignored Build Step"). Se servirà fermare
  le anteprime di altri rami, si userà l'Ignored Build Step del singolo progetto, provato prima.
- **GitHub:** ramo predefinito `staging` (PR e workflow manuali partono da lì). CI a ogni push di
  `staging`, `prod` e dei rami di lavoro, e su ogni PR.
- **Supera** il "merge su `main`" del PLATFORM_PLAN: il ramo `main` non esiste.
- **Deploy sul piano Hobby** (aggiunto il 22/11/2026): Vercel pubblica solo i commit fatti dal
  titolare dell'account; quelli di Claude vengono ignorati senza avvisi (solo il primo deploy,
  avviato dal founder con l'import, era passato), e lo stesso vale per i Deploy Hook (provato: la
  richiesta resta "in attesa" e non crea nulla). **Rilascio su `staging`:** un merge `--no-ff` del
  ramo di lavoro, solo dopo la CI verde su quel commit, con autore e committer l'account GitHub
  del founder (indirizzo noreply `76139421+leviuzz@users.noreply.github.com`, nome `leviuzz`) e
  Claude come coautore nel messaggio. Consenso esplicito del founder del 22/11/2026 ("sì, firma i
  rilasci di staging a mio nome"). I commit del ramo di lavoro restano firmati da Claude: il merge
  vale come rilascio, il contenuto resta attribuito a chi l'ha scritto. `prod` non cambia: si
  aggiorna solo con il via libera del founder, ogni volta.

### ADR-042 — Interfaccia in spagnolo, italiano e inglese, scelta da ogni persona — ADOTTATO (22/11/2026)

- **Decisione del founder** (non parla spagnolo): attivare subito italiano e inglese, che la
  specifica prevedeva "predisposti mediante i18n" (es-MX al lancio). Non cambia il mercato: la
  lingua predefinita resta **es-MX** e fioristi e clienti in Messico non vedono differenze.
- **Chi sceglie:** ogni persona, per browser, dal menu dell'account e dalle pagine senza menu
  (accesso, registrazione, invito, onboarding, pagina iniziale): Español / Italiano / English. La
  scelta sta in un cookie (`NEXT_LOCALE`, un anno, solo preferenza: nessun dato della fioreria);
  `i18n/request.ts` lo legge a ogni richiesta, con es-MX se manca o è sconosciuto. Il selettore è
  un modulo con un pulsante per lingua (funziona anche senza JavaScript).
- **Dati localizzati:** il contesto della fioreria usa la lingua dell'interfaccia (es. i nomi dei
  fiori della tassonomia, già presenti in tre lingue).
- **Cosa resta nella lingua del mercato della fioreria**, qualunque lingua abbia scelto chi lavora:
  il messaggio WhatsApp al cliente (traduttore esplicito `getTranslations({ locale })`) e le
  email transazionali (modelli di core, in spagnolo). **Limite noto:** il preventivo stampato/PDF
  segue per ora la lingua di chi lo stampa (stessa pagina dell'editor); diventa sempre spagnolo con
  la pagina pubblica del preventivo (V1). Importi e date dei preventivi restano nel formato
  messicano.
- **Traduzioni:** `messages/it-IT.json` ed `en-US.json` con le stesse chiavi di `es-MX.json`;
  termini del Messico tenuti fra parentesi dove servono (RFC, CFDI, colonia). Ogni testo nuovo va
  scritto nelle tre lingue: `apps/web/test/messages.test.ts` fallisce se manca una chiave o se una
  traduzione perde un argomento, un plurale o un tag (messaggi ICU analizzati con il parser di
  FormatJS).
- **Test:** parità dei messaggi; E2E che cambia lingua (pagina di accesso e menu) e torna allo
  spagnolo; i test E2E esistenti restano in spagnolo (lingua predefinita).
- **Dati scritti dalla fioreria (25/11/2026, feedback del founder):** i servizi di Floral Care hanno
  il nome principale nella lingua del mercato, che leggono i clienti, e traduzioni facoltative
  (`CareService.translations`, copiate sul contratto con il nome perché Mi Floral Care non legge
  il servizio). Quelli della nostra lista li traduce Gardelia; per i suoi li scrive il fiorista.
  L'app della fioreria e Mi Floral Care mostrano la lingua di chi guarda; rapporto pubblico della
  visita, email, addebiti ed esportazioni restano nella lingua del mercato.

### ADR-043 — Specie dei fiori: elenco ampio, ricerca nella propria lingua, specie dal nome — ADOTTATO (22/11/2026), elenco DA VALIDARE

- **Problema** (founder, dopo le ortensie al posto delle rose, ADR-034): la tassonomia globale
  aveva 14 voci (10 fiori recisi), quella della demo, e il campo Specie era una tendina. Un fiore
  fuori elenco non è bloccante (il nome del prodotto arriva comunque all'IA), ma la specie dà
  all'IA il nome inglese preciso e scioglie i nomi locali ("Nube" = gypsophila).
- **Elenco:** 72 specie vendute dalle fiorerie messicane (45 fiori recisi, 10 fogliami, 17
  piante), con nomi in es-MX, it-IT, en-US e **sinonimi per lingua** (nube, astromelia, pompón,
  cartucho, matsumoto, costilla de Adán, teléfono…), nuova colonna `CanonicalFlower.synonyms`.
  Fonte: `packages/db/src/reference-data.ts`, allineata a ogni rilascio; gli slug esistenti
  restano. È una **proposta del team, DA VALIDARE con un fiorista** (spec §19.6: catalogo fiori
  canonico ancora aperto); aggiungere una specie = una voce nel file. Un test controlla tre lingue,
  colori del vocabolario, slug storici presenti e che ogni nome o sinonimo indichi una sola specie
  della stessa categoria.
- **Ricerca dipendente dalla lingua** (richiesta del founder): il campo Specie è una casella di
  ricerca (combobox ARIA). Ordine dei risultati: nomi e poi sinonimi nella lingua dell'interfaccia,
  poi quelli delle altre lingue, poi il nome scientifico. Un risultato trovato con un altro nome lo
  dice ("Clavel · también «Garofano»"). Sotto il campo c'è una **nota**: si scrive il nome nella
  propria lingua, perché ogni lingua chiama i fiori in modo diverso, o il nome scientifico. Senza
  risultati, il campo dice che si può lasciare vuoto, perché basta un nome del prodotto chiaro.
- **Specie suggerita dal nome del prodotto:** "Rosa roja Freedom" → Rosa, "Nube blanca" →
  Gypsophila. Contano tutte le lingue, perché il nome del prodotto è nella lingua della fioreria.
  Vince il fiore nominato per primo ("Clavel rosa" è un garofano), a parità il nome più lungo
  ("Mini rosa" batte "Rosa"); i plurali sono riconosciuti (rosas, alcatraces, gigli). "Rosa" e
  "lavanda", che sono anche colori, contano solo come prima parola ("Pensamiento rosa" non diventa
  una rosa). Il suggerimento vale finché la persona non sceglie; è dichiarato sotto il campo e
  si cambia o si toglie. Un prodotto già salvato senza specie la riceve all'apertura se il nome la
  indica, e si salva solo con "Guardar cambios".
- **Effetti collegati:** misure del boceto per le varianti mini (rosa spray 4 cm, mini clavel 4,
  mini gerbera 6) e plurale inglese "birds of paradise" nel prompt.
- **Dove:** regole pure in `packages/domain/src/species.ts` (test di dominio), elenco e
  sincronizzazione in `packages/db`, `listCanonicalFlowers` in core, campo
  `catalog/species-field.tsx`; E2E in spagnolo e in italiano.

### ADR-044 — Procedure guidate: nuovo prodotto e Diseñador — ADOTTATO (22/11/2026)

- **Richiesta del founder:** guidare chi aggiunge un fiore, un passo alla volta; lo stesso per il
  Diseñador, con l'anteprima che si può saltare.
- **Nuovo prodotto** (`/catalog/new`): 1. **Qué es** (tipo, nome, varietà, specie suggerita), 2. **Colores**, 3. **Precio** (unità, prezzo, costo, disponibilità; SKU, descrizione, etichette,
  tempi e misure in "Más detalles", chiuso) → "Crear producto", 4. **Foto** (`/catalog/new/[id]`,
  facoltativa: "Saltar por ahora"), 5. **Listo** (aggiungere un altro prodotto, usarlo nel
  Diseñador, vedere il prodotto; per un ramo: "Armar la receta"). Tipi senza foto (servizi)
  passano dal prezzo al passo finale.
- **Come:** un solo `<form>` con i passi nascosti, così il server riceve tutto insieme e le regole
  restano quelle di prima. "Continuar" controlla i campi del passo, e Invio vale "Continuar". Un
  errore del server riporta al passo del campo sbagliato e apre "Más detalles" se serve, senza
  perdere nulla. I passi dopo la creazione sono pagine vere: si ricaricano e il tasto indietro
  funziona. La modifica resta un modulo unico con gli stessi gruppi di campi.
- **Indicatore dei passi** condiviso (`components/common/step-indicator.tsx`): su telefono
  "Paso 2 de 5 · Colores"; i passi già fatti sono cliccabili. Su telefono i pulsanti stanno uno
  sotto l'altro, con l'azione principale in alto.
- **Diseñador** (`BouquetEditor`): 1. **Flores** (almeno un fiore per continuare), 2. **Follaje y
  empaque** (fogliame, complementi, carta o base con il colore: senza colore non si continua), 3. **Detalles** (nome, stile, misura, budget, note) → "Guardar diseño", 4. **Vista previa**,
  facoltativa: boceto gratis e foto realistica solo su richiesta, "Saltar este paso", 5. **Listo**
  ("Crear cotización", "Volver a los diseños"). Il riepilogo con il prezzo resta sempre accanto
  (sotto, su telefono, con il totale fisso in basso). Un disegno nuovo arriva fino ai dettagli;
  dopo il salvataggio si apre sull'anteprima. Un disegno già salvato si riapre sul passo finale, con
  tutti i passi cliccabili come schede, e se si cambia qualcosa una barra "Tienes cambios sin
  guardar" offre "Guardar cambios" da qualsiasi passo. Senza AI (nessun provider) il passo
  dell'anteprima non c'è. Calcoli, colori e controlli di disponibilità sono quelli di prima.
- **Esteso il 23/11/2026** (richiesta del founder: "dove vedi la possibilità di organizzare flussi
  in stepper fallo"):
  - **Nuevo pedido** a passi: 1. **Cliente** (scelta), 2. **Productos** (righe e sconto, "Continuar"
    solo con almeno un prodotto), 3. **Entrega y tarjeta** con "Confirmar pedido". I passi del
    borrador sono pagine vere (`?step=delivery`): si ricaricano e il tasto indietro funziona. Il
    riepilogo con il totale resta accanto (su telefono prima del modulo di consegna) con "Cambiar
    productos".
  - **Creazione della fioreria** a passi: 1. **Tu florería**, 2. **Dirección de la tienda** con
    "Crear mi florería": un solo modulo come qui sopra, con l'aiuto comune `lib/form-steps.ts`
    (campi del passo controllati prima di andare avanti, errore del server → il suo passo, cursore
    sul primo campo del passo aperto).
  - **Non** a passi: i moduli brevi (telefono, un indirizzo, un pagamento) e "Convertir en pedido"
    (un solo passo vero: consegna e tarjeta, il preventivo è già accettato). L'ordine del cliente
    nel marketplace (C4) nascerà a passi.

### ADR-045 — "Generar otra versión" della foto realistica — ADOTTATO (22/11/2026)

- **Richiesta del founder:** la foto di un ramo si salva e non si rigenera per lo stesso ramo
  (cache per fioreria: stessi prodotti, quantità, colori, stile e misura → stessa immagine, senza
  crediti, anche da un altro disegno). Una nuova foto solo con un pulsante dedicato.
- **Cosa:** sotto la foto riuscita, "Generar otra versión" apre una conferma: usa 1 credito
  (mostra quanti ne restano) e i preventivi che hanno già l'immagine la conservano. Disattivato
  con modifiche non salvate, disegno superato o crediti finiti; nascosto quando i tentativi del
  conteggio esatto sono esauriti.
- **Come** (`requestBouquetPreview(..., { anotherVersion: true })`): nuovo job per lo stesso ramo
  con le stesse regole della prima (quota, tetto di spesa, limite dei conteggi sbagliati); se una
  generazione dello stesso ramo è già in corso si restituisce quella (mai due crediti per un
  doppio clic). Si mostra la generazione più recente riuscita o in corso, e i preventivi nuovi
  prendono l'immagine più recente. Se l'altra versione non riesce si vede ancora la precedente,
  con un avviso, e nessun credito consumato (come ogni fallimento). Audit con
  `anotherVersion: true`.

### ADR-046 — Calendario delle date speciali dei clienti — ADOTTATO (22/11/2026)

- **Richiesta del founder** (dopo i riscontri dei fioristi): un calendario "classico, tipo Google
  Calendar" con le date dei clienti in arrivo, per mese, settimana e giorno, pensato per
  aggiungere poi le notifiche (email, promo).
- **Cosa:** sezione "Calendario" nel menu (su telefono in "Más"), per chi vede i clienti, staff
  compreso. Viste: **mese** (griglia di settimane intere; su desktop fino a 2 nomi per giorno più
  "+N más", su telefono pallini per tipo e l'elenco del mese sotto), **settimana** (sette colonne
  con tipo e cliente; su telefono un giorno sotto l'altro), **giorno** (anni compiuti, WhatsApp
  con il testo nella lingua della fioreria, "Nueva cotización" per chi crea preventivi, "Ver
  cliente") e **agenda** (60 giorni, solo i giorni con date, "en N días"). "Hoy", precedente e
  successivo; ogni giorno si apre con un clic. Dalla dashboard, "Ver calendario".
- **Come:** vista e data stanno nell'URL (`?view=…&date=AAAA-MM-GG`): i link si condividono, la
  pagina funziona senza JavaScript e il tasto indietro torna alla vista precedente. Pagina tutta
  lato server, senza librerie di calendario. Le regole delle date stanno in `domain/calendar.ts`:
  settimana da domenica in es-MX ed en-US, da lunedì in it-IT; il 29 febbraio cade il 28 negli
  anni non bisestili; "oggi" è nel fuso della fioreria. `listCalendarOccasions(ctx, { from, to })`
  in core richiede `customers:read`, legge al massimo 93 giorni e solo i mesi utili, e mostra
  solo i clienti attivi: un cliente archiviato esce dal calendario.
- **Per dopo:** il servizio restituisce eventi con data e tipo, quindi altre fonti (consegne,
  ordini, email promo inviate) si aggiungono con lo stesso intervallo.

### ADR-047 — Promo delle date speciali: email automatica con sconto — ADOTTATO (22/11/2026), aspetti legali DA VALIDARE

- **Richiesta del founder** (dopo i riscontri dei fioristi): una pagina promo "semplicissima" con
  solo lo sconto (percentuale o importo fisso nella valuta della fioreria) e un'email automatica
  al cliente per le sue date speciali ("torna, compra un mazzo e hai tot di sconto").
- **Pagina Promociones** (`/promotions`, nel menu per proprietario e manager, permesso
  `promotions:manage`): interruttore "Enviar el correo automáticamente", tipo di sconto (1–90 % o
  importo), come funziona (quanti clienti la ricevono, email degli ultimi 30 giorni) e
  l'anteprima dell'email vera, nella lingua del mercato della fioreria.
  **Aggiunto da me, da confermare:** l'interruttore, spento all'inizio, perché nessuna fioreria
  inizi a scrivere ai suoi clienti senza averlo deciso.
- **Chi la riceve:** solo i clienti attivi con email **e** consenso alle promozioni (regola della
  spec: niente promozioni senza consenso). Mai dalle fiorerie DEMO (ADR-016): lì si configura e si
  vede l'anteprima, ma non parte nulla (`app_occasion_promo_tenants` filtra solo fiorerie LIVE e
  attive, il lavoro lo ricontrolla).
- **Quando:** l'email parte quando la prossima ricorrenza cade entro il preavviso della data (il
  campo "Avisar con días de anticipo", 7 giorni se non cambiato), quindi nessun nuovo parametro.
  Lo sconto vale fino al giorno della data. Il lavoro gira con la manutenzione giornaliera, il cui
  cron passa dalle 00:07 alle **9:07 del Messico** (`vercel.json`; col piano Hobby l'ora esatta
  cade dentro l'ora indicata). Si resta a 2 cron, come previsto da `docs/PLATFORM_PLAN.md`.
  Le scadenze dei preventivi si calcolano già in lettura, quindi l'ora non cambia nulla per
  l'utente.
- **Una sola email per data e anno:** la riga `OccasionPromoEmail` si crea **prima** dell'invio
  (vincolo unico per data e anno), così due esecuzioni insieme non mandano due email. Le date dello
  stesso cliente prese lo stesso giorno andavano in un'unica email (superato da ADR-048: un'email
  per data, ciascuna col suo codice). Se l'invio fallisce si riprova nei giorni seguenti, fino a 3
  tentativi, finché la data non è passata. Un invio interrotto a metà non si ripete: meglio
  un'email in meno che una doppia. La riga conserva lo sconto promesso e nessun indirizzo email.
- **Email:** mittente con il nome della fioreria (l'indirizzo resta quello verificato della
  piattaforma), risposta all'email di contatto della fioreria, pulsante WhatsApp se ha un
  telefono, contatti, motivo dell'invio e link per non ricevere più promozioni. Intestazioni
  `List-Unsubscribe` e `List-Unsubscribe-Post` (RFC 8058) per la disiscrizione con un clic dai
  programmi di posta.
- **Disiscrizione:** link personale firmato (HMAC con una chiave derivata da
  `BETTER_AUTH_SECRET`; contiene fioreria e cliente, non scade). La pagina `/unsubscribe/[token]`
  chiede conferma con un pulsante, perché le anteprime automatiche dei link non devono togliere il
  consenso. `POST /api/unsubscribe/[token]` serve la disiscrizione con un clic, mentre un GET
  porta alla pagina. Toglie il consenso del cliente e lo registra nell'attività della fioreria
  senza dati personali.
  **Eccezione motivata alla regola "tenant solo dalla sessione":** questo flusso non ha sessione.
  Fioreria e cliente vengono solo dal link verificato, come per gli inviti. Si usa
  `withTenantContext` di quella fioreria (RLS attiva), mai un contesto di sistema. Cambiare
  `BETTER_AUTH_SECRET` invalida i link già inviati.
- **Calendario:** ogni data dice se la promo è partita, se è fallita, quando partirà, oppure
  perché non partirà (cliente senza email o senza consenso).
- **DA VALIDARE (avvocato, `docs/legal/README.md`):** requisiti delle email promozionali inviate
  dalla fioreria tramite Gardelia, cioè identificazione, disiscrizione ed eventuali registri di
  esclusione. Va verificato anche che il consenso registrato dal fiorista basti. L'aviso de
  privacidad della fioreria deve prevedere questo uso (termini, sezione 7).
- **Per inviare davvero serve il dominio email verificato (P-07):** il mittente di prova del
  provider consegna solo all'indirizzo del titolare dell'account.
- **Piani (O-11, deciso dal founder il 22/11/2026):** la promo resta in tutti i piani; le promo
  più articolate, quando arriveranno, saranno a pagamento.

### ADR-048 — Codici e registro degli sconti della promo — ADOTTATO (22/11/2026)

- **Richiesta del founder:** "dobbiamo tenere traccia degli sconti fatti e a chi". Quando un
  cliente scrive su WhatsApp "ho questo sconto", la fioreria deve poter controllare, poi segnare lo
  sconto come usato. Conferma anche che l'invio deve essere automatico: con l'interruttore acceso
  le email partono da sole ogni mattina (era già così; ora l'interruttore si chiama "Envío
  automático cada mañana" e la pagina mostra i prossimi invii dei 7 giorni).
- **Codice personale:** 6 caratteri senza 0/O né 1/I (es. `K7M-4QH`), unico nella fioreria
  (vincolo del database). È nell'email, ben visibile, e nel messaggio WhatsApp già scritto
  ("…código K7M-4QH…"), così arriva alla fioreria insieme alla richiesta. Si cerca come lo scrive
  il cliente: minuscole, spazi, con o senza trattino.
- **Un'email per data** (cambia ADR-047): ogni data ha il suo sconto e il suo codice. Due date
  dello stesso cliente che partono lo stesso giorno danno due email, come prima ne davano una con
  due date. Il caso è raro, ed è più chiaro di un'email con due codici.
- **Registro "Descuentos"** (`/promotions/discounts`, proprietario e manager): ogni email partita
  con codice, cliente, data, sconto, invio e scadenza. Stati: **vigente** fino al giorno della
  data compreso, **usado**, **vencido**. Si cerca per codice, nome, email o telefono e si filtra
  per stato, con i totali. "Marcar como usado" chiede conferma e accetta una nota facoltativa (es.
  "COT-0042, ramo de 24 rosas"); salva chi e quando. "Deshacer" corregge uno sbaglio; entrambe le
  azioni vanno nell'audit. Anche uno sconto scaduto si può segnare come usato: decide la fioreria,
  e il registro mostra la data d'uso rispetto alla scadenza.
- **Si vede anche** nella scheda del cliente (scheda "Promociones": tutti la leggono, solo chi
  gestisce le promo la modifica) e nel calendario ("Promoción enviada el … · código …" o "usada").
- **Consenso più esplicito:** la casella dice "El cliente aceptó recibir promociones". La spiegazione
  aggiunge che con email e invio automatico attivo il cliente riceve lo sconto delle sue date, che
  può disiscriversi dall'email e che la data del consenso si salva. Resta da validare con l'avvocato
  se basta (ADR-047).
- **Per dopo:** collegare lo sconto al preventivo, così si applica da solo (le cotizaciones hanno
  già uno sconto); promo aggiuntive inviate a mano dalla fioreria (il founder: "magari la
  facciamo dopo"); il marketplace dei clienti, dove tutto sarà automatico.

### ADR-049 — Dati di prova di una fioreria (operazione di piattaforma) — ADOTTATO (23/11/2026)

- **Richiesta del founder:** "uno script per il db che mi aggiunga clienti e fiori per testare il
  negozio… le foto dei fiori puoi generarle te… aggiungi anche eventi nel calendario".
- **Dove:** operazione di piattaforma `test-data` (CLI `pnpm platform:test-data`, workflow
  "Operazioni di piattaforma", ADR-021), non un pulsante nell'app: non è una funzione per i
  fioristi e nessun dato inventato va presentato come reale nell'interfaccia.
- **Come:** passa dai servizi veri (validazione, audit con l'operatore come autore, RLS) con il
  contesto dell'operatore. Servono due cose: amministratore della piattaforma **e** proprietario o
  manager della fioreria (`catalog:write`, `customers:write`). Su una fioreria altrui risponde 404 e
  non scrive nulla.
- **Cosa aggiunge:** 18 prodotti con codice `PRB-…` (13 fiori e 2 verdi con la specie, 2 carte, 1
  nastro), prezzi INDICATIVI in MXN, non un listino; 23 clienti inventati con etichetta `prueba`,
  email `@example.com` (dominio riservato agli esempi, RFC 2606), telefoni 555 e 26 date speciali.
  Le date sono contate da oggi, nel fuso della fioreria, così calendario e "Próximos envíos" si
  riempiono subito; la festa della mamma è fissa al 10 maggio.
- **Promo:** i clienti inventati non hanno il consenso, quindi la promo automatica non scrive a
  indirizzi falsi. In più c'è "Cliente de prueba (tú)": email dell'operatore, consenso, compleanno
  fra 3 giorni. Con la promo attiva gli arriva l'email vera con il codice.
- **Rilanciabile:** aggiunge solo ciò che manca (prodotti per codice, clienti per nome). Le foto si
  aggiungono solo ai prodotti attivi che non ne hanno, quindi non si generano (né pagano) due volte.
  Una foto che fallisce non ferma le altre.
- **Foto:** una per ogni fiore e verde, generata da fal con lo stesso modello delle anteprime
  (~0,08 USD l'una, 15 foto ≈ 1,20 USD): un fiore solo, fondo liso, niente testo. Non passa dalla
  coda AI, quindi resta fuori dal tetto mensile (`AI_MONTHLY_BUDGET_USD`). La lancia a mano un
  amministratore e la stima si stampa prima di partire. Gli scontorni passano invece dalla coda
  (tetto incluso) e la CLI li lavora subito, solo per quella fioreria. Nel workflow i segreti
  `FAL_KEY` e `R2_*` arrivano solo al passo `test-data`; senza, si aggiunge tutto tranne le foto.
  I segnaposto (cerchi colorati) funzionano solo con l'archivio su disco, cioè solo in locale: mai
  online.

### ADR-050 — Accesso confermato a mano dall'amministratore (senza email di conferma) — ADOTTATO (23/11/2026)

- **Problema:** senza dominio verificato su Resend le email (conferma, inviti, nuova password)
  arrivano solo al titolare dell'account Resend, quindi i tester non riescono a entrare. Il
  founder: "aggiungiamo la persona con uno script sul db e basta".
- **Decisione:** operazione di piattaforma `confirm-user` (CLI `pnpm platform:confirm-user`,
  workflow "Operazioni di piattaforma"). La persona si registra da sola sul sito e sceglie la sua
  password: l'operazione non crea account e non tocca password. L'amministratore ne conferma
  l'email e, se indica una fioreria, la aggiunge al team come **manager o staff**. Il proprietario
  nasce solo creando la propria fioreria. Se la persona è già nel team, il ruolo non cambia (si
  cambia dalla pagina Equipo).
- **Garanzie:** solo un `SUPER_ADMIN` attivo. Tutto in una transazione, quindi un rifiuto (persona
  o fioreria inesistente, ruolo non ammesso) non cambia nulla. Audit: email confermata (evento di
  piattaforma) e ingresso nel team (attività della fioreria: "… (soporte de la plataforma)").
  Nel workflow le email e la fioreria sono mascherate, anche in minuscolo.
- **Responsabilità:** chi conferma garantisce che l'email è davvero di quella persona, perché la
  conferma salta la prova di possesso. Va usata solo per persone conosciute, finché il dominio non
  è verificato (`docs/DEPLOY_VERCEL.md` §4.4).

### ADR-051 — Eliminare un disegno del Diseñador con le sue foto — ADOTTATO (23/11/2026)

- **Richiesta del founder:** "un elimina bouquet dal designer oltre che archivia, che elimina anche
  il bouquet generato dalla memoria". Fra le opzioni proposte ha scelto "elimina se non è in un
  preventivo".
- **Eccezione voluta** alla regola "nessuna cancellazione fisica di dati commerciali"
  (CLAUDE.md §5), solo per i disegni del Builder. Un disegno non ancora quotato è una bozza di
  lavoro, non un documento commerciale. Un disegno usato in un preventivo non si elimina mai: la
  cotización conserva composizione e foto, quindi resta solo "Archivar".
- **Cosa si cancella:** il disegno e le sue righe (FK in cascata) e le foto generate per lui
  nell'archivio (R2). Le foto si cancellano dopo il commit: se una cancellazione fallisce resta un
  file orfano, registrato nel log, e mai un record che punta a un file sparito.
- **Cosa resta:**
  - Le righe `AiJob`, staccate dal disegno e senza immagine. Il credito già usato resta usato e il
    costo resta nel tetto della piattaforma. L'hash prende il prefisso `deleted:`, così la cache
    per contenuto non ripropone una foto che non c'è più.
  - Le foto che un preventivo mostra (`QuoteLine.previewJobId`), anche se il preventivo è di un
    altro disegno.
  - Le foto che un altro disegno identico, attivo o archiviato, mostra oggi dalla cache (stessa
    composizione, stesso stile e misura): passano a quel disegno e si cancelleranno con lui.
  - I job falliti, con il loro hash: il limite di riprova per quel ramo vale ancora.
- **Regole:**
  - Permesso nuovo `builder:delete`, solo proprietario e manager. Lo staff compone e archivia.
  - Si conferma in una finestra che dice che non si può annullare e che i crediti non tornano.
  - Una foto in preparazione blocca l'eliminazione (`ai_preview_in_progress`): la sua immagine
    arriverebbe dopo.
  - La riga del disegno si blocca (`FOR UPDATE`), così un preventivo o un'anteprima chiesti nello
    stesso istante non lasciano riferimenti a un disegno sparito.
  - Audit `builder.configuration_deleted` con nome e numero di foto cancellate e tenute.
  - Un'altra fioreria riceve 404.

### ADR-052 — Foto vera del ramo al posto della foto AI — ADOTTATO (23/11/2026)

- **Richiesta del founder:** nel Diseñador il fiorista sceglie "genera la foto" oppure "carica la
  foto del tuo ramo"; quel ramo va anche fra i ramos della fioreria ("Mis ramos"). È il passo 6 di
  FLOW-B nella spec ("il merchant allega eventuale foto reale") e l'uso degli esempi del fiorista
  (AI-BQ-07).
- **Allenare l'AI: segnalato e non fatto.** Il founder ha detto che quelle foto "andranno ad
  allenare". Oggi le foto di "Mis ramos" non addestrano nessun modello: vengono descritte a parole
  e danno lo stile alle foto AI (ADR-032). La spec §6.4 vieta di addestrare sulle foto del fiorista
  senza un accordo esplicito e separato, e il modello in uso non si può addestrare. Se un giorno
  servisse, sarà una decisione a parte, con un suo consenso.
- **Cosa fa:**
  - Il passo 4 del Diseñador diventa "Foto del ramo", con le schede "Foto con IA" (l'anteprima di
    prima) e "Tu foto". Il passo c'è per ogni disegno attivo, anche senza AI configurata: allora
    resta solo "Tu foto".
  - Chi usa il Builder (`builder:use`, anche lo staff) carica, cambia o toglie la foto, con il
    piano Plus. La foto si riduce nel browser e il server la ricodifica come le altre foto.
  - Una sola foto attiva per disegno (indice parziale). Cambiata o tolta, la precedente si archivia
    e resta ai preventivi che la mostrano.
  - I preventivi creati dal disegno la agganciano (`QuoteLine.bouquetPhotoId`, solo righe BUILDER)
    e la mostrano al posto dell'anteprima AI: pagina, stampa/PDF e download per WhatsApp, con la
    nota "Foto de un ramo hecho por la florería".
  - Una casella la aggiunge anche a "Mis ramos". La casella riporta per intero il consenso di "Mis
    ramos", quindi spuntarla è il consenso esplicito; è solo per chi può caricare lì
    (`builder:references:write`, proprietario e manager). In "Mis ramos" va una copia
    indipendente, con lo stile e il nome del disegno: archiviarla lì non tocca il disegno e
    viceversa.
  - Eliminando il disegno (ADR-051) se ne vanno anche le sue foto, file compresi. La copia in "Mis
    ramos" resta.
- **Sicurezza:** tabella `BouquetPhoto` con RLS e FK composite; file privati sotto
  `tenants/{tenantId}/bouquet-photos/`, serviti solo ai membri della fioreria; un'altra fioreria
  riceve 404. Audit `builder.photo_added` / `builder.photo_removed`.

### ADR-053 — Una query alla volta per connessione al database — ADOTTATO (23/11/2026)

- **Problema:** nei test e nei log del server compariva l'avviso di pg "Calling client.query()
  when the client is already executing a query", che in pg 9 diventa un errore. La causa sta
  dentro Prisma 7: in una transazione interattiva usa una sola connessione, e una lettura che
  include tre o più relazioni ne fa partire le query insieme. L'adattatore `@prisma/adapter-pg`
  (7.10.1, l'ultima stabile) le passa tutte allo stesso client pg, che le accoda con l'avviso.
  I `Promise.all` del nostro codice su una transazione non c'entravano: Prisma mette già in fila
  le operazioni separate (misurato).
- **Decisione:** il pool crea client `SerialClient` (opzione `Client` di `pg.Pool`), che mettono
  in fila le query con promessa: una alla volta, nell'ordine in cui arrivano, e un errore non
  blocca le successive. È ciò che pg faceva già internamente, quindi né i risultati né la velocità
  cambiano. Le forme con callback o con cursori passano invariate: il pool le usa su un client
  che ha in mano da solo.
- **Scartato:** la modalità "pipeline" di pg 8.23, che manda davvero le query insieme. È nuova e
  cambia il protocollo (una query lenta chiude la connessione, niente cursori): non serve per
  togliere l'avviso.
- **Garanzia:** `packages/db/test/serial-client.test.ts` legge un tenant con tre relazioni in una
  transazione e fallisce se compare l'avviso; senza `SerialClient` fallisce davvero (verificato).
  Nella suite completa e negli E2E l'avviso non compare più. Per chiarezza i due `Promise.all`
  su una transazione (pannello, equipo) ora sono scritti in fila.

### ADR-054 — Ordini: dal preventivo accettato, consegna, tarjeta, stati e pagamenti registrati — ADOTTATO (23/11/2026)

Blocco A1a di `docs/ORDERS_MARKETPLACE_PLAN.md` (D-26, D-27).

- **Modello:** `Order` (numero per tenant `PED-0001` con `TenantCounter`), `OrderLine` (stesse regole e
  snapshot di `QuoteLine`, enum `QuoteLineKind` riusato), `OrderPayment`, `OrderStatusEvent`. Tutte
  con `tenantId`, RLS e FK composite. Un ordine per preventivo (`@@unique([tenantId, quoteId])`).
- **Nascita:** "Convertir en pedido" su un preventivo ACCETTATO copia righe, snapshot e immagine del
  ramo; prezzi e sconto restano quelli concordati. L'ordine diretto, senza preventivo, è descritto
  più sotto (A1b). L'origine del preventivo passa all'ordine (`acquisitionSource`, base delle fee D-24).
- **Consegna:** domicilio o ritiro, data e fascia oraria (minuti dalla mezzanotte nel fuso della
  fioreria, entrambi o nessuno). L'indirizzo si **copia** nell'ordine, dalla rubrica del cliente
  (che deve essere lo stesso cliente) o nuovo con le regole della rubrica; destinatario e
  referencias vengono dalla rubrica se il form non li indica. Il ritiro non ha costo di consegna.
- **Tarjeta:** messaggio, firma o anonimo. Note interne separate.
- **Stati:** Confermato → In preparazione → Pronto → In consegna → Consegnato, oppure Pronto →
  Ritirato; un passo indietro per correggere; annullamento con motivo obbligatorio. Consegna e
  tarjeta si cambiano fino a "Pronto". `PENDING_ACCEPTANCE` è già nel modello per il marketplace (C4).
- **Pagamenti (D-26):** registrati a mano (contanti, trasferimento, terminale, link, altro), acconto o
  saldo, mai oltre quanto resta da incassare, mai nel futuro. Uno sbaglio si **storna** (riga
  negativa che punta al pagamento), non si cancella. `paidMinor` e `paymentStatus` sull'ordine.
- **Il database verifica:** totale = subtotale − sconto + consegna; stato del pagamento coerente con
  pagato e totale; fascia valida; indirizzo completo per il domicilio; niente "ritirato" per le
  consegne né consegna per i ritiri; motivo presente solo se annullato; storni negativi e collegati.
- **Permessi (PROPOSTO, insieme a O-08):** `orders:read` e `orders:fulfill` (far avanzare un ordine)
  a tutti; `orders:write` (creare, cambiare consegna, accettare, annullare) e `orders:payments` a
  proprietario e manager. Coerente con O-08: lo staff non crea clienti né preventivi.
- **Navigazione:** "Pedidos" nella barra in basso del telefono; il Catálogo passa nel menu "Más"
  per lasciare cinque colonne. Aggiornato da ADR-078 (founder, 24/11/2026): l'Agenda prende il
  posto di Clientes, che passa in "Más".
- **Audit:** `order.created`, `order.updated` (solo campi non personali), `order.status_changed`,
  `order.cancelled`, `order.payment_recorded`, `order.payment_reversed`; un ID di un'altra fioreria
  dà 404 e un evento di sicurezza.
- **Ordine diretto (A1b, 23/11/2026):** "Nuevo pedido" dall'elenco, dalla scheda del cliente o dal
  Diseñador ("Crear pedido" con il ramo del disegno) crea un **borrador** (`DRAFT`, senza data):
  prodotti del catalogo, righe libere e sconto con lo stesso editor dei preventivi (prezzi, costi e
  distinta SEMPRE dal catalogo del tenant), poi consegna e tarjeta con "Confirmar pedido". Nel
  borrador niente pagamenti, niente modifica della consegna (si compila alla conferma), niente
  annullamento: un borrador che non serve si **scarta** senza motivo (`CANCELLED` senza data, fuori da
  tutti gli elenchi; resta nella cronologia e nell'audit). Il database lo garantisce: senza data solo
  un borrador o un borrador scartato; il motivo è obbligatorio per annullare un ordine confermato.
- **Righe dopo la conferma:** prodotti e sconto si cambiano fino a "En preparación" (non per gli ordini
  del marketplace, che si accettano o rifiutano come li ha composti il cliente); un ordine confermato
  non resta mai vuoto. **Il totale non scende mai sotto quanto il cliente ha già pagato** (righe,
  sconto o costo di consegna): prima si storna il pagamento, così nessuna differenza da restituire
  resta nascosta (`order_total_below_paid`).
- **Diseñador:** un disegno usato da un ordine non si elimina (come per i preventivi, ADR-051) e
  l'immagine che un ordine mostra non si cancella con il disegno da cui è stata ereditata.
- **Audit in più:** `order.line_added`, `order.line_updated`, `order.line_removed`,
  `order.discount_changed`, `order.confirmed`, `order.discarded`.
- **Prossimi:** A2 (fasce e costi di consegna nelle impostazioni, coordinate), A3 (stampa della
  tarjeta, link pubblici).

### ADR-055 — Impostazioni di consegna: fasce, giorni di chiusura e costo proposto — ADOTTATO (23/11/2026)

Blocco A2 di `docs/ORDERS_MARKETPLACE_PLAN.md`, senza la parte che richiede le coordinate.

- **Fasce orarie** (`DeliveryWindow`, con `tenantId`, RLS e CHECK: dentro la giornata e in ordine;
  massimo 8, niente doppioni): nei form degli ordini diventano scelte rapide insieme a "Durante el
  día" e "Otro horario" (che riapre Desde/Hasta). Senza fasce il form resta quello di prima. Ogni
  ordine **copia i propri minuti**: togliere una fascia non cambia gli ordini già fatti, per questo
  la fascia (configurazione, non dato commerciale) si cancella davvero.
- **Giorni di chiusura** (`Tenant.deliveryClosedWeekdays`, CHECK 0–6): se la data di un ordine cade
  in un giorno chiuso il form lo **avvisa** ma non blocca: chi registra l'ordine sa se fa
  un'eccezione (es. 10 de mayo). Il blocco vero servirà agli ordini del marketplace (C4).
- **Costo di consegna proposto** (`Tenant.defaultDeliveryFeeMinor`, ≥ 0): precompila il costo nei nuovi
  ordini a domicilio (conversione dal preventivo e borrador); si cambia in ogni ordine e resta
  congelato nell'ordine.
- **Non fatto, di proposito:** costo per distanza (fasce in km) e raggio massimo hanno bisogno delle
  coordinate degli indirizzi: ora arrivano da Google Places (ADR-059), ma solo per gli indirizzi
  scelti fra i suggerimenti, quindi il calcolo resta da progettare (con un ripiego per gli indirizzi
  scritti a mano). Finché non c'è non mostriamo nulla che finga di calcolarli. Il preavviso minimo serve solo agli ordini del marketplace e arriva con C4.
- **Permessi:** le leggono tutti (servono a chi compila un ordine); le cambiano proprietario e
  manager (`tenant:settings:update`). Audit: `delivery_settings.updated` (con le differenze),
  `delivery_window.added`, `delivery_window.removed`; una fascia di un'altra fioreria dà 404 e un
  evento di sicurezza.

### ADR-056 — Link pubblici di preventivi e ordini, tarjeta da stampare — ADOTTATO (23/11/2026)

Blocco A3 di `docs/ORDERS_MARKETPLACE_PLAN.md`; il link pubblico del preventivo con accettazione era
già approvato dal founder il 21/11.

- **Cosa vede il cliente, senza account:** `/cotizacion/<token>` (righe con foto del ramo, distinta,
  totali, validità, note per il cliente, "Aceptar cotización") e `/pedido/<token>` (a che punto è,
  quando e dove si consegna o si ritira, tarjeta, cosa contiene, pagato e da pagare). Mai costi,
  margini, note interne o dati di altri clienti; pagine `noindex` e `no-referrer`, nella lingua del
  mercato della fioreria; "Escribir a la florería" apre WhatsApp con il numero della fioreria.
- **Token:** fioreria + ID del link firmati con HMAC (chiave derivata dal segreto dell'app e dallo
  scopo, come la disiscrizione di ADR-047, ora in `core/src/signed-ids.ts`). Il token non si salva:
  il fiorista lo ricopia quando vuole. La riga `PublicLink` (RLS, FK composite, uno solo attivo per
  documento, CHECK sul tipo) dà **scadenza** (60 giorni) e **disattivazione**; "Crear uno nuevo"
  disattiva il vecchio. Il cliente si legge nel contesto della fioreria del token (RLS attiva), mai
  con un contesto di sistema.
- **Accettazione:** solo con un clic (POST): l'anteprima automatica di un link in WhatsApp non
  accetta nulla. Solo un preventivo inviato e ancora valido; l'esito si registra nell'attività senza
  utente (`quote.accepted_online`, con requestId e IP). La fioreria poi lo converte in ordine (i dati
  di consegna li decide lei).
- **Chi condivide:** chi scrive preventivi (`quotes:write`) o ordini (`orders:write`): il link mostra
  dati del cliente. Si condivide un preventivo inviato o accettato e un ordine confermato e non
  annullato; un link già dato a un ordine poi annullato resta e dice "cancelado". Il messaggio
  WhatsApp della fioreria include il link quando c'è. Audit: `public_link.created` (anche rinnovo),
  `public_link.revoked`.
- **Tarjeta da stampare:** pagina con il solo messaggio e la firma in un biglietto da 10 × 7 cm con
  la linea di taglio; la comanda resta la stampa della scheda dell'ordine.
- **Non fatto:** email al cliente con il link (V1 riga 13, quando c'è il dominio verificato), rifiuto
  del preventivo dal link (il cliente scrive alla fioreria).

### ADR-057 — Agenda dei pedidos: giorno, Producción del día e mese — ADOTTATO (23/11/2026)

Blocco B1 di `docs/ORDERS_MARKETPLACE_PLAN.md`.

- **Tre viste sotto Pedidos** (schede "Lista", "Día", "Calendario") invece di una voce di menu in più:
  il calendario delle date speciali resta quello dei clienti; quello degli ordini è un altro
  strumento con un altro scopo.
- **Día ("Hoy salen"):** ordini del giorno raggruppati per fascia ("Durante el día" prima), con
  cliente, destinatario, indirizzo o ritiro, cosa contiene, tarjeta, saldo da incassare e **un solo
  pulsante: il prossimo passo** (salti e correzioni dalla scheda). Gli ordini già consegnati o
  ritirati vanno in fondo, chiusi. Data per URL (`?date=`), frecce e scelta del giorno.
- **Producción del día:** fiori, verde e materiali sommati dalle **distinte congelate** nelle righe
  (ramos del catalogo e del Diseñador per il numero di ramos, articoli sciolti, colori separati),
  le righe libere a parte; solo ordini confermati, in preparazione o pronti. Pagina da stampare per
  il mercato e per il banco. Regola pura `aggregateProduction` nel dominio.
- **Calendario:** mese con quante consegne e quanti ritiri per giorno; un clic apre il giorno.
- **Chi vede:** tutta la squadra (`orders:read`); i passi seguono i permessi (`orders:fulfill`); niente
  costi. Borradores e ordini annullati non compaiono.
- **Aggiornato da ADR-075 (24/11/2026):** l'"Agenda" dei lavori, voce di menu a sé, mette insieme
  le visite di Floral Care e i pedidos del giorno e del mese. Le viste dei Pedidos restano qui.

### ADR-058 — Ruta del día, repartidor e prova di consegna — ADOTTATO (23/11/2026)

Blocco B2 di `docs/ORDERS_MARKETPLACE_PLAN.md`.

- **Repartidor:** un ordine a domicilio aperto si assegna a un membro **attivo** della fioreria
  (`Order.assignedMembershipId`, FK composita verso `Membership`; CHECK: solo a domicilio; passando a
  ritiro si toglie). Lo sceglie chi gestisce gli ordini (`orders:write`) dalla scheda; audit
  `order.assigned` con gli ID, mai nomi.
- **Ruta del día:** scheda "Ruta" sotto Pedidos con le consegne del giorno in ordine di fascia
  ("in giornata" in fondo), già consegnate in fondo e chiuse. Per ogni fermata: indirizzo, chi riceve
  con telefono ("Llamar", "WhatsApp"), indicazioni, repartidor, **cosa incassare** e il prossimo
  passo. "Mis entregas" mostra solo quelle di chi guarda: è la vista del repartidor sul telefono.
- **Google Maps gratis (D-27):** "Ir" e "Abrir ruta" sono link pubblici (Maps URLs), senza chiave né
  costi. Un link porta al massimo 3 tappe più l'arrivo (limite dell'app sul telefono): un giro lungo
  si divide in tratti, ognuno parte dall'ultima fermata del precedente; il primo parte dalla
  fioreria se ha l'indirizzo. Regole pure `mapsPlaceUrl` / `mapsRouteLinks`.
- **Ordine per vicinanza:** arrivato con Google Places (ADR-059): dentro ogni fascia le fermate con
  coordinate vanno per vicinanza; senza coordinate restano in ordine di fascia e numero.
- **Prova di consegna:** da "pronto" in poi chi fa avanzare gli ordini (`orders:fulfill`, anche il
  repartidor) carica la **foto del ramo finito** (`OrderPhoto`, file privati, una attiva per ordine,
  la precedente archiviata); dopo consegna o ritiro indica **chi l'ha ricevuto**
  (`Order.handoverName`, CHECK 1–120 caratteri). Il cliente vede foto ("Así quedó tu ramo") e nome
  nel suo link; nel registro di audit solo che è stato fatto, mai il nome.

### ADR-059 — Google Places: ricerca degli indirizzi e coordinate — ADOTTATO (23/11/2026)

Risolve O-14: il founder sceglie Google Places ("implementa google places", 23/11/2026) invece
delle zone per codice postale.

- **Cosa fa:** nei form degli indirizzi (onboarding, sede della fioreria, indirizzi dei clienti,
  consegna di un ordine) compare **"Buscar dirección"**: si scrive, si sceglie un suggerimento e i
  campi messicani si compilano (calle y número, colonia, CP, municipio, estado), poi si controllano
  a mano. Si salvano il **place ID** e le **coordinate**; la Ruta del día le usa per ordinare le
  fermate di ogni fascia per vicinanza (dalla fioreria, poi dall'ultima fermata: regola pura
  `nearestNeighborOrder`).
- **Senza chiave non c'è nulla** (nessuna funzione finta): `GOOGLE_MAPS_API_KEY` assente → il campo
  non compare, le rotte rispondono 404, gli indirizzi si scrivono a mano come prima. Google lento o
  in errore (timeout 5 s, quota superata) → messaggio "no disponible" e il form resta usabile.
- **Chiave solo sul server:** il browser chiede a `/api/places/autocomplete` e `/api/places/details`
  (solo con sessione, solo dalla nostra origine con JSON, al massimo 60 richieste al minuto per
  persona); il server chiede a Places API (New) con la chiave della piattaforma. Nei log mai il
  testo cercato né il corpo delle risposte di Google.
- **Regole di Google rispettate:** il place ID si può tenere senza limiti; le coordinate al massimo
  **30 giorni** (`coordinatesAt`), poi le cancella la manutenzione giornaliera
  (`app_purge_place_coordinates()`, SQL `SECURITY DEFINER` con i 30 giorni fissi) e la ruta ignora
  già quelle più vecchie. Salvare di nuovo lo stesso indirizzo **non allunga** la cache: la data
  cambia solo scegliendo di nuovo un suggerimento. Sotto i suggerimenti c'è "Google Maps"
  (attribuzione richiesta senza una mappa di Google).
- **Indirizzo corretto a mano:** cambiando via e numero, municipio o stato si perdono place ID e
  coordinate (il punto non è più quello di Google); interno, colonia e CP no, perché completano
  l'indirizzo senza spostarlo e Google spesso non li dà. Coordinate non valide si scartano senza
  bloccare il salvataggio. Un ordine che usa un indirizzo della rubrica ne copia luogo e data.
  **Aggiunta del 24/11/2026** (visto dal founder su staging):
  - se Google ha trovato una zona senza via (una colonia, un fraccionamiento), la via scritta a mano
    completa l'indirizzo dentro quella zona e il punto resta;
  - se Google non dà la via, il form usa il testo del suggerimento scelto quando ha un numero civico
    ("Magnolias 59", `streetFromSuggestion`); altrimenti il cursore va sulla via da scrivere;
  - place ID e coordinate stanno nello stato del componente e non vengono scritti a mano nei campi
    nascosti: React riscriveva il loro valore predefinito a ogni nuovo disegno del form, e il punto
    scelto spariva prima dell'invio (tienda mai sulla mappa, costo per distanza perso nel pedido
    fra un passo e l'altro);
  - nella sede della fioreria il form dice se la tienda è sulla mappa. "Mi tienda en línea" avvisa
    quando non lo è: allora la trova solo chi cerca la città (ADR-066).
- **Costi:** sessioni di Places (New): i suggerimenti di una ricerca che finisce con un indirizzo
  scelto non si pagano; si paga la "Place Details Essentials" (campi `id`, `addressComponents`,
  `location`), con una quota gratuita mensile (circa 10.000 dal 1° marzo 2025, da ricontrollare sul
  listino). Attesa sotto la quota con i volumi di una fioreria. Protezioni: attesa di 350 ms mentre
  si scrive, minimo 3 caratteri, 5 suggerimenti, preferenza per i 30 km attorno alla fioreria;
  quote giornaliere e avviso di spesa su Google Cloud (`docs/DEPLOY_VERCEL.md` §9).
- **Privacy:** a Google arriva solo il testo scritto nel campo di ricerca; riga aggiunta nella bozza
  dell'aviso de privacidad (O-07, da validare con il legale).
- **Non fatto:** costo di consegna per distanza e raggio massimo (vedi ADR-057), mappa nella app,
  geocodifica degli indirizzi scritti a mano (costerebbe e creerebbe coordinate "indovinate").

### ADR-060 — Inventario: giacenze, movimenti e avvisi (blocco 1) — ADOTTATO (23/11/2026)

Numerazione: ADR-055–059 sono riservati agli ordini e al marketplace (altra sessione).

- **Decisioni del founder (23/11/2026):**
  - giacenza per fioreria; le organizzazioni con più fiorerie arrivano dopo (D-28);
  - si conta nell'unità del catalogo e delle ricette (tallo, manojo, pieza), come già contano ricette
    e preventivi;
  - se la merce non basta: avviso e conferma esplicita, e la giacenza può scendere sotto zero (spec
    CAT-01);
  - registrano i movimenti solo proprietario e manager (`inventory:write`); tutti vedono le giacenze
    (`inventory:read`), lo staff senza costi (`catalog:costs:read`);
  - inventario nel piano Plus, domani Profesional (D-23): entitlement `inventory`; su Basic l'invito
    all'upgrade;
  - la giacenza non cambia da sola la disponibilità del catalogo: l'inventario propone il clic
    ("Marcar como agotado / limitado / disponible", `suggestedAvailability`), così un conteggio
    sbagliato non cambia all'improvviso Diseñador, preventivi e marketplace;
  - niente resi, lotti né ordine di scadenza (FEFO): un inventario semplice.
- **Chi non usa l'inventario non vede differenze:** piano Basic, prodotti non controllati, chi compra
  gli steli dopo l'ordine. Si controllano solo i prodotti scelti ("Elegir productos") fra i tipi
  fisici (fiori, verde, piante, vasi, carte, accessori); ramos e servizi non hanno giacenza, un ramo
  consuma i suoi ingredienti.
- **Modello:**
  - `InventoryItem`: uno per prodotto, con giacenza, costo medio e minimo ("Avísame cuando
    queden"); ARCHIVED = non si controlla più, lo storico resta;
  - `InventoryEntry`: il registro, con tipo, nota, chi e quando; un `REVERSAL` punta al registro
    annullato, uno solo;
  - `InventoryMovement`: una riga per prodotto, con quantità con segno, giacenza dopo, costo reale e
    costo del catalogo del momento;
  - tipi: `OPENING` (existencia inicial), `PURCHASE` (compra, blocco 2), `USE`, `WASTE` (merma),
    `ADJUSTMENT` (conteggio), `REVERSAL`.
- **Il database garantisce:**
  - RLS su tutte e tre le tabelle; registri e movimenti solo in lettura e inserimento, come l'audit
    (nessuna policy UPDATE né DELETE);
  - FK composite sul tenant, più una FK `(tenantId, entryId, kind)` che dà a ogni movimento il tipo
    del suo registro;
  - segno per tipo (OPENING e PURCHASE positivi, USE e WASTE negativi), limiti della giacenza, costi
    non negativi, una sola anulación per registro.
- **La giacenza cambia solo con un movimento:** `writeInventoryEntry` (core) scrive registro, righe e
  giacenza nella stessa transazione, con le righe dei prodotti bloccate (`FOR UPDATE`, in ordine di
  id). Il conteggio fisico registra la differenza come ajuste. Un test controlla che la giacenza sia
  sempre la somma dei movimenti, anche con usi contemporanei.
- **Errori:** un registro sbagliato non si cancella. "Anular" scrive il registro opposto, una volta
  sola; l'existencia inicial si corregge con un conteggio.
- **Costi:** costo reale = media ponderata degli ingressi (`averageCostAfterReceipt`); l'existencia
  inicial entra al costo del catalogo. Ogni movimento conserva costo reale e costo del catalogo del
  momento: è la base del costo previsto e reale (blocchi 2 e 4).
- **Per gli ordini (li collega l'altra sessione, senza toccarne il codice):**
  - `checkStock` / `checkStockTx`: basta la merce? Serve a mostrare l'avviso prima di confermare;
  - `consumeStockTx(tx, ctx, { lines, note, confirmShortage })`, dentro la transazione
    dell'ordine: somma le righe dello stesso prodotto e ignora i prodotti non controllati e le
    fiorerie senza il piano;
  - se la merce non basta chiede la conferma (`inventory_insufficient_stock`); restituisce il
    registro e i costi previsto e reale;
  - non controlla i permessi dell'inventario: li controlla chi chiama (es. `orders:fulfill`, che ha
    anche lo staff).
- **UI:**
  - una sola voce "Inventario" nel menu (su telefono in "Más"), con le schede Existencias e
    Movimientos;
  - "Elegir productos": quantità e minimo per più prodotti insieme;
  - scheda del prodotto: uso, merma (con avviso e "Registrar de todos modos"), conteggio, aviso,
    "Dejar de controlar" e lo storico con "Anular";
  - riquadro nella scheda del catalogo e riga nella pagina del piano;
  - testi nel namespace `inventory` delle tre lingue, compresi errori (`inventory.conflict.*`,
    `inventory.validation.*`) e attività (`inventory.activity.*`), letti dal prefisso del modulo.
- **Prossimi blocchi:** compras y proveedores (ADR-061), apartados con vencimiento (ADR-064), avvisi
  nel pannello e costo dei ramos (ADR-063).

### ADR-061 — Inventario: compras al mayorista, proveedores e costo reale (blocco 2) — ADOTTATO (23/11/2026)

- **Cosa:** scheda "Compras" dell'inventario, solo per proprietario e manager (`inventory:write`):
  le compras hanno i prezzi, che lo staff non vede.
  - "Nueva compra": proveedor (esistente, nuovo creato con la compra, o nessuno), giorno (mai nel
    futuro, nel calendario della fioreria), nota o factura, e una riga per prodotto controllato con
    quantità e **totale pagato**. La quantità si scrive come al mercato: "100" o "4x25"
    (`parsePackQuantity`). Lo stesso prodotto in più righe si somma.
  - Ogni riga aggiorna il **costo reale** del prodotto, media ponderata con la merce che c'era
    (`averageCostAfterReceipt`). La riga conserva il totale esatto (`totalCostMinor`) e il costo
    per unità arrotondato.
  - "Anular compra" usa l'anulación del blocco 1: la merce esce e il costo medio torna com'era
    (`averageCostAfterRemoval`); se la merce comprata è già stata usata serve la conferma.
  - Proveedores: nome, telefono e nota; si archiviano, non si cancellano.
- **Costo previsto e reale:** la scheda del prodotto mostra il costo reale accanto a quello del
  catalogo, con la differenza in percentuale. "Usar este costo en el catálogo" porta il costo reale
  nel catalogo con un clic: il valore lo legge il server, serve anche `catalog:write`, e va
  nell'audit. Il catalogo non cambia mai da solo.
- **Il database garantisce:** `Supplier` con RLS e FK composite. Proveedor, factura e giorno
  esistono solo sulle compras, e una compra ha sempre il giorno. Il totale pagato esiste solo sulle
  righe di una compra e non è negativo.
- **Fuori:** resi al fornitore e lotti, per decisione del founder (ADR-060).

### ADR-062 — Inventario: apartados con vencimiento (blocco 3) — ADOTTATO (23/11/2026)

- **Cosa:** merce messa da parte per un evento o un cliente ("Boda de Ana") fino a una data (spec
  INV-01: "riserva temporanea configurabile, con timeout"). La durata si sceglie su ogni apartado:
  proposta fra 3 giorni, da oggi a 90 giorni al massimo.
- **Un apartado non cambia la giacenza:** toglie merce dal **disponibile** (`onHand − apartado`).
  Il disponibile decide stato e avvisi ("Por agotarse", "Agotado"), l'avviso degli usi e il controllo
  per gli ordini. Se la merce non basta: avviso e conferma, come per gli usi (ADR-060).
- **Scadenza senza job:**
  - un apartado vale fino alla fine del giorno di scadenza, nel calendario della fioreria;
  - il giorno dopo è "vencido" e non tiene più merce: lo stato si calcola alla lettura;
  - salvati sono solo ACTIVE, USED e RELEASED;
  - così non serve un cron (il piano Hobby di Vercel ne ha solo di giornalieri) e il risultato non
    dipende dall'ora in cui girerebbe.
- **Azioni** (proprietario e manager, `inventory:write`; tutti vedono gli apartados, senza costi):
  - "Usar": si scrive quanto si è usato davvero di ogni riga (proposta: quanto era apartado). La
    merce esce con un registro di uso che porta il nome dell'apartado. Ciò che non si usa resta in
    giacenza;
  - "Extender": nuova data, anche per un apartado vencido;
  - "Liberar": la merce torna disponibile.
  - Niente si cancella. Un apartado si usa o si libera una volta sola: la riga è bloccata
    (`FOR UPDATE`) e un test prova due "Usar" nello stesso istante.
- **Il database garantisce:**
  - `InventoryReservation` e `InventoryReservationLine` con RLS e FK composite su tenant, prodotto
    e registro di uso;
  - una riga per prodotto e quantità positive nei limiti;
  - chiuso se e solo se ha la data di chiusura;
  - il registro di uso solo su un apartado usato.
- **Per gli ordini (li collega l'altra sessione, senza toccarne il codice):**
  - `reserveStockTx(tx, ctx, { label, expiresOn, lines, confirmShortage })`, per prodotto del
    catalogo: ignora i prodotti non controllati e le fiorerie senza il piano (restituisce `null`);
  - `consumeReservationTx(tx, ctx, id, { lines?, confirmShortage })`: scarica quanto usato, anche
    prodotti fuori dall'apartado, e lo chiude;
  - `releaseReservationTx(tx, ctx, id)`: restituisce false se era già chiuso, così un annullamento
    ripetuto non sbaglia;
  - come `consumeStockTx`, non controllano i permessi dell'inventario: li controlla chi chiama;
  - un ordine con apartado va scaricato con `consumeReservationTx`, non con `consumeStockTx`, che
    conterebbe l'apartado dell'ordine stesso come merce non disponibile.
- **UI:**
  - scheda "Apartados" dell'inventario: vigentes, vencidos, cerrados, con la ricerca per "Para";
  - "Nuevo apartado", con disponibile e mancante mentre si scrive;
  - scheda dell'apartado con Usar, Extender e Liberar;
  - nella scheda del prodotto, gli apartados che valgono e il link "Apartar";
  - disponibile accanto alla giacenza nell'elenco e nel riquadro del catalogo;
  - le schede dell'inventario sono quattro: su telefono stanno in una griglia di due colonne.
- **Privacy:** "Para" e la nota possono contenere il nome del cliente, quindi restano fuori dai
  metadati dell'audit (prodotti, quantità e date sì).

### ADR-063 — Inventario: avvisi nel pannello, ramos e costo previsto e reale (blocco 4) — ADOTTATO (23/11/2026)

- **Avvisi nel pannello:** riquadro "Inventario" con i prodotti agotados e por agotarse,
  calcolati sul disponibile (ADR-062), i primi cinque da guardare, e gli apartados che scadono
  oggi o domani o sono già vencidos. Ogni riga porta alla pagina giusta. Senza il piano il riquadro
  non c'è.
- **Ramos del catálogo (spec INV-01: "avviso quando un ingrediente della ricetta non è
  sufficiente"):** nella scheda di un ramo con ricetta, il riquadro "Inventario" mostra:
  - quanti ramos si possono fare con la merce disponibile: il minimo fra gli ingredienti
    controllati (`bouquetsPossible`);
  - gli ingredienti non controllati non limitano e non si scaricano: chi compra a richiesta non
    vede numeri inventati; se non si controlla nessun ingrediente, lo dice;
  - per ogni ingrediente: quanto per ramo e quanto è disponibile.
- **Costo previsto e reale (spec INV-01):** per chi vede i costi, i materiali di un ramo ai costi
  del catalogo (previsto) e al costo medio delle compras (reale), con la differenza in percentuale
  (`bouquetMaterialCost`). Per un ingrediente senza costo medio il reale usa il costo del catalogo,
  e lo dice. Se un costo manca del tutto, nessun totale che sembri completo (come ADR-015).
- **"Registrar ramos hechos"** (proprietario e manager): la ricetta × N esce dall'inventario con un
  registro di uso ("3 × Ramo Clásico"), al costo medio del momento. Mentre si scrive si vede cosa
  manca; se non basta serve la conferma (ADR-060). Si annulla come ogni registro. È il consumo per
  chi vende ramos del catalogo al banco senza ordine. Gli ordini li collega l'altra sessione con
  `consumeStockTx` e `consumeReservationTx`.
- **Riepilogo del mese** (chi vede i costi), in testa ai Movimientos, con il mese precedente:
  - compras pagate (per giorno della compra);
  - usato al costo reale e ai costi del catalogo, cioè costo previsto e reale dell'intera fioreria;
  - mermas;
  - i registri annullati e le anulaciones non contano;
  - il mese è quello del calendario della fioreria (fuso orario in SQL).
- **Testi della pagina del piano** aggiornati: compras, apartados e quanti ramos alcanzan.

---

### ADR-064 — Conto del cliente del marketplace: dati per persona e accesso — ADOTTATO (23/11/2026)

Blocco C1 di `docs/ORDERS_MARKETPLACE_PLAN.md` (D-26: il cliente si registra prima di ordinare).

- **I dati di chi compra sono della persona, non di una fioreria.** Due tabelle di piattaforma:
  `BuyerProfile` (una riga per utente: telefono) e `BuyerAddress` (indirizzi di consegna con gli
  stessi campi e la stessa validazione della rubrica della fioreria, place ID e coordinate di
  Google Places come in ADR-059). Non hanno `tenantId`: **eccezione motivata** alla regola 4.1 di
  CLAUDE.md, che vale per i dati dei merchant.
- **Sicurezza:** RLS per utente, forzata, con la policy `user_isolation`
  (`"userId" = app_current_user_id()`, gemella di quella per tenant; funzione
  `app_enable_user_rls`). I servizi lavorano solo dentro `withUserContext` e filtrano comunque per
  `userId`. Il `BuyerContext` si costruisce **solo** dalla sessione (`getBuyerContext()` nel web),
  mai da un ID del browser; le server action di "Mi cuenta" passano da `runBuyerAction`, gemello di
  `runTenantAction`. Un indirizzo di un'altra persona risponde 404 come uno inesistente (senza la
  sonda fra tenant, che richiederebbe il contesto di sistema). Il test `rls.test.ts` controlla che
  ogni tabella per persona abbia la policy; una fioreria non vede nulla di queste tabelle.
- **Accesso:** un solo sistema di identità (Better Auth). Il conto cliente si apre la prima volta
  che la persona apre **"Mi cuenta"** (`/cuenta`); da lì un accesso senza fiorerie porta a
  `/cuenta` invece che alla creazione della fioreria (chi non l'ha aperto va ancora
  all'onboarding: i fioristi di oggi non cambiano strada). Login e registrazione con destinazione
  `/cuenta` parlano a chi compra; la destinazione resta fino alla verifica dell'email ("Revisa tu
  correo", "Reenviar"). Chi ha anche una fioreria la raggiunge da "Mi cuenta"; chi non ce l'ha
  vede come registrarla.
- **"Mi cuenta" nella V1 (C1):** nome ed email (quelli dell'accesso), telefono, indirizzi di
  consegna con "Buscar dirección". Gli ordini compaiono con C4, quando il cliente potrà farli:
  prima nessuna sezione che prometta qualcosa che non c'è.
- **Integrità:** telefono in E.164 (CHECK), al massimo un indirizzo predefinito attivo per persona
  (indice unico parziale), 20 indirizzi attivi. Le modifiche agli indirizzi della stessa persona
  passano una alla volta (blocco sul profilo, creato con `ON CONFLICT DO NOTHING`): due salvataggi
  contemporanei non creano due predefiniti. Gli indirizzi tolti si archiviano come quelli della
  rubrica della fioreria; la cancellazione del conto (diritti ARCO) arriva con le pagine legali (C5).
- **Coordinate:** la pulizia giornaliera di ADR-059 vale anche per `BuyerAddress`
  (`app_purge_place_coordinates()` ricreata con una colonna in più).
- **Niente registro di audit** per queste modifiche: sono dati della persona cambiati da lei
  stessa, e il registro di audit è per fioreria. Nei log solo ID.
- **Privacy (O-07, C5):** Gardelia è titolare dei dati del conto cliente; la fioreria lo sarà dei
  dati dell'ordine. Testo da validare con il legale insieme alle pagine per i consumatori.

### ADR-065 — "Mi tienda en línea": pagina pubblica della fioreria — ADOTTATO (23/11/2026)

Blocco C2 di `docs/ORDERS_MARKETPLACE_PLAN.md` (D-26). Avviato dal founder ("vai avanti con C2").

- **Cosa:** in Ajustes → **Tienda en línea** la fioreria scrive una presentazione, sceglie le forme
  di pagamento (transferencia, efectivo, tarjeta en tienda, link de pago) con i dati per pagare, e
  pubblica o ritira la pagina. Nel catalogo, su ramos, piante, fiori e accessori, l'interruttore
  **"Mostrar en mi tienda en línea"** (badge "En línea" nell'elenco). La pagina pubblica
  **`/f/<slug>`** mostra nome, zona, presentazione, prodotti con foto e prezzo, consegne (fasce,
  giorni chiusi, costo abituale, raggio, ritiro in tienda) e forme di pagamento; ogni prodotto ha la
  sua pagina con foto, descrizione, di cosa è fatto (dalla distinta, senza costi), colori e misure.
- **Niente ordini finti:** fino a C4 si contatta la fioreria con **"Pedir por WhatsApp"** (messaggio
  già scritto con nome, prezzo e link del prodotto) o "Llamar". Per questo pubblicare richiede il
  **telefono** della fioreria e **almeno un prodotto** visibile (controllo nel servizio; la pagina
  di impostazioni mostra cosa manca con il link per sistemarlo).
- **Accesso senza sessione (motivato):** lo slug non è firmato come i link di ADR-056, quindi non
  apre da solo un contesto di tenant. La funzione SQL `app_public_store_tenant(slug)` (SECURITY
  DEFINER, come le altre funzioni di piattaforma) restituisce l'ID della fioreria **solo** se la
  tienda è pubblicata e la fioreria attiva; poi i dati si leggono in `withTenantContext` con la RLS
  attiva, mai con `withSystemContext`. Il servizio (`core/src/public-store.ts`) espone solo campi
  pubblici: niente costi, codici, note, dati di clienti. Le foto si servono solo per prodotti
  visibili di una tienda pubblicata, con cache privata del browser.
- **Dati:** `OnlineStore` (una riga per fioreria, RLS per tenant; CHECK su lunghezze, forme di
  pagamento conosciute e data di pubblicazione) e `CatalogItem.isOnline` (CHECK: solo `BOUQUET`,
  `PLANT`, `CUT_FLOWER`, `ACCESSORY`; il dominio lo forza a falso per gli altri tipi). Audit:
  `store.updated` (solo i nomi dei campi cambiati: i dati bancari non vanno nel registro),
  `store.published`, `store.unpublished`. Permessi: impostazioni e pubblicazione per proprietario e
  manager (`tenant:settings:update`), l'interruttore del prodotto per chi modifica il catalogo.
- **Lingua:** la pagina è nella lingua del mercato della fioreria (es-MX in Messico), come i link
  pubblici. Una fioreria di prova mostra l'avviso "Florería de demostración".
- **Piano:** per ora in tutti i piani. **DA VALIDARE** dal founder se resta così o se una parte
  (es. più prodotti, dominio proprio) diventa di Plus.
- **Logo e copertina (C2b, 23/11/2026, "vai avanti con logo e foto della fioreria"):** in Tienda en
  línea si carica un logo (salvato piccolo, 480 px) e una foto di copertina (1600 px), con la stessa
  catena delle foto del catalogo (riduzione nel browser, controllo e conversione in JPEG sul server,
  file salvati prima della transazione). Si sostituiscono o si tolgono; i file sostituiti restano
  nell'archivio (nessuna cancellazione fisica). L'ID dell'immagine è nell'indirizzo
  (`/f/<slug>/imagen/logo|portada/<id>`): cambia a ogni sostituzione, quindi la cache del browser
  non mostra mai quella vecchia; si serve solo l'immagine attuale di una tienda pubblicata.
  Anteprima nelle impostazioni anche prima di pubblicare (rotta privata). La copertina (o il logo)
  è anche l'immagine dell'anteprima quando si condivide il link (Open Graph). Audit
  `store.image_set` / `store.image_removed` con il solo tipo.
- **Non fatto (prossimi passi):** ordine dal cliente con accettazione (C4); ricerca per indirizzo e home per chi compra (C3); opzioni del ramo (misura,
  colori di carta e nastro) che servono all'ordine; sitemap e anteprime per i social.

### ADR-066 — Home per chi compra e ricerca delle fiorerie — ADOTTATO (23/11/2026)

Blocco C3 di `docs/ORDERS_MARKETPLACE_PLAN.md` (D-26). Avviato dal founder ("vai avanti con C3").

- **`/` è la home di chi compra fiori:** "¿A dónde enviamos tus flores?", come funziona (scegli dove,
  scegli una florería, pidi per WhatsApp: niente ordini online finti fino a C4) e il rimando per i
  fioristi. La presentazione del gestionale si sposta, uguale, su **`/floristas`** (registrazione e
  accesso dei fioristi invariati; dall'app si esce sempre verso il login).
- **Come si cerca:**
  - **per città, per tutti:** l'elenco delle città con almeno una tienda pubblicata. Non chiama Google,
    quindi non costa nulla anche con visitatori anonimi o bot;
  - **per indirizzo, solo con l'accesso:** "Buscar dirección" con Google Places (le rotte di Places
    restano solo per chi ha una sessione, ADR-059: la ricerca anonima esporrebbe la spesa) e gli
    indirizzi salvati in "Mi cuenta" (`/buscar?direccion=<id>`, letti solo per la persona).
- **Risultati (`/buscar`):** prima le tiendas che arrivano all'indirizzo (coordinate valide della sede
  e dell'indirizzo, dentro il raggio di consegna della fioreria), dalla più vicina con la distanza;
  poi quelle della stessa città di cui non si conosce la posizione, con l'invito a chiedere per
  WhatsApp. Solo tiendas pubblicate con almeno un prodotto visibile. **Raggio predefinito 10 km**
  quando la fioreria non l'ha indicato (PROPOSTO, si cambia in `DEFAULT_DELIVERY_RADIUS_KM`).
- **Dati:** la funzione SQL `app_public_store_directory()` (SECURITY DEFINER come
  `app_public_store_tenant`) elenca le tiendas pubblicate di fiorerie attive con i soli dati
  pubblici (nome, zona, città, coordinate, raggio, logo, numero di prodotti). Le regole su distanza,
  raggio e città sono pure nel dominio (`store-search.ts`).
- **Coordinate delle tiendas:** Google permette di tenerle 30 giorni (ADR-059). La manutenzione
  giornaliera le richiede di nuovo dal place ID salvato per le tiendas pubblicate quando hanno più
  di 25 giorni (al massimo 50 al giorno, una "Place Details" ciascuna, circa una al mese per tienda),
  così la ricerca per distanza non si spegne dopo un mese. Senza chiave non fa nulla.
- **Non fatto:** "prima fascia disponibile" nell'ordine dei risultati; mappa; occasioni (cumpleaños,
  10 de mayo) come filtri, che richiedono di classificare i prodotti; attribuzione della fee (D-24)
  dalla ricerca, che si registra con l'ordine (C4).

### ADR-067 — Ordine del cliente dalla tienda en línea: accettazione, email e scadenza — ADOTTATO (23/11/2026)

Blocco C4 di `docs/ORDERS_MARKETPLACE_PLAN.md` (D-26). Avviato dal founder ("ok vai avanti con C4").

- **Chi può ordinare:** chi ha un conto (sessione verificata, ADR-064) da una tienda pubblicata con
  **"Recibir pedidos en línea"** acceso. Gli ordini online sono un interruttore a parte nella tienda,
  spento di partenza: per accenderlo servono almeno una forma di pagamento e il telefono. Con gli
  ordini accesi non si tolgono tutte le forme di pagamento. **Anticipo minimo** scelto dalla fioreria
  (0–14 giorni, predefinito 1).
- **Contesto ristretto, mai di sistema:** chi compra non è membro della fioreria. Lo slug diventa una
  fioreria solo con la funzione `app_public_store_tenant` (tienda pubblicata), poi tutto avviene in
  `withTenantContext({ tenantId, userId: <chi compra> })` con la RLS attiva: le tabelle della
  fioreria per quel solo tenant, e — perché `app.user_id` è chi compra — anche i SUOI indirizzi
  salvati (RLS per utente). Nessun `withSystemContext` dal web.
- **Il modulo (`/f/<slug>/pedido`)** è a passi (prodotti → consegna → tarjeta e commenti → riepilogo
  e telefono), nella lingua del mercato della fioreria come la sua pagina. Manda solo ID e quantità:
  **prezzi, costo di consegna e totali li decide il server** dal catalogo (righe con lo stesso
  snapshot degli ordini del banco) e dal costo di consegna predefinito della fioreria (0 = "lo
  confirma la florería", il totale si mostra "sin envío"). Regole del giorno: anticipo, al massimo 60
  giorni, e **i giorni di chiusura bloccano** (al banco sono solo un avviso: online nessuno decide);
  la fascia deve essere una di quelle della fioreria, o "a cualquier hora".
- **L'ordine nasce "Por aceptar" (`PENDING_ACCEPTANCE`)** con `placedOnline` e `buyerUserId`, un
  link di tracciamento (ADR-056) e i commenti di chi compra (`buyerNotes`). Il cliente entra nel CRM
  della fioreria: si collega a quello attivo con la stessa email, altrimenti se ne crea uno (senza
  consenso alle promozioni). Il telefono resta nel profilo di chi compra; "Guardar esta dirección"
  salva l'indirizzo nuovo in "Mi cuenta". Limite: **3 ordini in attesa per persona e fioreria**
  (contro lo spam), con un lock per persona e fioreria contro gli invii contemporanei.
- **La fioreria risponde:** "Aceptar pedido" (proprietari e gerenti, `orders:write`) è un'azione a
  parte, non un passo del banco: conferma e scrive a chi compra il totale e **come pagare** (forme e
  dati della tienda; il pagamento resta diretto, D-26). Prima di accettare si possono cambiare
  prodotti, data e costo di consegna d'accordo con il cliente; un ordine col giorno già passato non
  si accetta. **"Rechazar"** è l'annullamento con un motivo che chi compra legge (email e pagina);
  annullare dopo averlo accettato avvisa allo stesso modo. Avviso "Tienes N pedidos en línea por
  aceptar" e filtro "Por aceptar" in Pedidos, email ai proprietari e gerenti a ogni ordine.
- **Scadenza (PROPOSTO):** un ordine che nessuno accetta in **3 giorni**, o il cui giorno passa, si
  annulla da solo nella manutenzione giornaliera e chi compra lo sa per email. La funzione SQL
  `app_pending_orders_to_expire` sceglie solo gli ID; l'annullamento avviene nel contesto di ogni
  fioreria, ricontrollando le condizioni sotto lock. Il motivo scritto è un testo fisso nella lingua
  del mercato.
- **Email** (es-MX, lingua del mercato): "Recibimos tu pedido", "Nuevo pedido en línea" (alla
  fioreria), "aceptó tu pedido", "no puede atender / fue cancelado". Mittente col nome della fioreria
  e risposta al suo contatto; l'invio avviene dopo il commit e non fa mai fallire l'operazione.
- **"Mis pedidos"** in "Mi cuenta": la funzione `app_buyer_orders()` (SECURITY DEFINER) restituisce
  gli ordini di `app.user_id` in tutte le fiorerie, con i soli dati che chi compra vede già nel suo
  link; l'utente non è mai un parametro.
- **Attribuzione (D-24):** dalla ricerca (`/buscar`) le tiendas si aprono passando da
  `/buscar/ir/<slug>`, che ricorda lo slug in un cookie per **30 giorni** (PROPOSTO; la finestra
  definitiva è O-10). L'ordine è `MARKETPLACE_B2C` se chi compra è arrivato così **e** non era già un
  cliente della fioreria (sui clienti propri nessuna fee); altrimenti `MERCHANT_DIRECT`. La fee non
  si incassa ancora.
- **DA VALIDARE:** termini per i consumatori e aviso de privacidad di chi compra (C5); se il cookie
  dell'attribuzione va citato nell'aviso; i 3 giorni per accettare e il limite di 3 ordini in attesa.
- **Non fatto:** il cliente che annulla da solo un ordine in attesa (oggi scrive alla fioreria);
  costo di consegna per distanza; consumo dell'inventario dagli ordini; email a ogni cambio di stato
  dopo l'accettazione (lo stato si vede nel link).
- **Nota (26/11, ADR-088):** le email dei passi dopo l'accettazione, i messaggi e l'annullamento da
  «Mis pedidos» ci sono ora (M3-1; l'annullamento da ADR-072). Prima di accettare, oggi i prodotti
  NON si cambiano (M0 ha corretto il testo del pannello): lo diventa con M3-2 («Cambi da
  confermare»).

### ADR-068 — Documenti legali nell'app e diritti di chi compra (scaricare i dati, eliminare il conto) — ADOTTATO (23/11/2026)

Blocco C5 di `docs/ORDERS_MARKETPLACE_PLAN.md` (D-26). Avviato dal founder ("ok vai avanti con C5").

- **Nessun testo legale definitivo inventato** (CLAUDE.md §2): le bozze di `docs/legal/` restano
  bozze. Aggiornati l'aviso de privacidad (chi compra: dati del conto, degli ordini e di chi riceve,
  condivisione con la fioreria, cookie dell'attribuzione, scarico e cancellazione dalla app) e scritti
  i **termini per chi compra** (Gardelia mette in contatto, la vendita e il pagamento sono con la
  fioreria; ordine come richiesta che la fioreria accetta; 3 giorni; foto illustrative). Ogni regola
  di legge che non conosciamo è un segnaposto `[validar]`; le domande per l'avvocato sono in
  `docs/legal/README.md` (12–17).
- **Pagine `/privacidad`, `/terminos` (fiorerie) e `/terminos/compradores`** mostrano i testi così
  come sono, con il riquadro "BORRADOR" ben visibile: servono a founder e avvocato per rivederli nel
  contesto su staging. **Non vanno in produzione come definitivi senza la revisione** (rilascio su
  `prod` solo col via libera del founder, ADR-041). I testi sono in spagnolo (lingua del mercato); chi
  usa l'app in un'altra lingua lo legge in cima.
- **Un solo testo, nessun file letto a runtime:** `pnpm --filter @floral/web legal:sync` copia i
  `.md` in `apps/web/src/content/legal.generated.ts`; un test fallisce se divergono. Il markdown
  diventa elementi React dai token di `marked` (nuova dipendenza, versione fissa): nessun HTML
  iniettato, i collegamenti fra documenti portano alle pagine dell'app.
- **Accettazione:** "Al crear tu cuenta aceptas los Términos y el Aviso de privacidad" in
  registrazione (vale anche per Google; per chi arriva da "Mi cuenta" o dal pedido, i termini per chi
  compra) e "Al enviar el pedido aceptas…" nell'ultimo passo del pedido; con ogni ordine online si
  registra `LEGAL_VERSION`. Tolto il vecchio avviso "i testi definitivi arriveranno". Caselle da
  spuntare solo se l'avvocato le chiede. Link ai documenti in fondo a home, ricerca, `/floristas`,
  tienda, "Mi cuenta" e pagina degli ordini online.
- **Diritti di chi compra in "Mi cuenta":**
  - **"Descargar mis datos":** un JSON con conto, telefono, indirizzi (anche quelli tolti) e ordini
    (fioreria, numero, stato, data, totale). Solo dalla sessione (`/cuenta/datos`), RLS per utente;
    niente ID interni.
  - **"Eliminar mi cuenta"** con Better Auth (`deleteUser`): il pulsante manda un'**email di
    conferma** (vale anche per chi entra con Google, senza password); il link porta a
    `/cuenta/eliminar` (con l'accesso) e un ultimo clic cancella. **Non si può** se la persona fa
    parte di una fioreria (il conto regge dati della fioreria: per ora non dall'app), se è
    amministratrice della piattaforma o se ha **ordini in corso** (la fioreria deve poterla
    avvisare): la pagina lo spiega e il controllo si ripete subito prima di cancellare.
  - **Cosa si cancella:** l'utente con sessioni, accessi, profilo e indirizzi (cascata; i dati di chi
    compra sono personali, non commerciali: eccezione motivata alla regola "nessuna cancellazione
    fisica"). Gli **ordini restano** alle fiorerie (responsabili dei dati dell'ordine e del loro
    CRM) con `buyerUserId` a NULL; nel registro di piattaforma resta l'evento con il solo ID.
- **Non fatto:** esportazione e cancellazione per le fiorerie (servono regole sui dati del negozio e
  sugli obblighi fiscali); caselle di consenso; testi definitivi.

### ADR-069 — Costo di consegna per distanza a fasce di km — ADOTTATO (23/11/2026)

Completa il blocco A2 di `docs/ORDERS_MARKETPLACE_PLAN.md` (O-14 → Google Places, ADR-059). Avviato
dal founder ("vai avanti con il costo di consegna per distanza").

- **Fasce:** in Ajustes → Entregas, "Costo de envío por distancia": fino a 8 fasce "hasta X km →
  $Y" (da 0,1 a 100 km, un decimale; costo anche 0 = gratis). Tabella `DeliveryFeeTier` (metri
  interi, RLS, CHECK sui limiti, una fascia per distanza). Il costo abituale resta e vale quando la
  distanza non si conosce.
- **Distanza in linea retta** fra la posizione della tienda principale e quella dell'indirizzo
  (coordinate di Google, valide 30 giorni). Nessuna chiamata in più a Google (le Routes API costano:
  la distanza su strada è un'evoluzione possibile). La pagina lo dice ("en línea recta").
- **Regola unica (dominio, `quoteDeliveryFee`):** la prima fascia che arriva fin lì; oltre
  l'ultima = **fuori zona**; senza fasce, senza la posizione della tienda o dell'indirizzo = costo
  abituale. Mai un calcolo con coordinate scadute.
- **Ordini online (ADR-067):** il server applica la fascia; un indirizzo fuori zona non si può
  ordinare a domicilio (si può ritirare). Il modulo riceve fasce e posizione della tienda e mostra
  lo stesso calcolo uscendo dal passo "Entrega" ("Envío $80 · a 2 km"; "Sin costo" se la fascia è
  0; "lo confirma la florería" se non si sa). La pagina della tienda elenca le fasce.
- **Al banco:** "Calcular por distancia" accanto al costo di consegna (indirizzo salvato con
  posizione, o nuovo scelto con "Buscar dirección") propone il costo della fascia, che si può sempre
  cambiare; fuori zona lo dice e lascia scrivere a mano. Il pulsante c'è solo con fasce e posizione
  della tienda.
- **Coordinate della tienda sempre fresche:** la manutenzione le richiede a Google non più solo per
  le tiendas pubblicate (ADR-066) ma anche per le fiorerie con fasce di distanza
  (`app_store_places_to_refresh` sostituita). Senza Google o senza la sede scelta con "Buscar
  dirección", le impostazioni lo spiegano e vale il costo abituale.
- **Non fatto:** distanza su strada; il raggio della ricerca (`deliveryRadiusKm`) resta separato
  dall'ultima fascia.

### ADR-070 — Clienti completi: cronologia, etichette e filtri, import da CSV — ADOTTATO (23/11/2026)

Numerata 070: 066 è già la home per chi compra e 067–069 restano ai blocchi del marketplace
(C4, C5), che lavora in parallelo.

- **Decisioni del founder (23/11/2026)** per l'import da CSV (blocco 3):
  - i clienti importati entrano **senza** consenso marketing, che si segna a mano, uno per uno,
    con la fonte. Un "sí" in un file non dimostra il consenso (LFPDPPP), da confermare con
    l'avvocato insieme all'aviso de privacidad (O-07);
  - l'import è in tutti i piani;
  - importano proprietario e manager (`customers:write`).
- **Blocco 1, cronologia** (spec CRM-01: "Timeline cronologica di ordini, preventivi, consegne,
  subscriptions, messaggi e interventi"):
  - sezione "Historial" nella scheda del cliente, dalla più recente: cliente registrato, preventivo
    creato e suo stato attuale, ordine creato (con lo stato in cui nasce), confermato, consegnato o
    ritirato, annullato (col motivo), pagamenti e loro anulaciones, promozione inviata e codice usato;
  - ogni evento ha il link al suo preventivo o ordine;
  - preparazione, pronto e in viaggio restano nella scheda dell'ordine, per non riempire la storia;
  - del preventivo si mostra l'ultimo cambio di stato: non c'è uno storico degli stati;
  - solo lettura (`customer-timeline.ts`): legge le tabelle di preventivi, ordini, pagamenti e
    promozioni senza toccarne il codice. Le fonti che il ruolo non vede non compaiono;
  - "Ver más" allarga la pagina di 20 in 20 fino a 200 (`?historial=`). Ogni fonte dà al massimo
    quel numero di eventi, poi si uniscono e si taglia: nessun cursore che salti eventi con lo
    stesso istante;
  - abbonamenti e interventi entreranno con SUB-01 e CARE-01.
- **Blocco 2, etichette e filtri** (spec CRM-01: "Segmenti: … tags", "consenso marketing"):
  - filtri della lista clienti: etichetta (l'elenco delle etichette già usate dalla fioreria),
    consenso alle promozioni (sì/no) e "Fecha especial en 30 días" (una data speciale da oggi a 30
    giorni, contata come il pannello: il 29 febbraio vale il 28 negli anni non bisestili). Si
    sommano a ricerca, tipo e stato e restano nell'indirizzo, come gli altri filtri;
  - la data vicina si filtra nel database: dal fuso della fioreria si ricavano i giorni del
    calendario della finestra (`upcomingMonthDays`) e si cercano le date speciali con quel mese e
    giorno, senza caricare tutte le date in memoria;
  - **etichetta a più clienti**: caselle nelle righe, "Seleccionar todos" della pagina, etichetta con
    i suggerimenti di quelle usate, "Agregar etiqueta" o "Quitar etiqueta" (al massimo 100 clienti
    per volta). Solo proprietario e manager (`customers:write`), come la scheda;
  - un cliente con già 15 etichette viene saltato e contato nel messaggio (come avviso), gli altri
    la ricevono; chi l'aveva già, o non l'aveva, è contato a parte;
  - un ID di un'altra fioreria nel gruppo: 404 per tutto il gruppo, nessuna modifica, evento di
    sicurezza;
  - nel registro **una voce per gruppo** (`customer.tags_added` / `customer.tags_removed`) con
    quanti e quali clienti (ID), mai il testo dell'etichetta, come per le modifiche della scheda.
  - **Correzione trovata strada facendo:** le voci di "Actividad reciente" della dashboard
    (clienti, catalogo, preventivi, ordini…) avevano chiavi col punto (`"customer.created"`) che
    next-intl legge come annidamento: non si trovavano mai e compariva sempre "realizó un cambio".
    Ora sono annidate per modulo; un test controlla che nessuna chiave abbia un punto e che ogni
    azione di una fioreria abbia il suo testo nelle tre lingue.
- **Blocco 3, import da CSV** (spec CRM-01: "import da CSV con validazione e anteprima"):
  - "Importar" nella lista clienti, per proprietario e manager in tutti i piani: come preparare il
    file, modello da scaricare con le intestazioni nella lingua di chi lo usa (nessuna riga
    d'esempio: dimenticata nel file diventerebbe un cliente vero), caricamento;
  - lettura tollerante: separatore riconosciuto (virgola, punto e virgola, tabulazione), virgolette
    e a capo nelle celle, UTF-8 o Windows-1252 (Excel in spagnolo); fino a 1000 clienti e 512 KB;
  - colonne riconosciute dal nome nelle tre lingue (senza accenti né maiuscole) e correggibili a
    mano; il nome è obbligatorio e ogni dato viene da una sola colonna; compleanno e aniversario
    diventano date speciali (giorno prima del mese: 14/02, 14/02/1990, oppure 1990-02-14);
  - anteprima: righe pronte, con errori (campo per campo, come nel modulo "Nuevo cliente") e
    duplicate (telefono o email di un cliente già presente, anche archiviato, o di una riga più su
    nel file); le prime 100 con problemi, con il numero di riga del foglio, e qualche esempio;
  - "Importar N clientes" ricontrolla tutto nella stessa transazione (bloccata contro il doppio
    clic) e salva le righe pronte con origine IMPORT e **senza consenso marketing**, come deciso
    dal founder; una voce di audit con i soli conti;
  - la bozza (tabella `CustomerImport`, con RLS) tiene il testo del file solo finché non si importa
    o si annulla, poi si svuota (vincolo nel database). Una nuova bozza chiude quelle aperte della
    stessa persona; la manutenzione giornaliera chiude in tutte le fiorerie quelle dimenticate da
    più di un giorno e ne cancella il file (`app_close_stale_customer_imports`).

### ADR-071 — Scarico dell'inventario dagli ordini — ADOTTATO (23/11/2026)

Collega gli ordini (ADR-054) all'inventario (ADR-060…063) con le funzioni preparate dall'altra
sessione, senza toccarne il codice. Avviato dal founder ("vai avanti con lo scarico dell'inventario
dagli ordini").

- **Quando:** i materiali escono quando l'ordine diventa **"Listo"** per la prima volta (il ramo è
  fatto), nella stessa transazione del cambio di stato, con `consumeStockTx` e un registro di uso
  che ha come nota il numero dell'ordine (`PED-0042`). L'ordine conserva il registro
  (`Order.inventoryEntryId`, FK composita, unico): tornare indietro e di nuovo "Listo" non scarica una
  seconda volta. Prima di "Listo" non esce nulla: l'ordine si può ancora cambiare.
- **Cosa:** i prodotti del catalogo venduti come tali (tallos, vasi, piante…) per la quantità; i
  ramos del catalogo con **la ricetta concordata** (da questa versione lo snapshot della riga porta
  l'ID di ogni ingrediente; per le righe nate prima vale la ricetta attuale del ramo); i componenti
  dei disegni del Diseñador. Le righe libere no. Senza il piano dell'inventario, o per i prodotti non
  controllati, non succede nulla e "Listo" funziona come sempre.
- **Se la merce non basta** (giacenza meno apartados): serve la conferma, come negli usi
  dell'inventario (ADR-060). Nella scheda dell'ordine l'avviso nel riquadro "Avance" dice cosa manca
  e il pulsante diventa "Marcar listo aunque falte" (campo nascosto `confirmShortage`): la giacenza
  scende sotto zero finché non si registra la compra o un conteggio. Da "Hoy salen" e dalla Ruta,
  che non mostrano l'inventario, il cambio si ferma con `order_inventory_shortage`: il messaggio dice
  di aprire la scheda dell'ordine. Quantità fuori dai limiti dell'inventario (un ordine enorme): lo
  stato cambia lo stesso, nulla si scarica e il server lo registra nel log; il banco non si blocca mai.
- **Riquadro "Inventario"** nella scheda dell'ordine (solo con il piano e se l'ordine tocca prodotti
  controllati; per tutti i ruoli, senza costi): prima di "Listo" i prodotti con la quantità e il
  disponibile o quanto manca; dopo, quando sono stati scaricati e il link ai movimenti. Se una parte
  è apartada lo dice: un apartado fatto a mano per l'ordine va **liberato**, non usato, perché
  l'ordine scarica già (altrimenti la merce uscirebbe due volte).
- **Annullare dopo lo scarico** non restituisce la merce da solo: se i materiali non sono stati
  usati, il proprietario o il manager annullano il movimento in Inventario (la scheda lo spiega). Un
  movimento annullato resta legato all'ordine, che non scarica di nuovo e lo dice.
- **Permessi:** chi può far avanzare l'ordine (anche lo staff) fa uscire i materiali con quel passo:
  i permessi dell'inventario non servono, come previsto da `consumeStockTx`.
- **Non fatto:** scarico parziale o diverso dalla ricetta, restituzione automatica
  all'annullamento. Gli apartados creati dagli ordini confermati sono in ADR-072.

### ADR-072 — Resti degli ordini: annullamento di chi compra, conferma al cliente del banco, apartados dagli ordini — ADOTTATO (24/11/2026)

Avviato dal founder ("si vai col punto 1": i resti degli ordini della lista per la V1).

- **Chi compra annulla da solo** un ordine online ancora "Por aceptar" (ADR-067), da "Mi cuenta",
  con conferma:
  - solo i propri e solo prima dell'accettazione: dopo risponde `order_not_pending` (un ordine
    accettato si annulla parlando con la fioreria); l'ordine di un altro conto risponde 404;
  - l'ordine diventa "Cancelado" con un motivo fisso nella lingua del mercato
    (`MARKETPLACE_WITHDRAWN_REASON`) e la riga nella cronologia; nell'audit l'attore è chi compra
    (`order.cancelled_by_buyer`), senza dati personali;
  - email a chi compra ("Cancelaste tu pedido") e a proprietari e manager ("canceló el pedido"),
    inviate dopo il commit: un SMTP giù non blocca l'annullamento;
  - la fioreria dell'ordine si trova con `app_buyer_orders()` (RLS per persona, ADR-064), poi
    tutto avviene nel contesto di quella fioreria con la riga bloccata (`FOR UPDATE`): due clic
    insieme non annullano due volte.
- **Conferma per email al cliente degli ordini del banco:**
  - quando un ordine del banco diventa confermato ("Convertir en pedido" o "Confirmar pedido" di un
    borrador) il modulo mostra la casella "Enviar la confirmación del pedido a …", già spuntata;
  - se il cliente non ha email il modulo lo dice (e suggerisce il link per WhatsApp); da una
    fioreria demo non parte mai nulla (ADR-016) e il modulo lo dice;
  - l'email è in es-MX, con il nome della fioreria come mittente e la risposta alla sua email di
    contatto: numero, ritiro o consegna con giorno e fascia, totale e il link "Ver mi pedido",
    quello di "Compartir enlace" se è attivo, altrimenti uno nuovo (audit `public_link.created`);
  - niente istruzioni di pagamento: alla conferma non c'è ancora nessun pagamento registrato e al
    banco spesso si paga in negozio;
  - l'audit della conferma ricorda `customerNotified: true` (senza l'indirizzo); l'invio avviene
    dopo il commit. Regola pura `counterConfirmationRecipient`; senza la casella (test, script)
    non parte nulla;
  - non fatto: il preventivo per email e il reinvio della conferma.
- **Apartados dagli ordini confermati** (il "non fatto" di ADR-071, con le funzioni di ADR-062):
  - un ordine confermato o in preparazione con prodotti controllati ha un apartado con i suoi
    materiali, gli stessi che usciranno a "Listo". Si chiama con il numero dell'ordine (niente dati
    del cliente nell'inventario) ed è legato all'ordine: `Order.inventoryReservationId`, FK
    composita, unico, RESTRICT;
  - **tiene la merce solo negli ultimi 7 giorni prima della consegna** (`ORDER_HOLD_DAYS`):
    PROPOSTO, da validare con le fiorerie di prova. Nuova colonna `InventoryReservation.holdsFrom`
    (CHECK: non dopo `expiresOn`); il disponibile conta solo gli apartados già cominciati. Così un
    ordine preso con settimane o mesi di anticipo (San Valentino a gennaio) non blocca la merce
    fresca di oggi. Vale fino al giorno della consegna incluso;
  - il servizio degli ordini lo tiene allineato (`syncOrderReservationTx`) nella stessa
    transazione di ogni cambio: conferma (banco, preventivo, accettazione online), righe e quantità,
    giorno. Si aggiorna sul posto (audit `inventory.reservation_updated`) invece di chiuderne uno e
    aprirne un altro;
  - a "Listo" i materiali escono **dall'apartado** (`consumeReservationTx`, con le quantità attuali
    dell'ordine): un solo movimento, con il numero dell'ordine nella nota come prima; l'apartado
    diventa "Usado";
  - annullare l'ordine libera la merce. Non tiene nulla neanche un ordine senza più prodotti
    controllati o con il giorno passato;
  - un ordine non si blocca mai per l'inventario: se la merce non basta l'apartado si fa lo stesso
    (disponibile sotto zero, avvisi, "Faltan" nella scheda dell'ordine); fuori dai limiti
    dell'inventario l'ordine va avanti senza apartado e il server lo scrive nel log;
  - nella scheda "Inventario" dell'ordine la sua merce è sua (il disponibile non conta il suo
    apartado) e una riga dice da quando o fino a quando è apartada;
  - fra gli apartados, quello di un ordine dice di quale ordine e cliente è, con il link. Usar,
    Extender e Liberar non valgono per lui (`inventory_reservation_order`): lo governa l'ordine. La
    scheda "Vencidos" e gli avvisi del pannello contano solo quelli fatti a mano: un ordine in
    ritardo lo chiude l'ordine stesso;
  - un apartado fatto a mano per un ordine prima di questa versione va liberato: la scheda
    dell'ordine lo ricorda. Gli ordini confermati prima di questa versione prendono il loro
    apartado al primo cambio (righe, giorno, stato); se non cambiano, a "Listo" scaricano come
    prima. La ricerca fra gli apartados trova quelli degli ordini anche per il nome del cliente.

### ADR-073 — Il dominio gardelia.co: indirizzi ed email — ADOTTATO (24/11/2026)

Il founder ha comprato `gardelia.co` su Cloudflare e ha chiesto di aggiornare tutto quello che serve
("aggiorna tutto quello che devo aggiornare. mail ecc"). Passi per lui in `docs/DEPLOY_VERCEL.md` §12.

- **Indirizzi:** `staging.gardelia.co` per l'ambiente di prova (progetto `gardelia-staging`).
  `gardelia.co` e `www.gardelia.co` restano per la produzione (progetto `gardelia-production`,
  ramo `prod`, ADR-041) e **non puntano a staging**: chi arriva penserebbe che sia il prodotto (D-22).
  Il vecchio `gardelia-staging.vercel.app` rimanda al nuovo.
- **Email in uscita:** Resend con il dominio `gardelia.co` verificato (SPF e return-path su
  `send.gardelia.co`, DKIM, DMARC `p=none` per cominciare). Mittente `Gardelia
<no-reply@gardelia.co>`. Così le email partono a tutti, non solo al titolare dell'account
  Resend.
- **Email in arrivo:** Cloudflare Email Routing (gratis) inoltra `soporte@gardelia.co` e
  `privacidad@gardelia.co` alla casella del founder. Sono gli indirizzi dei testi legali (bozze
  aggiornate, sempre da rivedere con l'avvocato, O-07).
- **Codice:** nessun indirizzo scritto nel codice. App e link pubblici usano `APP_URL`, il mittente
  `EMAIL_FROM`. La funzione che svuota la coda AI segue il dominio di produzione del progetto,
  quello che Vercel indica.
- **Sicurezza:** verifica in due passaggi sull'account Cloudflare e rinnovo automatico del dominio.
- **Fatto dal founder il 24/11/2026:**
  - Resend verificato con la configurazione automatica su Cloudflare;
  - DMARC con il DMARC Management di Cloudflare (`p=none`, rapporti su Cloudflare);
  - `staging.gardelia.co` attivo su Vercel; `gardelia.vercel.app` e `gardelia-staging.vercel.app`
    rimandano lì;
  - variabili `APP_URL`, `BETTER_AUTH_URL` ed `EMAIL_FROM` aggiornate.

### ADR-074 — Eliminare una fioreria: subito invisibile, cancellata dopo 30 giorni — ADOTTATO (24/11/2026)

Chiesto dal founder ("dobbiamo implementare nelle impostazioni una sezione dedicata alla
eliminazione"); scelta sua la cancellazione **definitiva dopo 30 giorni** ("ok cancella dopo 30
giorni"). È un'eccezione voluta alla regola "nessuna cancellazione fisica di dati commerciali"
(CLAUDE.md §5): quando chi possiede i dati chiude, non teniamo una copia del suo negozio.

- **Chi e come:** solo il titolare (`tenant:delete`, OWNER), da "Ajustes → Zona de peligro →
  Eliminar florería…". La pagina dice cosa succede e quando; si conferma **scrivendo il nome della
  fioreria** (maiuscole, accenti e spazi non contano). Il controllo si ripete nel servizio.
- **Cosa la blocca:** gli **ordini in corso** (da aceptar, confirmado, en preparación, listo, en
  camino): chi ha ordinato aspetta i fiori. Borradores, consegnati, ritirati e annullati non bloccano.
  Il controllo è nella stessa transazione che archivia, con la riga della fioreria bloccata.
- **Subito:** la fioreria diventa `ARCHIVED` con `deletionRequestedAt`, `deletionRequestedById` e
  `deleteAfter` (+30 giorni; un vincolo CHECK li tiene insieme). Da quel momento nessuno la apre (404
  per squadra e titolare), la tienda en línea si spegne (`isPublished` e `ordersEnabled` a false), i
  link pubblici di ordini e preventivi smettono di funzionare. Audit `tenant.deletion_requested`. Ogni
  titolare riceve un'email con la data e il link per recuperarla; un'email non partita non annulla
  l'eliminazione.
- **Per 30 giorni:** il titolare la vede nella scelta della fioreria (`/app`, "Florerías en
  eliminación") e la **recupera** con un clic: torna com'era, con la squadra; la tienda resta spenta e
  si riaccende dalle impostazioni. Il manager e gli altri non la vedono. Audit
  `tenant.deletion_cancelled`.
- **Dopo 30 giorni:** la manutenzione giornaliera (`purgeDeletedTenants`, 20 per giro) cancella prima
  i **file** dall'archivio (foto del catalogo con i ritagli, dei ramos, di stile, prove di consegna,
  anteprime AI, logo e copertina), poi la fioreria con **tutti i suoi dati** (cascata nel database,
  funzione `app_purge_tenant`, che ricontrolla la data). Se l'archivio dei file non risponde la fioreria
  resta e si riprova il giorno dopo: nessun file senza padrone. Resta solo l'evento di piattaforma
  `platform.tenant_purged` con l'ID della fioreria, l'ID di chi l'ha chiesta, la data della richiesta
  e il numero di file (niente nomi né dati dei clienti).
- **I conti delle persone restano:** si entra e si crea un'altra fioreria. Chi aveva comprato online
  da quella fioreria non vede più quegli ordini in "Mis pedidos" (link e tienda non si aprono più;
  tornano se la fioreria si recupera); "Descargar mis datos" li include finché esistono.
- **Da validare `[validar]`:** con il contador e l'avvocato, se la fioreria o Gardelia devono
  conservare qualcosa (ordini, pagamenti registrati) per obblighi fiscali o per reclami, e per quanto
  (domanda 18 in `docs/legal/README.md`). Se servisse, la cancellazione diventerebbe
  un'anonimizzazione di quella parte, senza cambiare il flusso.
- **Non fatto:** l'**esportazione dei dati della fioreria** prima di eliminarla (V1 §2.15); finché
  manca, la pagina non promette nulla di simile.

### ADR-075 — Floral Care, blocco 1: offerta, fasce, contratti, visite e Agenda — ADOTTATO (24/11/2026)

Avviato dal founder con la visione del 24/11 ("l'offerta floral care deve essere configurabile",
"pensala bene nel profondo") e il piano approvato, ora in `docs/FLORAL_CARE_PLAN.md` (blocchi
1–7). Questo è il blocco 1.

- **Prezzo (DECISO dal founder):**
  - tariffa per uscita + cura per pianta secondo la misura (chica, mediana, grande) + servizi
    extra, per visita, per pianta o una volta sola. Il cliente sceglie la frequenza e il canone si
    calcola da solo (`priceCareVisit`, `estimateCareMonth`);
  - lo calcola **solo il server**, alla conferma, e si copia nel contratto (versione del prezzo).
    "Actualizar precio" lo rifà con piante, servizi e tariffe di oggi: nuova versione, con la
    casella dell'avviso. I servizi del contratto copiano nome e prezzo;
  - sovrapprezzo per distanza con fasce proprie di Floral Care, in linea retta dalla tienda. La
    distanza si salva nel contratto, perché le coordinate dei clienti scadono dopo 30 giorni
    (ADR-059);
  - fuori dal raggio il contratto si fa solo con la casella "voy de todos modos", e vale l'ultima
    fascia. Distanza sconosciuta: niente sovrapprezzo, e la scheda lo dice.
- **Frequenze (PROPOSTO):** 1 o 2 volte al mese in giorni fissi (1º; 1º e 3º giorno della settimana
  scelto), oppure ogni settimana in 1–3 giorni diversi.
- **Fasce e capienza:**
  - fasce per giorno della settimana con i posti; un contratto grande occupa più posti per visita;
  - una sola strada per dare giorno e fascia a una visita (`SlotBook`, `care-booking.ts`). Blocca
    tutte le fasce della fioreria in ordine di id e conta i posti delle visite che le occupano;
  - fascia piena: un'altra lo stesso giorno, poi il giorno più vicino della stessa settimana e
    dello stesso mese, altrimenti la visita resta "Por reprogramar";
  - ordine dei blocchi: contratto → fasce → visite. Chi cambia visite di un contratto blocca
    anche le fasce prima di toccarle; un cambio di fascia non blocca i contratti.
- **Visite:**
  - si creano alla conferma per 60 giorni. La manutenzione le allunga quando coprono meno di 45:
    un contratto per transazione, al massimo 100 per giro;
  - sono uniche per contratto, versione del calendario e data originale (indice parziale): una
    seconda generazione non crea doppioni;
  - le cancellate restano con il motivo (`cancelReason`: cambio di calendario, fine del
    contratto, la fioreria, il cliente), per i cargos del blocco 3;
  - un contratto con l'ultimo giorno passato lo chiude la manutenzione (ENDED). Un cambio di piano
    non ferma i contratti già firmati.
- **"Sí, avisé al cliente" (DECISO):**
  - il server lo chiede (`care_notice_required`) su ogni cambio che tocca visite già fissate:
    calendario nuovo, fine del contratto, spostare o cancellare una visita, prezzo aggiornato;
  - anche capienza abbassata, orario cambiato o fascia archiviata, se la fascia ha visite;
  - cambiare solo la persona assegnata non lo chiede. Il registro ricorda `customerNotified`.
- **Agenda (aggiorna ADR-057):**
  - nuova voce di menu: il giorno con le visite per fascia (posti occupati) e i pedidos del
    giorno, con il link a "Hoy salen" per la produzione;
  - il mese con visite, consegne e ritiri; le visite da riprogrammare;
  - la pagina della visita, con quello che serve sul posto: indirizzo, contatto, accesso, piante
    con le loro indicazioni, servizi. Da lì "Hecha" e "No se pudo" (tutta la squadra), poi
    spostare, cancellare e assegnare (chi gestisce);
  - le viste dei Pedidos restano dove sono. Su mobile "Agenda" e "Floral Care" stanno in "Más":
    la barra in basso resta di cinque voci (ADR-054). Deciso poi dal founder (ADR-078): l'Agenda
    va nella barra al posto di Clientes; "Floral Care" resta in "Más";
  - "Hecha" e "No se pudo" in un tocco sono sostituiti dalla visita dal telefono (ADR-078).
- **Lavori senza utente (§8 del piano):**
  - lo `JobScope` lo costruisce solo `loadJobScope`, che rilegge la fioreria attiva nella
    transazione del lavoro. Le funzioni `…Tx` ricevono uno `WriteScope` (un membro o un lavoro);
  - `recordJobAudit` scrive attore nullo e il nome del lavoro;
  - le funzioni SQL `app_care_contracts_to_extend` e `app_care_contracts_to_close` danno solo gli
    ID;
  - un test delle convenzioni vieta `as TenantContext` fuori da `context.ts`.
- **Permessi e piano:** `subscriptions:read` (tutti), `subscriptions:write` e
  `subscriptions:payments` (proprietario e gerente), `care:visit` (tutti). La funzione di piano
  `floralCare` è accesa per tutti nella fase di prova (D-29).
- **Dati:**
  - tabelle con RLS, FK composite e CHECK; si chiamano `CustomerSubscription…` perché
    `Subscription` è già il piano della fioreria;
  - azioni del registro `care.*` e `customer_subscription.*` (`subscription.*` resta il piano);
  - servizi della nostra lista: i 6 inclusi si creano al primo salvataggio. Gli extra
    (fertilización, sustrato, trasplante) sono proposte da aggiungere con il prezzo del fiorista:
    non inventiamo prezzi;
  - i termini li scrive la fioreria: Gardelia non aggiunge condizioni.
- **Non fatto (blocchi 2–7 del piano):**
  - 2: visita dal telefono con checklist, stato delle piante e foto; ruta del día con le visite
    (fatto nel blocco 2a, ADR-078; visita extra, piante morte e cambio di stagione nel 2b);
  - 3: cargos e pagamenti;
  - 4: blocchi, vacanze e cambi di massa con l'elenco dei clienti toccati;
  - 5: pagina del cliente con messaggi e "Cambiar fecha";
  - 6: Asistente de plantas, con le ricariche pagate a Gardelia. Cambia D-26 solo per le consultas
    (superato il 25/11 da ADR-085: i crediti li compra la fioreria, D-26 resta intatta);
  - 7: consegne periodiche.
- **Feedback del founder sul modulo del contratto (25/11/2026 sera):**
  - «Usa i dati del cliente» nella sede: persona e telefono del destinatario dell'indirizzo scelto,
    se no del cliente; acceso di default nel contratto nuovo (PROPOSTO), spento per scriverli a
    mano. Fatto nel rilascio 1;
  - **DECISO dal founder:** le **date scelte a mano** diventano una frequenza in più («Date scelte
    a mano»): il fiorista sceglie ogni data sul calendario, nelle fasce. Da fare nel rilascio 3,
    con le visite create subito per ogni data (piano in `IMPLEMENTATION_PLAN.md`).

### ADR-076 — Dati della fioreria: vigencia, orario di apertura, logo nelle stampe — ADOTTATO (24/11/2026)

Voce 2 di `docs/V1_SCOPE.md`, chiesta dal founder ("fai queste: … logo su preventivi e stampe, orari
di apertura, validità predefinita dei preventivi, IVA"). Prima di cominciare: allineamento a staging
(Floral Care, ADR-075, di un'altra chat) e verifica di cosa esisteva già.

- **Vigencia de las cotizaciones:** il valore c'era già (`Tenant.quoteValidityDays`, 7 giorni, CHECK
  1–90) ma non si cambiava. Ora è la card "Cotizaciones" in Ajustes (owner e manager), con audit.
  Vale per le cotizaciones nuove; in ognuna la data si cambia a mano come prima.
- **Orario di apertura:** scelta del founder del 24/11/2026: **"tutte le fasce, nessun limite"** per
  giorno. Tabella `OpeningHoursRange` legata alla sede principale (lo spec chiede orari per sede),
  con RLS, FK composite e CHECK (giorno 0–6, `start < end` nello stesso giorno). Giorno senza fasce
  = chiuso; nessuna fascia nella settimana = orario non indicato (non si mostra). Il form manda la
  settimana intera e il servizio sostituisce tutte le fasce in una transazione, con la sede
  bloccata. Limite tecnico di 12 fasce al giorno, solo contro i form manomessi. Fasce sovrapposte o
  che si toccano: errore sulla fascia. Resta separato dai giorni di chiusura delle consegne
  (ADR-055): una fioreria può consegnare la domenica con la tienda chiusa. Quando i due non
  coincidono, la pagina lo segnala.
- **Dove si vede l'orario:** nella tienda en línea ("Horario de atención") e nell'intestazione della
  cotización stampata. Si scrive in poche righe: i giorni consecutivi con le stesse fasce sono uniti
  ("Lunes a viernes 09:00–14:00, 16:00–20:00 · Sábado 10:00–14:00 · Domingo cerrado").
- **Logo nelle stampe:** un solo logo per fioreria, lo stesso di "Mi tienda en línea" (ADR-065), che
  ora si carica anche dalla card "Perfil de la florería" in Ajustes.
  - Si vede nell'intestazione della cotización stampata o in PDF e della comanda dell'ordine. Lì ci
    sono anche indirizzo, telefono ed email; nella cotización pure l'orario.
  - Si vede anche nelle pagine dei link pubblici di cotización e pedido, servito da
    `/cotizacion|pedido/<token>/logo` solo finché il link è attivo, come le altre immagini del link.
  - L'intestazione va al cliente: è nella lingua del mercato (ADR-042), anche se chi stampa usa
    l'app in italiano.
  - La tarjeta e la Producción del día restano senza logo: la prima va nel ramo, la seconda è un
    foglio di lavoro.
- **IVA:** **non implementata**, perché servono le regole del contador (O-06, CLAUDE.md §2). I
  preventivi restano `PRICES_FINAL` (ADR-020): prezzi finali al cliente, senza scorporo, e la UI lo
  dice. Domande per il contador:
  1. I prezzi di catalogo dei fioristi si intendono IVA inclusa? Con clienti privati il preventivo
     deve dire "IVA incluida"?
  2. Aliquota: 16% generale. Una fioreria in zona di frontiera (8%) come si distingue?
  3. I fiori recisi e le piante non lavorati possono essere a tasa 0% (LIVA art. 2-A)? E i ramos
     composti (prodotto lavorato più servizio) al 16%? Come si dividono in una riga?
  4. Il costo di consegna ha la stessa aliquota del prodotto?
  5. Con le aziende che chiedono il desglose e il CFDI (che la fioreria emette con il suo PAC), il
     preventivo deve mostrare subtotale, IVA e totale? Cambia qualcosa con il regime della fioreria
     (per esempio RESICO)?
  6. Lo sconto si applica prima dell'IVA? Si arrotonda per riga o sul totale?

  Con le risposte si aggiunge un `taxMode` per fioreria (oggi sempre `PRICES_FINAL`), con le colonne
  `tax` già presenti nel preventivo e il CHECK `total = subtotal − discount + tax`.

### ADR-077 — Sicurezza del conto: verifica in due passaggi e dispositivi collegati — ADOTTATO (24/11/2026)

Voce 1 di `docs/V1_SCOPE.md` e primi due punti "a prova di bomba" di `docs/ROADMAP.md`, chiesti
dal founder. Scelta sua: **obbligatoria per i titolari dopo 14 giorni** (tra "subito", "dopo 14
giorni" e "facoltativa"). Realizza P-09.

- **Pagina "Seguridad de la cuenta" (`/seguridad`):** per tutti, fioristi e chi compra, fuori dalla
  fioreria perché riguarda la persona e non il negozio. Ci si arriva dal menu della persona, da "Mi
  cuenta", dall'avviso nel pannello o dall'obbligo.
- **Verifica in due passaggi con Better Auth (plugin `twoFactor`):**
  - **Come si attiva:** password, poi QR (disegnato nel browser con `uqr`, nessun server o URL vede
    la chiave) o la chiave a mano, poi il primo codice. Alla fine 10 codici di respaldo da copiare
    o scaricare, ognuno vale una volta.
  - **All'accesso con email e password:** il passo `/verificacion` chiede il codice dell'app o un
    codice di respaldo. "Confiar en este dispositivo" vale 30 giorni.
  - **Protezioni di Better Auth:** limite ai tentativi (3 ogni 10 secondi su `/two-factor/*`), blocco
    del conto dopo 10 codici sbagliati per 15 minuti. Il segreto e i codici sono cifrati con
    `BETTER_AUTH_SECRET`.
  - **Chiamate dal browser:** attivazione, codice, nuovi codici e disattivazione passano da
    `/api/auth` (con il rate limiting), non da server action.
- **Chi deve attivarla:**
  - **Obbligatoria per:** chi ha una password ed è titolare di una fioreria vera (non demo) e attiva.
    Chi entra solo con Google è protetto dal suo account Google e non ha obblighi. Manager e staff
    possono attivarla, senza obbligo.
  - **Avviso:** nel pannello, con la data.
  - **Scadenza:** 14 giorni dall'ultima modifica della membership di titolare più vecchia. Così chi
    diventa titolare dopo essere stato manager ha i suoi 14 giorni.
  - **Dopo la scadenza:** `getTenantContext` manda a `/seguridad?requerida=1` qualsiasi pagina o
    azione di una fioreria. Si può solo attivarla o uscire.
  - **Disattivarla:** è possibile (es. telefono nuovo), con un avviso se è obbligatoria.
- **Dispositivi collegati:**
  - Elenco delle sessioni aperte, con browser e sistema riconosciuti dal user agent, inizio e ultimo
    uso.
  - "Cerrar sesión" su un altro dispositivo e "Cerrar sesión en los demás dispositivos".
  - Le sessioni si cancellano nel database, solo fra quelle della persona e mai quella in uso.
    L'endpoint di Better Auth chiederebbe una sessione "fresca" di meno di un giorno.
  - Il dispositivo chiuso esce entro 5 minuti (cache della sessione nel cookie): la pagina lo dice.
- **Registro:** eventi di piattaforma `security.*` con il solo ID della persona: verifica attivata o
  tolta, codici rigenerati, una o tutte le altre sessioni chiuse. Mai codici né segreti.
- **Database:** `User.twoFactorEnabled` e la tabella `TwoFactor` (una per persona). È una tabella di
  identità di Better Auth, **senza RLS** come `Session` e `Account`, perché la libreria la legge
  prima che esista un contesto. Il segreto vi è cifrato. Il test RLS la elenca fra le eccezioni
  motivate.
- **Supporto:** chi perde telefono e codici di respaldo non entra più con la password.
  L'operazione di piattaforma `reset-two-factor` (CLI e workflow "Operazioni di piattaforma", solo
  amministratore, con audit `platform.two_factor_reset`) toglie la verifica e chiude tutte le sue
  sessioni, dopo che il founder ha verificato chi è (guida in `docs/DEPLOY_VERCEL.md`).
- **Non fatto:** avvisi via email (verifica tolta, nuovo dispositivo) con Sentry e gli altri avvisi
  (punto 3 della lista in `docs/ROADMAP.md`); chiavi di accesso (passkey).

### ADR-078 — Floral Care, blocco 2: la visita dal telefono, il resoconto, la ruta, le visite extra e il cambio di stagione — ADOTTATO (24/11/2026)

Blocco 2 del piano approvato (`docs/FLORAL_CARE_PLAN.md`), chiesto dal founder ("ok vai col
blocco 2") e diviso in due rilasci: 2a (questo) e 2b (visita extra, piante morte, cambio di
stagione con cotización). Il founder ha deciso il 24/11: l'Agenda va nella barra in basso al posto
di Clientes; una visita extra si fissa in un orario di visita oppure a un'ora libera (2b).

- **La visita dal telefono** (`care-visit-work.ts`, permesso `care:visit`, anche lo staff):
  - "Empezar visita": da programmata (con data di oggi o passata, contratto attivo) a in corso,
    con ora e persona. Se non era assegnata la prende chi la inizia. Ripetuta non fa nulla;
  - i passi si salvano uno per uno (sul posto il segnale può mancare): servizi della checklist
    ("Hecho" / "No se hizo"), stato di ogni pianta (bien, atención, problema, muerta; in un gruppo
    quante sono toccate), "Todas bien" per quelle ancora senza stato, materiali, nota per il
    cliente, avvisi per chi gestisce. Un servizio "una sola vez" già fatto non torna;
  - i risultati dei servizi puntano al servizio della fioreria (mai cancellato) e ne copiano nome,
    prezzo e unità: quelli del contratto si riscrivono a ogni modifica;
  - "Terminar visita": ogni pianta deve avere il suo stato. I materiali escono dall'inventario in
    un solo registro legato alla visita (`consumeStockTx`, con conferma se manca giacenza); le
    piante morte diventano avvisi di reposición; nascono il link del resoconto e, se chiesta,
    l'email. Un secondo "Terminar" non fa nulla: il blocco della riga e le chiavi uniche
    (`inventoryEntryId`, un'email per visita e tipo) impediscono doppia uscita e doppia email;
  - "No se pudo": da programmata o in corso; niente materiali, foto e stati restano come prova;
  - "Hecha" in un tocco del blocco 1 sparisce.
- **Ordine dei blocchi:** contratto → visita → righe d'inventario. I passi bloccano solo la visita.
  File ed email sempre fuori dalle transazioni.
- **Foto** (`care-photos.ts`): una alla volta, dalla fotocamera o dalla galleria, al massimo 20 per
  visita, ridotte e senza dati EXIF. Ogni file ha la sua `uploadKey`, così un nuovo tentativo non
  crea doppioni. File privati `tenants/<id>/care-photos/<contratto>-<foto>.jpg`.
- **Cancellazione delle foto (eccezione accanto ad ADR-051; DECISO dal founder "a fine servizio",
  i 30 giorni sono PROPOSTI nel piano):**
  - 30 giorni dopo l'ultimo giorno del contratto il lavoro giornaliero cancella i file su R2, poi
    segna la riga (`deletedAt`); testi e stati restano;
  - una foto tolta durante la visita (o dopo, da chi gestisce) si cancella subito;
  - se lo storage non risponde si riprova ogni giorno; dal settimo giorno dopo la data è un errore
    nel log. `app_care_photos_to_purge` dà solo gli ID;
  - l'eliminazione di una fioreria (ADR-074) cancella anche queste foto.
- **Resoconto** (`care-report.ts`): lo stesso per la pagina della visita, la pagina pubblica e
  l'email. Fioreria, giorno, ore, chi è venuto (solo il nome), servizi, piante con stato e note,
  foto, nota; mai prezzi, materiali né avvisi interni.
- **Link pubblico:** riusa `PublicLink` (tipo `CARE_VISIT`, 60 giorni). Il nuovo valore dell'enum
  e il vincolo che lo usa stanno in due migrazioni. Pagina `/visita/<token>`: nella lingua del
  mercato, stampabile, con il logo della fioreria come i link di cotizaciones e pedidos (ADR-076).
  Lo condivide chi fa la visita (`care:visit`); rinnovarlo e disattivarlo resta a chi gestisce.
- **Email** (`care-email.ts`, tre lingue, quella del mercato della fioreria):
  - un solo controllo per tutte le email di Floral Care, `careEmailsAllowed`: fioreria LIVE e
    attiva, mai demo;
  - tabella d'uscita `CareEmail`, una riga per visita e tipo. Dopo il commit la riga si prende in
    modo atomico e si ricontrollano fioreria, email e link;
  - "Reintentar" a mano; il lavoro giornaliero riprova fino a 3 volte in 3 giorni
    (`app_care_emails_due`); una SENDING ferma da un'ora si chiude senza rimandarla.
- **Avvisi per chi gestisce** (`CareFollowUp`): reposición, extra chiesto dal cliente, altro. Li
  scrive la squadra; chi gestisce li segna "Atendido" con una nota facoltativa. Non si cancellano.
  L'Agenda li segnala.
- **Ruta del día** (`day-route.ts`): consegne e visite in un solo giro. L'ordine sta nel dominio
  (`orderRouteStops`): per fascia, poi per vicinanza con le coordinate ancora valide. Le visite
  entrano solo per chi vede i contratti in una fioreria con Floral Care. Scheda "Ruta"
  dell'Agenda; la ruta dei Pedidos resta.
- **Barra in basso (DECISO dal founder, aggiorna ADR-054 e ADR-075):** Inicio, Pedidos,
  Cotizaciones, Agenda, Más; Clientes passa in "Más".
- **Cronologia del cliente:** le visite hechas e no realizadas (ADR-070).
- **PROPOSTO (si cambia facilmente):** il resoconto va all'email del cliente del CRM (più
  destinatari col blocco 5); anche "No se pudo" avvisa il cliente, con la casella attiva; di chi è
  venuto si mostra il nome; 20 foto per visita.
- **Non fatto (2a):** modo offline vero (le foto si possono caricare dopo dalla galleria); riaprire
  una visita chiusa; cargos (blocco 3).

**Blocco 2b (24/11/2026): visite extra, piante morte, cambio di stagione.**

- **Visita extra** (`care-extras.ts`, chi gestisce): lavoro extra, reposición, installazione o
  ritiro di stagione.
  - In un orario di visita conta i posti del contratto; a un'ora libera (DECISO dal founder) non li
    tocca e i clienti non la potranno scegliere dal loro portale (blocco 5).
  - Il costo lo calcola il server: la tariffa per visita firmata nel contratto con il suo
    sovrapprezzo per distanza, "Sin costo", oppure "En la cotización" di una cotización del
    contratto. Si salva con la visita per i cargos del blocco 3.
  - È una visita nuova: non chiede "Sí, avisé al cliente"; spostarla o cancellarla sì. Solo una
    visita extra va a un'ora libera; non ha la checklist dei servizi del contratto.
- **Correzioni al blocco 1:** un nuovo calendario non tocca le visite extra, la fine del contratto
  sì; una extra non conta come giorno già occupato dal contratto; l'Agenda raggruppa per ora le
  visite senza fascia.
- **Cotización dal contratto** (`Quote.subscriptionId`): "Cotizar" crea la bozza per il cliente del
  contratto, con un titolo nella lingua del mercato ("Cambio de temporada · SUS-0003"), e apre
  l'editor delle cotizaciones. Vuole anche il permesso delle cotizaciones: lo staff no (O-08).
- **Piante morte:** l'avviso si risolve una volta sola. Una pianta morta: "Reposición sin costo"
  (una visita extra a costo 0), "En la próxima visita", "Cotizar" o "No se repone"; gli altri
  avvisi: "Atendido" o "Cotizar". La regola della fioreria sulle piante morte (incluse o con
  cotización) mette in evidenza la scelta suggerita: è solo un suggerimento, la userà il blocco 3.
  Lo stato resta `RESOLVED` con una colonna `resolution` che dice come (il piano proponeva un nuovo
  stato: non serve); gli "Atendido" del 2a diventano `HANDLED`.
- **Cambio di stagione:**
  - piante con la casella "De temporada": fuori dal prezzo del contratto, la paga la cotización;
  - alla fine della visita di ritiro si archiviano, con una casella attiva di default;
  - niente si rinnova da solo. La scheda "Cambio de temporada" del contratto guida i tre passi
    (cotización, piante, installazione e ritiro) e mostra le cotizaciones del contratto.
- **Dati:** migrazione M3 con soli enum nuovi (`CareExtraKind`, `CareExtraFee`,
  `CareFollowUpResolution`), le colonne e i vincoli: giorno senza fascia solo per una visita extra;
  tipo e costo solo per le extra; "en la cotización" sempre con la sua cotización; la risoluzione
  coerente con la cotización o la visita che l'hanno chiusa.
- **Non fatto (2b):** il cliente che chiede una visita extra dal portale (blocco 5); i cargos delle
  visite extra (blocco 3); il collegamento inverso dalla cotización al contratto nell'editor.

### ADR-079 — Esportazione dei dati della fioreria — ADOTTATO (24/11/2026)

Voce 15 di `docs/V1_SCOPE.md`, chiesta dal founder ("fai la 1"). Completa l'eliminazione della
fioreria (ADR-074): prima di eliminarla, i dati si portano via.

- **Chi e dove:** solo il titolare (`tenant:export`, OWNER): contiene i dati personali di tutti i
  clienti. Card "Datos de tu florería" in Ajustes e promemoria nella pagina "Eliminar florería".
  La rotta `/app/<slug>/settings/export` risponde 404 a chi non può, come le immagini private.
- **Cosa:** uno ZIP con un `LEEME.txt` e un CSV per area:
  - clienti, indirizzi e date speciali;
  - catalogo e ricette;
  - cotizaciones e loro concetti;
  - pedidos, loro concetti e pagamenti (le anulaciones con importo negativo);
  - inventario, movimenti e fornitori;
  - squadra;
  - Floral Care (contratti, visite, piante; dal blocco 3 anche cargos, loro righe e pagamenti,
    ADR-082).

  Le colonne `id` collegano i file. Non contiene foto, immagini del Diseñador e registro di
  attività: il LEEME lo dice.

- **Formato:**
  - CSV UTF-8 con BOM e righe CRLF (Excel e Google Sheets li aprono con gli accenti giusti);
  - importi con il punto decimale;
  - date nel fuso della fioreria;
  - stati e tipi con le parole dell'app, nella lingua del mercato (es-MX, come le email ai clienti).
- **Sicurezza:**
  - i testi che cominciano con `=`, `+`, `-`, `@` si fanno precedere da un apostrofo, così Excel
    non li esegue come formule (CSV injection, es. un cliente chiamato `=HYPERLINK(…)`);
  - importi, quantità e telefoni (formato controllato dal server) restano numeri;
  - tutto si legge nel contesto della fioreria con la RLS;
  - nel registro (`tenant.data_exported`) solo i conteggi per file, mai i dati.
- **Tecnica:** ZIP fatto in memoria con `fflate` (nuova dipendenza di `core`, senza dipendenze,
  versione fissa). Per le fiorerie della V1 bastano pochi MB; con archivi molto grandi servirà
  generarlo in background e mandarlo per email.

### ADR-080 — Reportes: vendite, prodotti, margine dichiarato, mermas e prossimi giorni — ADOTTATO (24/11/2026)

Voce 11 di `docs/V1_SCOPE.md` (BI-01 P0 dello spec), chiesta dal founder ("fai la 1 e poi la 2").
Nuova pagina "Reportes" nel menu, solo per chi gestisce (`reports:read`: owner e manager), perché
mostra vendite, margini e costi.

- **Periodo:** il mese, con frecce avanti e indietro, oppure l'anno; mai il futuro. Ogni numero
  principale si confronta con il periodo prima (mese prima o anno prima).
- **Ventas:**
  - pedidos consegnati o ritirati con il giorno di consegna nel periodo: il totale del pedido, con
    consegna e sconto;
  - ordini e ticket medio;
  - a parte, quanto c'è ancora "por entregar" fra i pedidos confermati del periodo;
  - grafico per giorno o per mese: una sola serie, barre sottili, tooltip e tabella per chi usa un
    lettore di schermo.
- **Cobrado:** i pagamenti registrati con data nel periodo; le anulaciones sottraggono.
- **Lo más vendido:** i 10 prodotti per importo, antes de descuentos. I disegni del Diseñador
  contano insieme, i concetti liberi per descrizione.
- **Margen bruto:** solo sulle righe con il costo (spec 5.8: "se mancano i costi non mostrare margini
  apparentemente accurati").
  - Lo sconto del pedido si ripartisce sulle righe; la consegna non entra.
  - La pagina dice sempre su che quota delle vendite è calcolato e quante righe non hanno costo.
  - Senza nessun costo non c'è margine, ma l'invito a completare il catalogo.
- **Mermas:** dall'inventario, come il riepilogo del mese (ADR-063), con il costo dove c'è. Solo
  con l'inventario nel piano.
- **Floral Care:** ~~ricavi ricorrenti stimati al mese dei contratti attivi~~. Dal 24/11
  (decisione del founder, ADR-082) i cargos e i pagamenti veri del periodo: quanto si è cobrado,
  quanto manca e il vencido di oggi, solo per chi gestisce i soldi.
- **Próximos 7 días:** pedidos da consegnare e visite programmate, con i link al calendario e
  all'Agenda.
- **IVA:** gli importi sono quelli dei pedidos, senza scorporo (O-06, ADR-076); la pagina lo dice.
- **Non fatto (P1 dello spec):**
  - funnel cotización → pedido, retention, valore dei clienti;
  - profitto per ramo;
  - confronto fra sedi;
  - export dei report (i dati grezzi ci sono già, ADR-079).

### ADR-081 — Catalogo completo: sostituto quando manca un fiore, servizi con durata e zona, proveedor habitual e tempi, elenco dei fiori — ADOTTATO (24/11/2026)

Avviato dal founder ("fai la 4": il punto Catalogo dei resti della V1). Scelte del founder del
24/11/2026: il sostituto **segue la regola del ramo**, anche lo staff; la zona dei servizi è un
**raggio in km**; l'elenco dei fiori lo **mantiene Gardelia, con la revisione di un fiorista** (O-09).

- **Sostituto quando manca un fiore** (CAT-01, spec §6.4 "mai sostituire in silenzio"):
  - **Quando:** in un pedido confermato o in preparazione, non ancora scaricato (ADR-071), un
    ingrediente di un ramo è agotado nel catalogo (o archiviato) o la merce controllata non basta
    (con l'apartado dell'ordine, ADR-072). La scheda del pedido mostra il riquadro "Faltan flores".
  - **Cosa si propone:** fino a 4 prodotti dello stesso tipo e della stessa unità (12 tallos restano
    12 tallos), attivi, non agotados, non già nel ramo e, se controllati, con merce sufficiente; prima
    la stessa specie (altra varietà), poi lo stesso colore, poi per verde e materiali lo stesso tipo;
    a parità il prezzo più vicino. Regole pure in `packages/domain/src/substitution.ts`.
  - **Regola del ramo:** "No se sustituye" → nessuna proposta, il cambio si rifiuta; "Preguntar al
    cliente" → il messaggio di WhatsApp al cliente è pronto (lingua del mercato) e serve la casella
    "El cliente aceptó el cambio"; "Similar permitido" → si cambia subito. I disegni del Diseñador
    valgono come "Preguntar" (li ha scelti il cliente). Lo fa chiunque prepara i ramos
    (`orders:fulfill`, staff compreso).
  - **Cosa cambia:** solo la distinta della riga (snapshot: il nuovo fiore con `replaces`, quello
    concordato all'inizio), quindi cosa esce a "Listo", l'apartado dell'ordine e la Producción del
    día. Il **prezzo resta quello concordato**; il costo stimato della riga si aggiorna quando i due
    costi sono noti, altrimenti resta la stima di prima. La distinta mostra "(en lugar de …)" nella
    scheda e nella comanda stampata. Audit `order.ingredient_substituted` con regola e ok del cliente.
  - **Non fatto:** sostituire un prodotto venduto da solo (cambierebbe il prezzo: si parla con il
    cliente), cambiare la quantità del sostituto, le righe nate prima di ADR-071 (senza gli ID degli
    ingredienti), le cotizaciones (il Diseñador blocca già gli agotados).
- **Servizi con durata e zona:** per i servizi (e i servizi aggiuntivi) la durata indicativa (una
  tendina da 15 minuti a una giornata) e il raggio in km dalla fioreria (1–200), al posto del tempo di
  preparazione; la migrazione sposta nella durata il tempo che i servizi avevano già. Nella riga
  (snapshot, come concordati) e quindi in cotización, pedido, stampe e link per il cliente:
  "Duración aprox. 3 h · Hasta 15 km". Il pedido a domicilio avvisa se l'indirizzo è oltre il raggio
  (linea retta, come ADR-069, solo con le posizioni di Google ancora valide; altrimenti nessun avviso
  inventato). I servizi non hanno proveedor. CHECK nel database.
- **Proveedor habitual:** campo del prodotto (FK composita a `Supplier`), solo con il piano
  dell'inventario, dove i proveedores esistono (ADR-061); un campo assente nel form non cambia il
  valore salvato, un proveedor archiviato resta finché non si cambia. Nuova scheda **"Por pedir"**
  dell'inventario (per chi compra): agotados e por agotarse raggruppati per proveedor, con il
  messaggio di WhatsApp già scritto (prodotti, senza quantità: le decide la fioreria) e "Registrar
  compra" con proveedor e prodotti già scelti; dal riquadro del pannello "Qué pedir".
- **Tempo di preparazione:** c'era già nel prodotto ma non serviva a niente; ora la Producción del
  día stima il lavoro ("Tiempo de preparación estimado: 2 h 15 min") e dice quanti ramos non hanno
  il tempo nel catalogo. Si usa il tempo attuale del catalogo (è una stima per organizzarsi).
- **Elenco dei fiori (O-09):** resta unico, in `packages/db/src/reference-data.ts`, curato da Gardelia.
  Per la revisione c'è il foglio `docs/LISTA_FLORES_REVISION.md`, in spagnolo, generato dal file
  (`pnpm --filter @floral/db flowers:review`; un test controlla che sia aggiornato): il founder lo dà
  a un fiorista di Aguascalientes e le correzioni entrano con il rilascio successivo. Le specie
  private per fioreria non ci sono (l'IA riceverebbe nomi non controllati).
- **Esportazione (ADR-079):** `productos.csv` ha anche tempo di preparazione, proveedor habitual,
  durata e raggio dei servizi.

### ADR-082 — Floral Care, blocco 3: cargos e pagamenti dei contratti — ADOTTATO (24/11/2026)

Blocco 3 del piano approvato (`docs/FLORAL_CARE_PLAN.md` §3 e §7), chiesto dal founder ("ok vai col
blocco 3", poi "vai col 3b") e diviso in due rilasci: 3a e 3b ("Cobré en la visita" per lo staff,
"Por recuperar", "Ajuste para el próximo cargo"). Il founder ha deciso il 24/11:

1. scadenza con i **"Días para pagar"** scelti da ogni fioreria (Ajustes → Floral Care, 10 di
   default);
2. il cliente che non apre, con «Se agenda otra visita»: **la visita mancata si paga e il recupero
   è gratis** (3b);
3. più sedi: **un solo pagamento sull'estado de cuenta**, distribuito sui cargos più vecchi; resta
   possibile pagare un cargo alla volta;
4. lo staff segna gli incassi alla visita come "por registrar" già nel blocco 3 (3b).

- **Una regola sola, per visita** (dominio, `floral-care-charges.ts`):
  - una visita del calendario è **dovuta** se non è "Por reprogramar" e non l'ha tolta la fioreria
    (cancellata dalla fioreria, cambio di calendario, fine del contratto, "No pudimos ir");
  - all'emissione del mese P si confronta "dovuta" con "cobrada" (`CareVisitBilling`): dovute e
    mai cobrate del mese → riga delle visite al prezzo di P; dei mesi prima → debito al prezzo del
    cargo del loro mese (o di oggi se quel mese non ha cargo); cobrate e non più dovute → credito;
  - una visita chiusa con lo stato pari diventa stabile e non si guarda più; le altre si
    riguardano ogni mese. Così una visita spostata in un altro mese si paga una volta, una cobrada
    che diventa "Por reprogramar" si accredita e si cobra di nuovo quando torna dovuta, una nata
    dopo il cargo si cobra il mese dopo;
  - visite extra fatte con la tariffa per visita e servizi EXTRA "una sola vez" fatti (al prezzo
    copiato quando la squadra li segna): una volta, nel cargo dopo la visita. Il commento "nel
    primo mese" di `priceCareVisit` è corretto;
  - il cargo emesso non cambia più: ogni variazione va sul cargo del mese dopo (§3 del piano).
- **Prezzo:** ogni cargo salva il prezzo per visita e la versione del prezzo. Un cambio di prezzo
  vale dal mese dopo: `repriceCareContract` emette prima il mese in corso, se manca.
- **Saldo a favore:** con il contratto attivo un cargo non va sotto zero, l'eccedenza passa al
  cargo dopo (coppia di righe, unica per cargo d'origine). Il cargo dopo l'ultimo giorno del
  contratto resta "A favor del cliente" e si chiude con "Registrar devolución".
- **Quando nasce:** alla conferma del contratto (il mese in corso, con le visite che restano: la
  proporzione viene da sola) e poi dal lavoro giornaliero dal giorno 1, **prima** degli altri
  lavori di Floral Care, con il suo tetto di tempo (`app_care_contracts_to_charge`, solo ID). Un
  mese per transazione, fino a 3 per contratto in un giro; quelli che restano li prende il giro
  dopo (`careChargesPending` nel risultato della manutenzione, con un warning nel log). Un
  contratto finito si guarda finché ha visite non sistemate o un saldo a favore da portare nel
  cargo finale. Un mese si emette una volta (chiave unica per contratto e mese). Numero `CAR-0001`.
- **Scadenza:** dal primo del mese, o dal giorno in cui il cargo nasce se è dopo (un lavoro in
  ritardo o una conferma a metà mese), più i "Días para pagar". Lo stato (pendiente, parcial,
  vencido, pagado, sin saldo, a favor, devuelto) si calcola in lettura nel giorno della fioreria.
- **Ordine dei blocchi:** l'emissione blocca il contratto, legge le visite e scrive solo le sue
  tabelle: il cargo non aggiorna mai `CareVisit` (il cambio di una fascia aggiorna le visite senza
  bloccare il contratto; la sua modifica, se arriva dopo, va sul cargo del mese dopo). I pagamenti
  bloccano i cargos toccati in ordine di id (uno storno prima il suo movimento), mai contratti o
  visite: non si incrociano con l'emissione. Provato insieme a "Terminar", a uno spostamento e al
  cambio di una fascia.
- **Pagamenti** (`care-payments.ts`, registrati a mano come gli ordini, D-26):
  - su un cargo, mai oltre il saldo; sull'estado de cuenta, distribuiti dal cargo più vecchio;
  - "Anular": uno storno di segno opposto su tutti i cargos toccati, una volta sola (anche con due
    richieste insieme); una devolución si annulla allo stesso modo, uno storno no;
  - la chiave del modulo (`submitKey`) fa sì che lo stesso invio arrivato due volte non raddoppi;
  - le distribuzioni portano il cliente nelle due chiavi esterne: il database non lascia mettere un
    pagamento sui cargos di un altro cliente. Pagato e saldo del cargo sono controllati (CHECK).
  - Nel registro numeri e importi, mai referencia o nota.
- **Pagine:** "Cobros" (Floral Care → Cobros: por cobrar, vencidos, pagados, a favor; mese,
  ricerca, totali), la pagina del cargo (righe, pagamenti, stampa con l'intestazione nella lingua
  del mercato e "Precios finales, sin impuestos", O-06: non è una factura), l'estado de cuenta del
  cliente (tutte le sedi, stampabile), la card "Cargos" e le regole nel contratto, l'etichetta
  "Vencido" negli elenchi, il riquadro "Cobros de Floral Care" nel pannello, la cronologia del
  cliente (cargo emesso, pagamenti), "Días para pagar" nelle impostazioni.
- **"No se pudo" chiede perché:** "El cliente no abrió" si paga (con «Cuenta como hecha» per la
  regola stessa, con «Se agenda otra visita» per la decisione 2) o "No pudimos ir" (credito). Le
  visite "No se pudo" di prima valgono come il cliente che non apre.
- **Regole copiate nel contratto:** alla conferma il contratto copia le regole della fioreria
  (cliente che non apre, piante morte): valgono per tutto il contratto, e i suggerimenti delle
  piante morte (2b) usano queste. Per i contratti già confermati la migrazione ha copiato quelle
  di oggi.
- **DECISO dal founder il 24/11 (risposte alle proposte del 3a e del 3b):**
  - una visita cancellata dal cliente **si paga solo se arriva con meno ore di preavviso del limite
    scelto dalla fioreria** ("entro un orario che decide il fiorista, tipo 12 ore"): vedi sotto,
    "Cancelación del cliente";
  - i soldi (cargos, pagamenti, estado de cuenta, riquadro, etichetta "Vencido", voci della
    cronologia, la card dei Reportes) li vede solo chi ha `subscriptions:payments` (proprietario e
    gerente); lo staff vede solo gli incassi che ha segnato lui;
  - un incasso confermato quando il cliente non ha ancora cargos per quell'importo resta "por
    registrar" finché nasce il cargo;
  - i Reportes usano i cargos e i pagamenti veri di Floral Care, non più la stima (vedi sotto).
- **PROPOSTO (si cambia facilmente):** emettere, leggere e cobrar i cargos dei contratti firmati
  non chiede il piano: un cambio di piano non ferma i contratti e la fioreria deve poter cobrar.
- **Dati:** migrazione M4 con soli enum nuovi (`CareChargeLineKind`, `CareCreditReason`,
  `CarePaymentKind`, `CarePaymentStatus`, `CareNotDoneCause`), le tabelle `CareCharge`,
  `CareChargeLine`, `CareVisitBilling`, `CarePayment`, `CarePaymentAllocation` con RLS e vincoli,
  le colonne `CareVisit.notDoneCause`, `CareVisitServiceResult.priceMinor`,
  `CustomerSubscription.chargedThrough/missedVisitPolicy/deadPlantPolicy`,
  `CareSettings.paymentDueDays`. `CarePayment` ha già stato e visita per il 3b.
- **Dialoghi:** il dialogo condiviso scorre da solo negli schermi bassi (anche i moduli di
  pagamento si vedono interi a 320 px); tolte le due eccezioni del 2b.
- **Esportazione dei dati (ADR-079):** lo ZIP aggiunge `floral_care_cargos.csv` (con lo stato nel
  giorno della fioreria), `floral_care_cargos_conceptos.csv` e `floral_care_pagos.csv` (anulaciones
  e devoluciones con importo negativo, i cargos toccati da ogni pagamento), così lo storico dei
  soldi resta anche dopo aver eliminato la fioreria. I Reportes (ADR-080) mostrano ancora i ricavi
  stimati dei contratti: usare i cargos e i pagamenti veri è da decidere.
- **Blocco 3b (fatto il 24/11):**
  - **"Cobré en la visita"** (`care-collections.ts`, decisione 4): chi fa la visita, in corso o
    fatta, segna quanto gli ha dato il cliente, come e una nota. Il movimento resta "Por
    registrar" (PENDING, con la visita e l'importo segnato in `collectedMinor`): non tocca i
    cargos, lo vedono Cobros, l'estado de cuenta (fuori dal saldo) e il pannello. Uno alla volta
    per visita (indice unico parziale), e la chiave del modulo rende un doppio tocco uno solo.
    Chi gestisce i soldi lo conferma, anche per meno di quanto segnato e mai di più: diventa un
    pagamento distribuito sui cargos più vecchi del cliente; se il cliente non ha ancora cargos
    per quell'importo (un anticipo) resta "por registrar" finché nasce il cargo. Oppure lo
    rifiuta con il motivo, che vede chi l'ha segnato. Ordine dei blocchi: il movimento, poi i suoi
    cargos, come uno storno.
  - **"Por recuperar"** (decisione 2): una visita del calendario "No se pudo" per il cliente, in
    un contratto con «Se agenda otra visita», resta cobrada e ha una visita extra di recupero
    sempre "Sin costo", legata nel database (stesso contratto; una sola valida alla volta: se si
    cancella o non si fa, la visita torna "Por recuperar"). "Agendar recuperación" sta nella
    pagina della visita mancata; l'Agenda le conta e le elenca ("Visitas por recuperar").
  - **"Ajuste para el próximo cargo"** (`care-adjustments.ts`): chi gestisce i soldi aggiunge un
    importo a favore o a carico del cliente con il motivo, che diventa la riga "Ajuste: …" del
    primo cargo che nasce (una volta sola, chiave unica sulla riga). Prima si può togliere
    ("Quitar", resta nello storico); dopo no, si corregge con un altro ajuste. Solo su un contratto
    confermato, attivo o in pausa; un contratto finito con un ajuste in attesa ha comunque il suo
    cargo finale (la funzione dei contratti da cobrar lo guarda). Al massimo 20 in attesa.
  - **Dati:** migrazione M5 (`CareVisit.recoveryOfVisitId`, `CarePayment.collectedMinor`, la
    tabella `CareChargeAdjustment` con RLS, `CareChargeLine.adjustmentId`, il ramo ADJUSTMENT nel
    CHECK delle righe). Nel registro importi e forma, mai la nota, il motivo del rifiuto o quello
    dell'ajuste.
- **Cancelación del cliente con orario limite (24/11, decisione del founder):**
  - Ajustes → Floral Care: "Si el cliente cancela con menos de [12] horas" (da 0, mai, a 168, una
    settimana; vuoto = 12). Il limite si copia nel contratto alla conferma, come le altre regole;
    la migrazione ha dato ai contratti già confermati quello di oggi della fioreria;
  - "Cancelar visita" → "La pidió el cliente": il server confronta l'ora d'inizio della visita
    (giorno e ora nel fuso della fioreria) con adesso. Con meno ore del limite la visita resta
    dovuta (si paga); prima del limite non lo è e, se era già nel cargo, il cargo dopo ha il credito
    "el cliente avisó a tiempo" (nuovo motivo `CUSTOMER`). Il risultato si salva nella visita
    (`cancelCharged`, con un CHECK: c'è solo per le cancellate dal cliente), così non cambia più;
  - la finestra lo dice prima di salvare ("no se cobra si avisa antes del …" oppure "se cobra"); con
    una cancellazione tardiva c'è "No cobrar esta vez" (**PROPOSTO**: per un avviso arrivato in
    tempo e registrato tardi), che il registro segna (`waived`);
  - una visita extra cancellata dal cliente non si paga comunque: le extra si cobrano solo fatte;
  - le visite cancellate dal cliente prima di questa regola restano pagate (come la regola
    PROPOSTA del 3a), così i cargos già emessi non cambiano.
- **Reportes con i soldi veri (24/11, decisione del founder; aggiorna ADR-080):** la card "Floral
  Care" del periodo mostra i cargos dei mesi del periodo (quanti e quanto), il cobrado (pagamenti
  registrati con data nel periodo, meno anulaciones e devoluciones), quanto manca di quei cargos e
  il vencido di oggi con il link a Cobros. Solo per chi gestisce i soldi; la stima dei contratti
  attivi (`estimateCareMonth`) resta solo nel simulatore delle tariffe.
- **Non fatto:** pagamenti online dei contratti (fuori dal perimetro, §9 del piano); factura e IVA
  (O-06, da validare con il contador).

### ADR-083 — Floral Care, blocco 4: giorni bloccati, vacanze e cambi di massa — ADOTTATO (24/11/2026)

Blocco 4 del piano approvato (`docs/FLORAL_CARE_PLAN.md` §7), chiesto dal founder ("passa al
blocco 4"): blocchi di giorni o fasce, giorni di punta proposti, elenco dei clienti toccati,
spostamento o credito di tutte le visite insieme, email facoltativa, casella obbligatoria.

- **Il blocco** (`CareBlock`, Agenda → Bloqueos, chi gestisce): dal–al (da oggi, entro un anno, al
  massimo 92 giorni), tutto il giorno o un orario solo, un nome che vede solo la squadra, e cosa
  fare delle visite già fissate:
  - **«Moverlas a otro día»**: il giorno libero più vicino dello stesso mese, prima o dopo, da
    domani, dentro il contratto e mai due visite dello stesso contratto lo stesso giorno
    (`pickCareSlotInMonth`, `SlotBook.placeInMonth`). Prima un'altra fascia lo stesso giorno, se il
    blocco è di un orario solo. Senza posto nel mese: "Por reprogramar". La regola "stesso mese"
    è quella del piano (§3); la ricerca va oltre la settimana perché una settimana di vacanze
    altrimenti lascerebbe tutto da riprogrammare;
  - **«Cancelarlas sin cobrar»**: come se le togliesse la fioreria (motivo SHOP, il nome del blocco
    come nota): non si pagano, e se erano già in un cargo il credito va nel cargo dopo (ADR-082).
- **Mai più una prenotazione in un giorno bloccato:** il libro delle fasce (`openSlotBook`) legge i
  blocchi attivi e dà 0 posti a una fascia bloccata; un blocco di tutto il giorno chiude anche le
  ore libere delle visite extra. Vale per la generazione, lo spostamento a mano, le visite extra,
  il cambio di una fascia (e poi il cliente dal portale). Lo spostamento e la visita extra a
  un'ora libera adesso bloccano anche loro le fasce, così si mettono in fila dietro un blocco che
  nasce nello stesso momento.
- **Le visite che nasceranno dopo** in quei giorni seguono la stessa scelta: la generazione le crea
  già spostate (giorno libero più vicino del mese) o già cancellate dalla fioreria. Non c'è avviso:
  non erano ancora fissate.
- **Anteprima e impronta:** "Ver visitas afectadas" calcola sul server il piano (contratto per
  contratto, dove va ogni visita, chi non ha l'email). "Guardar bloqueo" rifà lo stesso piano con
  le fasce bloccate e le visite bloccate in ordine di id; se l'impronta (`careBlockPlanFingerprint`)
  è diversa, perché qualcuno ha preso un posto o spostato una visita, chiede di rivedere
  (`care_block_changed`): ai clienti si dicono le date giuste. Con visite toccate serve "Sí, avisé
  al cliente".
- **Email facoltativa** (casella attiva di default, PROPOSTO): una per contratto toccato, nella
  tabella d'uscita di Floral Care (`CareEmail` con `blockId`, tipo `BLOCK_NOTICE`, unica per
  blocco e contratto). Nella lingua del mercato: le visite del contratto con la data nuova, "te
  avisaremos la nueva fecha" o "cancelada, no se cobra", la sede, i contatti della fioreria.
  Partono dopo il commit con un tetto di 8 secondi; quelle che restano o falliscono le riprova il
  lavoro giornaliero (come i resoconti). Dalla pagina del blocco: "Enviar aviso" (se all'inizio non
  era chiesto) e "Reintentar". Mai in una fioreria demo.
- **Ordine dei blocchi:** come chi cambia le visite di un contratto (ADR-075): i contratti toccati
  in ordine di id, poi le fasce, poi le visite in ordine di id. Le righe nuove (visite cambiate,
  avvisi) puntano ai contratti con una chiave esterna, che chiede un blocco leggero sul contratto:
  senza tenerlo già, uno spostamento che ha il contratto e aspetta le fasce si fermava con il blocco
  (trovato dal test di concorrenza nella suite completa). Una visita nata nel frattempo in un altro
  contratto fa rivedere il piano. Provato insieme a uno spostamento (nessuno stallo).
- **"Quitar bloqueo":** il blocco non vale più (resta nello storico, `removedAt`); le visite già
  spostate o cancellate restano come sono.
- **Giorni di punta (PROPOSTO dal piano, confermato come proposta):** 14 febbraio, 10 maggio, 1–2
  novembre e 12 dicembre per il Messico (`CARE_PEAK_DAYS`; l'Italia ha date diverse e si scrive
  quando il mercato si apre). Si propongono nella pagina dei blocchi con "Bloquear", che apre il
  modulo già compilato; mai bloccati da soli. Spariscono quando un blocco di tutto il giorno li
  copre.
- **"Alguien no puede ir"** (persona malata): le visite programmate di una persona in quei giorni
  passano a un'altra o a nessuno. Cambia solo chi va, non l'ora: niente avviso (decisione del
  founder del 24/11, ADR-075).
- **Agenda:** il giorno bloccato ha il riquadro "Día bloqueado: …" (o l'orario), l'orario bloccato
  il segno "Bloqueado"; il mese segna i giorni bloccati.
- **Solo Floral Care (PROPOSTO):** i pedidos e la tienda en línea restano con i giorni di chiusura
  della settimana (ADR-055); date chiuse anche per le consegne sono un passo a parte, se il founder
  lo vuole.
- **Dati:** migrazione `care_blocks` con soli enum nuovi (`CareBlockAction`, `CareBlockOutcome`)
  più il valore `BLOCK_NOTICE` di `CareEmailKind` (non usato nella stessa migrazione); tabelle
  `CareBlock` e `CareBlockVisit` (le visite cambiate quando il blocco è nato: l'elenco dei clienti
  e il testo dell'email) con RLS, FK composite (la visita è dello stesso contratto) e CHECK; nel
  registro date, scelta e conteggi, mai il nome del blocco né i clienti. Un blocco di un'altra
  fioreria dà 404 e l'evento di sicurezza.
- **Esportazione dei dati (ADR-079):** lo ZIP aggiunge `floral_care_bloqueos.csv` (date, orario,
  nome, scelta, visite cambiate, creato e tolto).
- **Non fatto:** il cliente che vede i giorni bloccati nel suo portale (blocco 5); date chiuse per
  i pedidos; scegliere visita per visita dentro un blocco (si cambia a mano dopo, dalla visita).

### ADR-084 — Floral Care, blocco 5: la pagina del cliente (5a: accesso, Mi Floral Care, «Cambiar fecha»; 5b: messaggi) — ADOTTATO (25/11/2026)

Blocco 5 del piano approvato (`docs/FLORAL_CARE_PLAN.md` §7), chiesto dal founder ("ok vai col
blocco 5"), in due rilasci: **5a** accesso, lettura e «Cambiar fecha»; **5b** (in fondo) messaggi
con foto, riassunto per la fioreria, messaggi nell'export e nell'eliminazione del conto.

**Decisioni del founder (24/11/2026):**

1. **Contratto finito:** il cliente lo vede ancora 30 giorni, in sola lettura (finché si cancellano
   le foto, ADR-078); poi l'accesso a quel contratto si chiude da solo.
2. **Soldi:** la fioreria sceglie in ogni invito «Puede ver precios y cobros», spuntato di default.
   Senza, la persona vede visite, resoconti, piante (e nel 5b i messaggi), ma nessun prezzo né
   cargo.
3. **Messaggi (5b):** li legge e risponde tutta la squadra, staff compreso.
4. **Email al cliente quando la fioreria scrive (5b):** al massimo una al giorno per contratto.

**Come funziona:**

- **Invito** (card «Acceso del cliente» nella pagina del contratto; proprietario e gerente,
  `subscriptions:write` e poi `requireEntitlement(ctx, 'floralCare')`):
  - campi: email (precompilata dal cliente), «Solo este contrato» o «Todos sus contratos», la
    casella dei soldi;
  - solo da un contratto attivo o in pausa di un cliente attivo; al massimo 10 inviti in attesa e
    20 accessi per cliente;
  - link firmato (HMAC di fioreria e ID dell'invito, come i link pubblici, ADR-056): vale 7 giorni
    e solo per la stessa email; «Copiar enlace» e WhatsApp sempre, l'email solo da una fioreria
    LIVE, nella lingua del mercato;
  - un invito nuovo per la stessa email sostituisce quello in attesa; ci sono anche «Reenviar»
    (link nuovo) e «Revocar»;
  - la scheda del cliente ha la riga «Mi Floral Care: N personas · N invitaciones pendientes».
- **Accettazione** (`/cuenta/floral-care/invitacion/[token]`):
  - si apre anche senza sessione; login, registrazione (con la verifica dell'email) e Google
    tornano al link;
  - con un altro conto chiede di cambiarlo; scaduto, revocato o già accettato lo dice;
  - accettare crea l'accesso (`CarePortalAccess`) e apre il conto cliente (`openBuyerAccount`), così
    chi non ha una fioreria arriva a «Mi cuenta».
  - Il token si legge nel contesto della fioreria del token (`withTenantContext`): nessun
    `withSystemContext` nuovo, CLAUDE.md §4.8 non cambia.
- **Mi Floral Care** (`/cuenta/floral-care`, card in «Mi cuenta»):
  - l'elenco dei contratti fra tutte le fiorerie, al massimo 100: fioreria, sede, prossima visita,
    saldo se può vedere i soldi;
  - la pagina del contratto: cosa comprende (frequenza, giorni e orari, servizi, piante) e le
    regole (aviso para cambiar, cancelaciones, cliente que no abre); i contatti e i termini attuali
    della fioreria;
  - con i soldi, il prezzo per visita e i cargos (Pagado / Pendiente / Vencido) con le righe. Mai
    referencias, note o incassi «por registrar»: i pagamenti restano alla fioreria;
  - le prossime visite con «Cambiar fecha» e «puedes cambiarla hasta el …»;
  - le visite fatte con il resoconto (`VisitReportView`: foto, chi è venuto, quando);
  - contratto finito: il riquadro «Terminó el …; las fotos se borran el …», sola lettura;
  - le foto passano da `/cuenta/floral-care/foto/[photoId]`: con la sessione, 404 senza accesso,
    cache di 5 minuti (quella di un giorno sopravviverebbe a una revoca).
- **«Cambiar fecha»** (una pagina, non un dialogo, così funziona a 320 px):
  - **regole:**
    - solo visite regolari programmate, mai extra né «Por reprogramar»;
    - stesso mese della data attuale, dentro le date del contratto;
    - sia l'inizio attuale sia il nuovo dopo adesso + il preavviso del contratto, nell'ora della
      fioreria (`careVisitStartAt`);
    - una fascia attiva del giorno giusto, non bloccata (ADR-083), con i posti della visita;
    - nessun'altra visita del contratto quel giorno; solo fasce, mai «hora libre»;
    - nessun «Sí, avisé al cliente», perché è il cliente che sposta;
  - la pagina mostra solo le fasce libere, raggruppate per giorno, senza i posti né i nomi dei
    blocchi;
  - **dopo il cambio:**
    - la fioreria vede «Cambiada por el cliente» nell'Agenda e nella visita
      (`CareVisit.customerMovedAt`, azzerato quando la fioreria la sposta);
    - proprietari e gerenti ricevono un'email, solo da una fioreria LIVE;
    - il registro ha `care.visit_moved_by_customer`, con la persona come attore e
      `source: 'portal'` (`recordPortalAudit`);
  - **preavviso:** `CustomerSubscription.minNoticeHours` si copia alla conferma come
    `lateCancelHours` (ADR-082). I contratti già confermati hanno preso il valore di oggi della
    fioreria (24 se manca). Così `CareSettings.minNoticeHours`, salvato dal blocco 1, si applica
    davvero, e il contratto lo mostra nelle regole.
- **Modalità portale nel database** (chiusa di default):
  - **ingresso:** `withPortalContext(db, {userId, subscriptionId}, fn)` imposta solo
    `app.user_id`, poi chiama la SECURITY DEFINER `app_portal_enter(sub)`. La funzione:
    - prende la persona solo dalla sessione e controlla l'accesso;
    - imposta `app.portal_tenant_id`, `app.portal_customer_id`, `app.portal_subscription_id` e
      `app.portal_money`;
    - restituisce quello che il portale mostra ma non può leggere (la fioreria, i termini);
    - senza accesso non imposta nulla, e la persona riceve un 404;
  - **cosa si vede:**
    - `app.tenant_id` non c'è, quindi la policy di tenant fallisce ovunque;
    - danno righe solo le policy `portal_read` (FOR SELECT) di 13 tabelle: `CustomerSubscription`
      e i suoi servizi e fasce, `CareVisit` e i suoi risultati, `CarePlant`, `CarePhoto` (non
      tolte né cancellate), `CareSlot` del contratto, `Customer`, la sua `CustomerAddress` del
      contratto, e `CareCharge` e `CareChargeLine` (solo con i soldi);
    - tutto il resto non dà niente: `Tenant`, `Membership`, ordini, preventivi, inventario,
      pagamenti, avvisi interni, blocchi, registro, le tabelle d'accesso;
    - ogni scrittura è rifiutata; un contratto per transazione;
  - **una sola regola di visibilità:** `app_portal_visible_contracts` richiede accessi attivi,
    fioreria e cliente attivi e tipo CARE; il contratto deve essere attivo, in pausa, oppure finito
    da meno di 30 giorni nel fuso della fioreria. Il dominio ha la stessa regola,
    `carePortalContractState`, provata da tutti e due i lati;
  - **scrittura di «Cambiar fecha»:** `withPortalWriteContext` è il contesto della fioreria (i
    posti si contano su tutte le visite) più `app_portal_enter`. Il `tenantId` viene da
    `app_buyer_care_contracts()`, come fa `cancelMarketplaceOrder`. In più c'è la policy
    RESTRICTIVE `portal_write_guard` FOR UPDATE su `CareVisit`: in portale si tocca solo una
    visita del contratto;
  - **ordine dei blocchi:**
    - spostamento: contratto → fasce (`openSlotBook`) → visita, come `moveCareVisit`;
    - accettazione: cliente → contratto → invito → accesso;
    - provati in concorrenza: il cliente insieme alla fioreria che sposta la stessa visita, alla
      fine del contratto e a un blocco della stessa fascia; due clienti per l'ultimo posto.
      Nessuno stallo, vince uno solo.
- **Revoche:**
  - «Quitar acceso» a mano;
  - quando il cliente si archivia: accessi e inviti in attesa;
  - quando il contratto finisce: gli inviti in attesa di quel contratto;
  - il lavoro giornaliero chiude gli accessi 30 giorni dopo la fine
    (`closeCarePortalAccess`, motivo `CONTRACT_ENDED`). Un accesso a tutti i contratti si chiude
    quando il cliente non ha più nulla in corso;
  - gli inviti scaduti con `app_expire_overdue()`.
  - La manutenzione giornaliera di Floral Care ora ha un tetto unico di 45 secondi (la route ne ha
    60).
- **Errori e registro:**
  - dal portale sempre 404 con un `NotFoundError` semplice: nessuna sonda fra fiorerie, come
    ADR-064;
  - dal lato fioreria, `notFound` con l'evento di sicurezza (`ProbeableEntity` aggiunge le due
    tabelle);
  - azioni nel registro: `care.portal_invited`, `care.portal_invite_revoked`,
    `care.portal_access_granted`, `care.portal_access_revoked`, `care.visit_moved_by_customer`;
    mai l'email nei metadati.
- **Dati:**
  - migrazione `care_portal`, con soli enum nuovi (`CarePortalInviteStatus`,
    `CarePortalRevokeReason`);
  - tabelle `CarePortalInvite` e `CarePortalAccess` con RLS, FK composite verso cliente e
    contratto, la persona in FK verso `User` (ON DELETE CASCADE: chi elimina il conto perde il
    collegamento);
  - indici unici parziali: un invito in attesa per cliente ed email, un accesso attivo per persona
    e ambito; CHECK sugli stati;
  - colonne nuove: `CustomerSubscription.minNoticeHours` e `CareVisit.customerMovedAt`.
- **Dati della persona e della fioreria:**
  - «Descargar mis datos» (ADR-064) aggiunge gli accessi (`floralCare.accesses`);
  - lo ZIP della fioreria (ADR-079) aggiunge `floral_care_accesos.csv` (inviti e accessi, con lo
    stato vero anche prima del lavoro notturno);
  - eliminando il conto, l'accesso sparisce.

**PROPOSTO dal piano** (il founder ha approvato il piano; da confermare guardandolo in staging):

1. **Inviti:** solo da un contratto confermato; di default «Solo este contrato»; «Reenviar» crea un
   link nuovo.
2. **«Cambiar fecha»:**
   - solo visite regolari programmate;
   - nessun limite al numero di cambi;
   - il preavviso del contratto (24 h di default) vale per l'ora attuale e per la nuova.
3. **Avviso alla fioreria:** un'email subito a proprietari e gerenti per ogni cambio del cliente
   (solo LIVE). Il riassunto del 5b è solo per i messaggi.
4. **Piano:** il portale funziona qualunque sia il piano della fioreria, come i cargos (ADR-082).
   Invitare chiede Floral Care, oggi acceso per tutti.
5. **Lingue:**
   - pagine del portale nella lingua scelta dalla persona;
   - email ai clienti e alla fioreria nella lingua del mercato;
   - la pagina dell'invito segue la regola di tutte le pagine (ADR-042): la scelta della persona,
     altrimenti es-MX.
   - Il piano proponeva la lingua della fioreria quando la persona non ha scelto. Fatto solo lì,
     login e registrazione resterebbero in es-MX e la persona vedrebbe due lingue di seguito.
     Oggi il solo mercato aperto è il Messico, quindi il risultato è lo stesso. La lingua di
     default per mercato va fatta per tutte le pagine senza scelta quando apre il mercato
     italiano.
6. **Soldi nel portale:**
   - cargos per contratto, senza referencias né note;
   - nessun estado de cuenta unico delle sedi;
   - i termini mostrati sono il testo attuale della fioreria, non una copia di quando si è firmato.
7. **Resoconti per email:** vanno ancora all'email del cliente nel CRM, non alle persone del
   portale.

- **Fuori dal blocco:** il cliente che vede i giorni bloccati prima di sceglierli (oggi le fasce
  bloccate semplicemente non compaiono).

#### 5b — Messaggi fra cliente e fioreria (25/11/2026)

Chiesto dal founder ("ok vai col 5b") dopo il rilascio del 5a; valgono le decisioni 3 e 4 qui sopra
e il piano (`docs/FLORAL_CARE_PLAN.md` §1: "il fiorista riceve un riassunto dei messaggi, non
un'email per ognuno").

**Come funziona:**

- **Un filo per contratto**, testo (fino a 2000 caratteri) e al massimo una foto per messaggio:
  - **fioreria:** la card «Mensajes» nella pagina del contratto (ancora `#mensajes`, gli ultimi
    30 messaggi e «Ver mensajes anteriores»), la scheda «Mensajes (N)» accanto a Contratos e Cobros
    con i fili (prima quelli da leggere) e il riquadro «Mensajes sin leer» nel pannello, solo se ce
    ne sono. Permesso nuovo `care:messages` per tutti i ruoli (decisione 3), poi
    `requireEntitlement(ctx, 'floralCare')`; «Cobros» resta a chi gestisce i soldi;
  - **cliente:** la sezione «Mensajes con …» nella pagina del contratto di Mi Floral Care, subito
    dopo le prossime visite; i messaggi nuovi nell'elenco e nella card di «Mi cuenta»;
  - si scrive solo con il contratto attivo o in pausa; dopo, il filo si legge e basta (per il
    cliente finché vede il contratto, 30 giorni);
  - lo stesso invio ripetuto (doppio clic, rete lenta) non scrive due messaggi: chiave `submitKey`
    unica per fioreria; i file di un doppione si cancellano subito.
- **Letto / nuovo:**
  - per la fioreria un messaggio del cliente è letto quando qualcuno della squadra apre il filo
    (`readByShopAt`, uno per tutti);
  - per la persona del cliente sono nuovi i messaggi della fioreria dopo la sua ultima lettura
    (`CarePortalRead`, uno per persona e contratto);
  - il segno parte da un piccolo componente client dopo il caricamento, mai durante il render; la
    pagina non si ricarica, così il separatore «Sin leer» / «Nuevos» resta finché si legge.
- **Foto:** la stessa catena delle foto delle visite (ridotta nel browser, ricodificata senza EXIF
  sul server, chiavi `tenants/<id>/care-photos/…`, route private: la fioreria da
  `subscriptions/[id]/messages/photos/[photoId]`, il cliente dalla route del 5a). Chi gestisce i
  contratti (`subscriptions:write`) può togliere la foto di un messaggio: il file si cancella
  subito, il testo resta, il registro ha `care.message_photo_removed`. A fine contratto + 30 giorni
  si cancellano con le altre foto (eccezione di ADR-078, CLAUDE.md §5).
- **Avviso al cliente** (decisione 4): quando la fioreria scrive, al massimo un'email al giorno per
  contratto (`CareEmail` di tipo `MESSAGE_NOTICE`, indice unico per contratto e giorno nel fuso
  della fioreria), una per ogni persona con accesso attivo. Dice solo "{fioreria} te escribió" con
  il link al contratto, mai il testo; mittente il nome della fioreria, risposta al suo contatto;
  solo da una fioreria LIVE, nella lingua del mercato. Senza nessuna persona con accesso, nessun
  avviso (la card lo dice e rimanda a «Acceso del cliente»). Parte dopo il commit con il tetto
  comune di 8 secondi; se non parte la riprova il lavoro delle email di Floral Care.
- **Riassunto alla fioreria:** dal lavoro giornaliero (`sendCareMessageDigests` dentro
  `runCareMaintenance`), un'email a proprietari e gerenti: "N mensajes sin leer en M contratos",
  con il link a «Mensajes» e senza testi. Parte solo se è arrivato un messaggio del cliente dopo
  l'ultimo riassunto mandato, una volta al giorno per fioreria (`CareMessageDigest`, unico per
  giorno: la manutenzione può girare più volte), solo LIVE, fino a 3 tentativi; la riga nasce già
  "in invio" prima di mandare, quella ferma da un'ora si chiude come fallita (forse è partita: non
  si rimanda). Al massimo 20 fiorerie e 10 secondi per giro.
- **Portale nel database** (estende la modalità del 5a, sempre in `withPortalContext`):
  - `portal_read` su `CareMessage` (il contratto aperto) e su `CarePortalRead` (solo le righe della
    persona);
  - `portal_insert` (FOR INSERT, permissiva) su `CareMessage`: solo un messaggio `CUSTOMER` della
    persona stessa, sul contratto e cliente del portale, non letto, con il contratto attivo o in
    pausa; su `CarePhoto`: solo la foto di un proprio messaggio, senza visita né pianta;
  - il segno di lettura con la SECURITY DEFINER `app_portal_mark_read()` (persona e contratto solo
    dal contesto del portale);
  - nessun UPDATE né DELETE dal portale: i messaggi non si modificano né si cancellano;
  - `app_buyer_care_contracts()` aggiunge i nuovi per contratto; `app_buyer_care_messages()` dà a
    «Descargar mis datos» i messaggi scritti dalla persona; `app_care_message_digests_due()` dà al
    lavoro solo gli ID delle fiorerie a cui tocca il riassunto.
  - CLAUDE.md §4.3 lo dice: il portale scrive solo «Cambiar fecha», i messaggi, le loro foto e il
    segno di lettura.
- **Dati:**
  - due migrazioni: `care_messages_enum` (solo `ALTER TYPE "CareEmailKind" ADD VALUE
'MESSAGE_NOTICE'`, che Postgres non lascia usare nella stessa transazione, come ADR-083) e
    `care_messages`;
  - tabelle `CareMessage`, `CarePortalRead`, `CareMessageDigest` con RLS; `CareMessage` ha la FK
    composita verso contratto e cliente, l'autore in FK verso `User` ON DELETE SET NULL, CHECK
    "testo o foto", testo ≤ 2000, "letto" solo sui messaggi del cliente;
  - `CarePhoto.messageId` (una foto per messaggio) e la CHECK riscritta: foto di un messaggio → né
    visita né pianta, altrimenti visita o pianta come prima;
  - `CareEmail.noticeDay` e la CHECK per tipo (resoconto: solo visita; blocco: solo blocco;
    messaggio: solo giorno).
- **Export, dati della persona, conto eliminato:**
  - lo ZIP della fioreria aggiunge `floral_care_mensajes.csv` (data, contratto, cliente, chi ha
    scritto, testo, foto sì/no, letto il);
  - «Descargar mis datos» aggiunge `floralCare.messages` (fioreria, contratto, data, testo, foto),
    senza ID interni;
  - chi elimina il conto perde accessi e segni di lettura; i suoi messaggi restano alla fioreria
    senza nome («Cuenta eliminada»), lo dice il dialogo di «Eliminar mi cuenta».
- **Errori:** dal portale sempre 404; dal lato fioreria un contratto o un messaggio di un'altra
  fioreria passa da `notFound` con l'evento di sicurezza; codici nuovi `care_message_empty`,
  `care_message_closed`, `care_message_daily_limit`.

**PROPOSTO nel 5b** (da confermare guardandolo in staging):

1. Il cliente scrive con il contratto attivo o in pausa; a contratto finito il filo è in sola
   lettura per tutti e due.
2. I messaggi non si modificano né si cancellano; chi gestisce i contratti può togliere la foto di
   un messaggio.
3. Per la fioreria un messaggio è letto quando qualcuno della squadra apre il filo.
4. Il cliente vede chi della fioreria ha scritto, come nei resoconti.
5. L'avviso al cliente parte solo se qualcuno ha accesso; il riassunto solo se c'è qualcosa di
   nuovo, e va a proprietari e gerenti (lo staff vede i non letti nell'app).
6. Limiti: 2000 caratteri, una foto, 30 messaggi al giorno per persona del cliente e contratto (la
   squadra della fioreria non ha un tetto).

- **Non fatto:** la risposta all'avviso per email entra nel filo (oggi arriva al contatto della
  fioreria, fuori dall'app), notifiche push, allegati diversi dalle foto, ricerca nei messaggi. Le
  consultas a pagamento sono del blocco 6.

### ADR-085 — Floral Care, blocco 6: Asistente de plantas per i clienti, con i crediti della fioreria — IN CORSO (25/11/2026)

**Cambio del 25/11 pomeriggio (founder, dopo la prova pagata), che prevale su quanto segue:**

- l'assistente è per i **clienti della fioreria**, in Mi Floral Care, durante il Floral Care, quando
  il fiorista non c'è. Il fiorista non lo usa: la consulta del fiorista del 6a si toglie;
- Gardelia vende **crediti alla fioreria**: 1 credito = 1 risposta (l'analisi della foto è compresa
  nella prima domanda), 100 crediti = 199 MXN (IVA da validare), comprati come i crediti delle
  immagini (WhatsApp, poi accredito della piattaforma, D-29);
- la fioreria dà crediti a un contratto quando vuole e li rivende come vuole (servizio suo, con il
  suo prezzo); non scadono finché il contratto è attivo; a fine contratto quelli non usati tornano
  alla fioreria;
- niente pagamenti dei clienti a Gardelia: il 6c (Stripe per i clienti) non si fa e D-26 resta
  intatta;
- **mix dei modelli** (dati della prova in `docs/AI_BENCHMARK.md`): riconoscimento della foto con
  Opus 5.5, risposte di cura con Haiku 5.5, risposte su un problema con Opus 5.5; niente Sonnet;
- budget di piattaforma, come rete di sicurezza: 2 USD fino al 1° dicembre, poi 10 USD al mese;
- prompt v2 dopo la prova: luce bassa «tollera poca luce, ma cresce meglio con luce indiretta
  brillante» (non più «lontano dalle finestre»), pubblico = il cliente, «tú», risposte più brevi,
  piante in terra o in fioriera.

**Il 6b com'è fatto (25/11; su staging con il via libera del founder, merge `5142e81`):**

- **Crediti della fioreria:**
  - comprati da Gardelia: `AiCreditGrant` con `PLANT_ASSISTANT`, accreditati dall'operazione di
    piattaforma (`platform:grant-ai-credits --feature plant-assistant`, nel workflow «Operazioni di
    piattaforma» l'operazione `grant-assistant-credits`), registro `ai_credits.assistant_granted`;
  - «Dar créditos» a un contratto attivo o in pausa, da 1 a 500 per volta, fino al saldo della
    fioreria, in fila con un lock per fioreria (mai sotto zero); permesso `care:assistant`, ora solo
    proprietario e gerente (costano soldi alla fioreria); registro `care.assistant_credits_given`
    con il numero del contratto e quanti;
  - `AssistantCreditAllocation`, solo inserimenti: `GIVE` positivi, `RETURN_ENDED` negativi; saldi
    sempre calcolati (fioreria = comprati − dati; contratto = dati − risposte − riserve);
  - a fine contratto, sia con «Terminar contrato» sia con la chiusura automatica, i crediti non usati
    tornano alla fioreria (`RETURN_ENDED`), le riserve si tolgono e il registro della fine porta
    `assistantCreditsReturned`.
- **Il cliente in Mi Floral Care** (`services/my-plant-assistant.ts`, solo modalità portale):
  - la sezione «Asistente de plantas» nella pagina del contratto e la pagina
    `/cuenta/floral-care/[id]/asistente`;
  - foto (serve almeno 1 credito, ma l'analisi non lo usa) → specie candidate, quella della scheda
    della pianta per prima → «Cómo cuidarla» (modello leggero) o «Tiene un problema» (modello
    principale), proposto dalla foto (`looksUnhealthy`) o dalla specie che non si sa → la domanda →
    la risposta con cura e avviso per cani e gatti dai nostri dati;
  - prima della chiamata il database riserva 1 credito (`app_portal_assistant_reserve`, sotto lock
    del contratto, scade dopo 2 minuti); la risposta lo usa nella stessa transazione che la salva;
    un errore, un rifiuto o il contratto chiuso nel frattempo lo rendono, e la chiamata si registra
    lo stesso (va nel budget);
  - ogni persona vede solo i propri casi e le proprie risposte; i crediti sono del contratto,
    condivisi fra le persone del cliente;
  - tetto: 10 foto e 10 risposte al giorno per contratto (giorno della fioreria), contate dal
    database (`app_portal_assistant_credits(since)`), perché il portale vede solo le sue righe;
  - «Enviar a la florería»: un messaggio della persona nel filo del 5b, con una copia della foto e il
    riassunto (pianta, specie, domande, risposte) nella lingua della persona; lo stesso caso con le
    stesse risposte si manda una volta sola;
  - «Pedir consultas» / «Pedir más consultas»: un messaggio alla fioreria, una volta al giorno per
    persona;
  - le consultas in «Descargar mis datos» (`app_buyer_assistant_answers()`).
- **La fioreria:**
  - card «Asistente de plantas» nella pagina del contratto: dati, usati, rimasti, «Dar créditos»,
    l'avviso se nessuno del cliente entra in Mi Floral Care; lo staff vede ma non dà;
  - card in Ajustes → Floral Care: comprati, dati, disponibili, «Comprar créditos por WhatsApp»
    (`PLATFORM_WHATSAPP`); nessun prezzo nel codice (D-16/17);
  - vede quante consultas usa un contratto, non le domande: solo quelle che il cliente le manda.
- **Database:** policy `portal_read` e `portal_insert` su casi e risposte (solo i propri, contratto
  attivo o in pausa), `portal_insert` sulle chiamate, tre funzioni DEFINER per i crediti del
  portale; nessun `withSystemContext` nuovo (CLAUDE.md §4.3 e §4.8).
- **Modelli:** `ASSISTANT_MODEL` (Opus 5.5: foto e problemi) e `ASSISTANT_CARE_MODEL` (Haiku 5.5:
  cura); prompt v2 con la riga del tipo di domanda.
- **Tolto:** la consulta del fiorista del 6a (pagina, link sulle piante e nella visita, E2E).

**PROPOSTO nel 6b** (da confermare guardandolo in staging): la fioreria vede solo quante consultas;
10 foto e 10 risposte al giorno per contratto; solo proprietario e gerente danno crediti; crediti
usabili con il contratto attivo o in pausa; il tipo di domanda proposto dalla foto; «Pedir más
consultas» una volta al giorno.

**DA VALIDARE (6b):** l'IVA sul prezzo dei crediti (contador); i termini per la fioreria (crediti,
prezzo, rivendita a suo carico); l'aviso de privacidad (foto e domande dei clienti ad Anthropic,
Stati Uniti, come fornitore).

Quello che segue descrive il 6a com'è stato rilasciato su staging (spento); il 6b lo sostituisce
dove sono in contrasto.

Blocco 6 del piano approvato (`docs/FLORAL_CARE_PLAN.md` §4, §7.6), chiesto dal founder ("ok vai col
blocco 6"), in tre rilasci: **6a** dati delle piante, motore, prova pagata e assistente del fiorista;
**6b** l'assistente in Mi Floral Care con le consultas incluse e «Enviar a la florería»; **6c**
l'acquisto di consultas con Stripe Checkout in modalità di prova. 6b e 6c hanno ciascuno un piano di
dettaglio da approvare prima di partire.

**Decisioni del founder (25/11/2026):**

1. **Foto della prova:** solo foto a licenza libera (Wikimedia Commons).
2. **Modelli della prova:** Opus 5.5, Sonnet 5.5 e Haiku 5.5, con un tetto di 15 USD.
3. **Consultas del fiorista:** le paga Gardelia, al massimo 20 al giorno per fioreria, dentro un
   budget mensile che fissa il founder.
4. **Consultas dei clienti (6b–6c):** la fioreria sceglie quante includerne al mese per contratto
   (0–10, 3 di default), pagate da Gardelia nella fase di prova; finite quelle, il cliente compra le
   sue con la carta.

**Come funziona (6a):**

- **Dati delle piante:**
  - 19 piante d'interno nuove (91 specie in tutto, 36 piante in vaso), DA VALIDARE da un fiorista
    sul foglio di revisione;
  - `CanonicalFlower.care` (Json, schema `plantCareSchema` del dominio), obbligatorio per le piante
    in vaso: luce, acqua, umidità qualitative e mai intervalli fissi (spec §5.7);
  - tossicità per cani e gatti (`TOXIC | MILD | NON_TOXIC | VARIES`) dalla lista dell'ASPCA, con la
    fonte e `reviewed: false` finché un fiorista o un veterinario non la conferma.
- **Tabelle, solo inserimenti** (così il portale del 6b ci scrive con policy `portal_insert`):
  - `AssistantCase`: la foto di una pianta di un contratto (pianta e visita facoltative), le specie
    candidate, ciò che si vede, chi ha chiesto e da dove;
  - `AssistantAnswer`: domanda, specie confermata (o «No sé»), risposta breve e passi;
  - `AssistantCall`: ogni chiamata al modello con token, costo in micro-USD, durata, esito e codice
    d'errore (mai il testo del fornitore);
  - RLS su tutte e tre, FK composite, CHECK su lunghezze e chiavi delle foto.
- **Motore** (`packages/core/src/ai/plant-assistant/`):
  - `ClaudePlantAssistant` è l'unico punto con `@anthropic-ai/sdk` (versione fissata): output
    strutturato con schemi Zod, effort basso, sistema in cache (la lista delle piante è uguale per
    tutti, in es-MX), timeout 45 s con un nuovo tentativo, fallback lato server sui rifiuti;
  - il costo si calcola dai token veri di `usage` (anche passaggio per passaggio con il fallback),
    col listino verificato sulla pagina dei prezzi il 25/11/2026;
  - `SimulatedPlantAssistant` solo in locale e nei test, etichettato «Simulación» nella pagina;
  - configurazione: `ASSISTANT_PROVIDER` (`none | simulated | anthropic`), `ANTHROPIC_API_KEY`,
    `ASSISTANT_MODEL`, `ASSISTANT_MONTHLY_BUDGET_USD` (`docs/CONFIGURATION.md`).
- **Regole della risposta** (nel prompt e nell'interfaccia):
  - breve (circa 120 parole, al massimo 5 passi), nella lingua di chi chiede;
  - mai dosi, concentrazioni, miscele o marche di prodotti chimici; mai calendari fissi;
  - nessuna frase sulla tossicità: l'avviso per cani e gatti viene SOLO dai nostri dati, con la fonte;
  - se non è sicuro lo dice («revisa la planta en persona»);
  - ogni risposta porta «Respuesta generada con IA: revísala antes de actuar».
- **Servizi** (`services/plant-assistant.ts`, permesso `care:assistant` per tutti i ruoli, poi
  `requireEntitlement(ctx, 'floralCare')`):
  - una consulta è una risposta: il riconoscimento della foto è compreso; «Otra pregunta» sullo
    stesso caso è una consulta in più (al massimo 3 per foto); un errore o un rifiuto non si conta;
  - prima della chiamata si controllano il tetto del giorno (20 risposte e 40 foto per fioreria,
    giorno nell'ora della fioreria) e il budget del mese (`app_assistant_spend_since`, DEFINER, su
    tutta la piattaforma); la chiamata avviene fuori dalle transazioni;
  - le foto seguono la catena delle foto delle visite (`normalizeUploadedPhoto`, chiavi
    `tenants/<id>/care-photos/…`); al modello va una copia di al massimo 1092 px; si cancellano con
    le foto del contratto (fine + 30 giorni), il testo resta;
  - registro `care.assistant_answered` senza testi; nei log solo ID, modello, token e costo.
- **Interfaccia del fiorista** (`subscriptions/[id]/assistant`, segmento in inglese come gli altri
  percorsi della fioreria):
  - foto (fotocamera o galleria, ridotta nel browser) → «¿Es alguna de estas?» con le candidate (la
    specie della scheda per prima), «Otra» dall'elenco o «No sé» → «¿Qué le pasa?» → la risposta con
    i passi, i cuidados e l'avviso per cani e gatti dai nostri dati;
  - contatore «Hoy: N de 20 consultas de la florería», limite e budget con un messaggio chiaro;
  - link: la card «Asistente de plantas» del contratto (con le ultime consultas), l'icona su ogni
    pianta, «Preguntar al asistente» sulle piante «Atención» o «Problema» della visita;
  - senza assistente configurato i link non compaiono (CLAUDE.md §2);
  - la foto passa da una route privata (`privateImageRoute`), del contratto del percorso.
- **Nessun `withSystemContext` nuovo:** CLAUDE.md §4.8 non cambia.

**La prova pagata (prima di accendere l'assistente su staging):**

- circa 50 foto da Wikimedia Commons (licenze CC0, CC BY, CC BY-SA, pubblico dominio), più alcune
  piante fuori dalla lista; restano fuori dal repo, con il manifest delle fonti;
- script `packages/core/scripts/assistant-benchmark.ts`: stesso adattatore e stessi prompt
  dell'app, riconoscimento senza indizi e risposta con la specie giusta per Opus 5.5, Sonnet 5.5 e
  Haiku 5.5, un giudice con una griglia (Opus 5.5, effort alto) e un tetto di 15 USD;
- resoconto in `docs/AI_BENCHMARK.md`; il founder sceglie il modello e il budget mensile. Fino ad
  allora valgono Opus 5.5 e 20 USD al mese.

**PROPOSTO** (da confermare guardandolo in staging): la definizione di consulta; le 19 piante nuove;
i dati di cura qualitativi e la tossicità ASPCA; risposta breve; effort basso e foto ridotta; lo
staff usa l'assistente come gli altri ruoli; la risposta nella stessa richiesta (fino a ~20 s).

**DA VALIDARE con professionisti:** i dati di tossicità (fiorista o veterinario); l'aviso de
privacidad (foto e domande vanno ad Anthropic, Stati Uniti, come fornitore); per il 6c la vendita
di consultas ai consumatori in Messico (SAT, IVA, CFDI, PROFECO, chi incassa: O-02).

**Decisioni del founder del 25/11 sera (da fare nel rilascio 2, aggiornano «la rivende come vuole:
niente codice nuovo»):**

- l'assistente si sceglie fra i servizi del contratto e il cliente vede quante domande riceve e
  quanto costano altre;
- **DECISO:** domande comprese **ogni mese**, nel numero deciso dal fiorista nelle Impostazioni;
  quelle non usate restano finché il contratto è attivo e alla fine tornano alla fioreria;
- **DECISO:** altre domande: il cliente **chiede** un pacchetto, il fiorista **approva**; i crediti
  escono dal saldo della fioreria e il costo va nel prossimo addebito del cliente (paga la
  fioreria, mai Gardelia: D-26);
- **DECISO:** il pacchetto (quante domande e prezzo) lo decide il fiorista, es. 100 per 299 MXN
  sopra i 199 MXN che paga a Gardelia; nessun prezzo di Gardelia nel codice (D-16/17);
- **DECISO:** le domande comprate e non usate **non si rimborsano** a fine contratto, e il cliente
  lo legge prima di chiederle. **DA VALIDARE** con l'avvocato (PROFECO) e nei termini della
  fioreria; IVA della rivendita con il contador della fioreria.

### ADR-086 — Marketplace completo: il giro di chi compra e di chi vende — IN CORSO (25/11/2026)

- **Perché:** il founder, provando staging, trova la parte del cliente «scarna»: vuole che il
  cliente scelga ramos e fiori, crei il suo ramo, chieda i servizi della fioreria (Floral Care è
  uno) e che ordini e prenotazioni arrivino al fiorista, che approva; tutto nell'app (D-30).
- **Studio:** `docs/MARKETPLACE_FLOWS.md`, fatto leggendo pagina per pagina il codice di chi compra e
  del fiorista: per ogni passo oggi, manca, proposta. Fra i fatti: l'ordine online con accettazione
  esiste già (ADR-067) ma si vede solo con «Ordini online» acceso; dopo l'accettazione il cliente
  non riceve avvisi e parla con la fioreria solo su WhatsApp; i cambi del fiorista non arrivano al
  cliente; due errori (telefono del cliente online perso se l'email esiste già, canale «online»
  cancellato modificando il cliente).
- **Decisioni del founder (25/11):** prezzo di Floral Care subito dalle piante dichiarate, con
  correzione alla prima visita accettata dal cliente; pagamento diretto (D-26); servizi predefiniti
  Floral Care, Eventi e matrimoni, Decorazione di locali, Fiori ogni settimana, più quelli del
  fiorista; «Disegna il tuo ramo» dopo servizi e Floral Care. I rilasci 2 e 3 del feedback sul
  contratto (assistente fra i servizi, date scelte a mano) entrano in M6.
- **Blocchi, in ordine:** M0 correzioni; M1 vetrina che vende; M3 ordine tutto nell'app (messaggi,
  avvisi, cambi accettati dal cliente, prova di pagamento); M5 servizi e richieste con preventivo;
  M6 Floral Care prenotabile; M2 opzioni ed extra; M9 Disegna il tuo ramo; M4 calendario e
  capienza; M8 clienti, marketing e report; M7 Fiori ogni settimana come abbonamento.
- **PROPOSTO:** «Lavori della visita» al posto di «Servizi» in Floral Care; richieste e
  prenotazioni non tengono posti finché il fiorista non accetta; pagine pubbliche indicizzate solo
  in produzione.
- **DA VALIDARE:** termini per i consumatori (PROFECO), aviso de privacidad per le foto della prova
  di pagamento e delle piante, fatture della fioreria al cliente.
- **M0 fatto (25/11):** telefono dell'ordine salvato sul cliente che non ne aveva uno, mai
  sovrascritto; canale `online_store` fra quelli del cliente; testi della home, del negozio e del
  pannello «Da accettare»; errore accanto al prodotto non più disponibile; conferma per accettare
  con la consegna a 0; pagina del prodotto tolto; link di stato fino a 30 giorni dopo la consegna,
  allungato se la consegna si sposta. Dettagli in `docs/MARKETPLACE_FLOWS.md` §4.
- **Stato (28/11):** M0, M1 (ADR-087) e M3 (ADR-088: M3-1, M3-2, M3-3 e la revisione di tutto il
  blocco) su staging; M5 «Servizi in vetrina e richieste» in corso (ADR-089: M5-1 sul ramo di
  lavoro, poi M5-2 e la revisione di tutto il blocco), poi M6, M2, M9, M4, M8, M7.

### ADR-087 — Marketplace M1: la vetrina che vende — FATTO (M1-1 e M1-2 su staging, 25/11/2026)

- **Perché:** blocco M1 del giro del marketplace (ADR-086), piano approvato dal founder il 25/11:
  la pagina della fioreria era scarna (al massimo 120 prodotti per nome, niente categorie,
  ricerca, evidenza, pagine; miniature che non si aprivano; carrello perso cambiando pagina).
- **Due rilasci:** M1-1 «Vetrina e prodotto» (chi compra, più gli strumenti del fiorista che
  servono); M1-2 «Strumenti e visibilità» (link, QR e anteprima; Catalogo con filtro e accensione
  insieme; schede della ricerca; Google; occasioni).
- **Vetrina (M1-1):** le regole stanno in `packages/domain/src/storefront.ts` (`planStorefront`):
  il core legge le righe leggere di tutti i prodotti online e poi i dettagli dei soli prodotti
  da mostrare. Schede per tipo, ricerca senza accenti, ordini (consigliati, prezzo, nome) con gli
  esauriti in fondo, pagine da 24, riga «Destacados» (al massimo 8, solo prima pagina senza
  filtri, mai esauriti, non ripetuti nella griglia). Testata: ordini online, primo giorno
  ordinabile che salta i giorni chiusi (`firstOrderableDate`, usato anche dal modulo d'ordine),
  riassunto del costo (mai «gratis» per un costo a 0), ritiro.
- **Carrello:** cookie per fioreria (`gardelia_cart`, percorso `/f/<slug>`, 30 giorni, solo ID e
  quantità, al massimo 20 prodotti). Sopravvive a login e registrazione; il modulo d'ordine lo
  riconcilia nel contesto della fioreria (prodotti ordinabili, avviso per quelli tolti) e lo
  svuota dopo l'invio. Prezzi e disponibilità li decide sempre il server.
- **Strumenti del fiorista:** stella «In evidenza» (`CatalogItem.featuredAt` con CHECK: solo
  online e attivo; tolta in ogni uscita dal negozio; lock per fioreria contro il nono),
  «Usa come copertina» e frecce sulle foto (vale anche nel Diseñador), tre politiche della
  fioreria (cambi, cancellazioni, sostituzioni) mostrate nella vetrina e nel riepilogo,
  limite di 500 prodotti online (niente tagli silenziosi).
- **«Completa la tua vetrina» (M1-2):** `storeReadiness` in `packages/domain/src/online-store.ts`,
  otto passi calcolati dai dati che ci sono (logo e copertina, presentazione, almeno 8 prodotti
  online, una foto su ognuno, un prodotto in evidenza, costo di consegna, forme di pagamento,
  politiche), ognuno con il link al punto dove si fa. Non blocca la pubblicazione.
- **Catalogo (M1-2):** filtro «Negozio online» (sì, no fra i tipi vendibili, online senza foto) e
  fino a 20 prodotti accesi o spenti insieme (`setCatalogItemsOnline`). Archiviati e materiali si
  saltano e si contano; vale il limite dei 500 sotto lo stesso lock; spenti perdono la stella; una
  riga del registro per prodotto; un ID di un'altra fioreria respinge tutto (404 con l'evento).
- **Link, QR e anteprima (M1-2):** il link si vede sempre e il QR si scarica in PNG, disegnato nel
  browser con il componente che c'era già. L'«Anteprima» (solo proprietario e gerente) usa le
  stesse viste della pagina pubblica (`StorefrontView`, `ProductView` con link pubblici o
  dell'app) e le stesse letture (`readStoreHeaderTx`, `readStorefrontTx`, `readStoreItemTx`) nel
  contesto della fioreria con la sua RLS: nessuna funzione DEFINER nuova. Foto dalle pagine
  private, pulsanti d'ordine spenti.
- **Ricerca delle fiorerie (M1-2):** `app_public_store_directory` rifatta con ordini online,
  anticipo, giorni chiusi, fuso, valuta, costo e fasce, occasioni dei prodotti online: solo dati
  che la vetrina mostra già. Le schede dicono «Pedidos en línea» o «Pedidos por WhatsApp», il
  primo giorno e il costo, preciso per l'indirizzo cercato (`directoryFee`).
- **Google (M1-2):** `PUBLIC_INDEXING`, spento di default, da accendere solo nel progetto di
  produzione. Da acceso si indicizzano home, `/floristas`, la vetrina intera e i prodotti; le viste
  filtrate e le pagine dopo la prima sono `noindex, follow` con il canonico alla vetrina.
  `robots.txt` e `sitemap.xml` (DEFINER `app_public_sitemap`: fiorerie attive e pubblicate,
  prodotti online e attivi; una vetrina senza prodotti resta fuori); dati strutturati schema.org
  (Florist, Product) con `<`, `>`, `&` scritti come `\u…`. Da spento, `robots.txt` chiude tutto.
- **Occasioni (M1-2):** `CatalogItem.occasions` con 9 identificativi in inglese (CHECK),
  nell'indirizzo il nome spagnolo (`?ocasion=cumpleanos`). Voce «Occasioni» nella scheda del
  prodotto (assente dal modulo = invariata), chip nella vetrina con i conteggi, scorciatoie nella
  home e nella ricerca, che apre la vetrina già filtrata.
- **Testata della vetrina (M1-2):** «Mis pedidos» per chi ha il conto, «Entrar» per gli altri, con
  il ritorno alla pagina; le pagine della vetrina contano come percorsi di chi compra per login e
  registrazione.
- **PROPOSTO (da confermare dal founder):**
  - carrello in un cookie per fioreria di 30 giorni;
  - 8 prodotti in evidenza e 500 online;
  - politiche in tre testi della fioreria, senza testi legali di esempio;
  - gli 8 passi di «Completa la tua vetrina», con almeno 8 prodotti online;
  - le 9 occasioni e i loro nomi nelle tre lingue;
  - Google acceso solo in produzione;
  - fino a 20 prodotti alla volta; QR in PNG;
  - «Mis pedidos / Entrar» nella testata della vetrina;
  - cache delle foto sulla rete di Vercel come decisione a parte (non in M1).
- **DA VALIDARE:** politiche verso i consumatori (PROFECO), scritte dalla fioreria; il cookie del
  carrello nell'aviso de privacidad §7 (bozza aggiornata); dati di cura e tossicità (già «da
  rivedere»). M1-2 non aggiunge cookie né dati personali nuovi.

### ADR-088 — Marketplace M3: l'ordine tutto nell'app — FATTO (M3-1 e M3-2 su staging il 26/11, M3-3 e la revisione il 28/11/2026)

- **Perché:** blocco M3 del giro del marketplace (ADR-086), piano di dettaglio approvato dal
  founder il 26/11: «basta WhatsApp e email avanti e indietro». Tre rilasci, ognuno con test, CI
  verde e staging col via libera: M3-1 «Messaggi e avvisi», M3-2 «Cambi da confermare» (cambi su
  un ordine da accettare confermati da chi compra, domande «sì / no», «Proponi un'altra data»),
  M3-3 «Soldi e squadra» (prova di pagamento, dati per pagare dopo l'accettazione, rimborso,
  contanti del fattorino, stampa del giorno, accettazione per lo staff).
- **Chi compra entra da un solo punto:** `withBuyerOrder` (`packages/core/src/buyer-orders.ts`).
  La fioreria la dà `app_buyer_order_shop(ordine)` (DEFINER, solo per gli ordini della persona,
  utente dal contesto); poi il contesto della fioreria con `app.buyer_order_id`
  (`withBuyerOrderContext`), e le policy RESTRICTIVE `buyer_order_guard` su `Order`, `OrderLine`,
  `OrderPayment`, `OrderStatusEvent`, `OrderPhoto`, `PublicLink`, `OrderMessage`,
  `OrderBuyerRead` e `OrderNotice` lasciano toccare solo le righe di quell'ordine, anche sbagliando
  il codice. Proprietario e fioreria attiva si ricontrollano (sotto lock quando si scrive). Un
  ordine di un altro risponde 404, senza sonda fra fiorerie (la persona non è un membro). Lo usa
  anche «Cancelar pedido», che perde il tetto dei 100 ordini di `app_buyer_orders`.
- **La pagina dell'ordine nel conto** (`/cuenta/pedidos/<id>`): la stessa lettura del link di stato
  (`readCustomerOrderTx`) e la stessa vista (`OrderTracking`), nella lingua della persona; immagini
  da rotte del conto (non dipendono dal link, che può scadere). «Mis pedidos» apre questa pagina,
  con «N mensajes nuevos». Il link di stato resta com'era, senza messaggi (si inoltra), con il
  rimando al conto.
- **Messaggi** (`OrderMessage`): un filo per ordine online; testo fino a 2000 caratteri e al massimo
  una foto (la catena di Floral Care: ridotta nel browser, ricodificata senza EXIF, chiavi sotto
  `tenants/<id>/order-messages/` con CHECK, rotte private), `submitKey` unica contro i doppi invii,
  30 al giorno da chi compra (la squadra senza tetto). Si scrive dall'invio fino a 7 giorni dopo
  consegna, ritiro o annullamento, poi si legge e basta. Letto: per la fioreria `readByShopAt`
  quando qualcuno della squadra apre l'ordine (dopo il caricamento); per chi compra
  `OrderBuyerRead`. Permesso nuovo `orders:messages` per tutti i ruoli, come Floral Care; «Togli la
  foto» con `orders:write`. Filo e modulo sono componenti comuni con Floral Care
  (`apps/web/src/components/messages`).
- **Avvisi dei messaggi (PROPOSTO):** un'email all'altra parte al primo messaggio da leggere, poi al
  massimo una ogni 6 ore finché non legge (`shouldSendMessageNotice`, `OrderNotice`
  `MESSAGE_TO_SHOP` / `MESSAGE_TO_BUYER`), mai con il testo, dopo il commit. Il piano del 25/11
  diceva «riassunto giornaliero come Floral Care»: per un ordine che si consegna domani è troppo
  lento. Floral Care resta com'è.
- **Email dei passi (PROPOSTO):** «Estamos preparando tu pedido», «listo para recoger» (solo per il
  ritiro, con l'indirizzo del negozio), «va en camino», «Entregamos tu pedido»; niente per
  «Recogido». Una sola volta per ordine e tipo (`OrderNotice` unica per ordine e tipo): un passo
  indietro e di nuovo avanti non la rimanda. Portano al link di stato; quelle dei messaggi alla
  pagina del conto (`#mensajes`).
- **Cambi dopo l'accettazione:** in «Cambia consegna e biglietto» la casella «Avvisa il cliente per
  email», già spuntata, manda «Cambió tu pedido» solo se cambia qualcosa che chi compra vede; per
  prodotti e sconto (una riga alla volta) il pulsante «Avvisa il cliente dei cambi». Registro con
  `customerNotified` / `order.customer_notified`, senza testi.
- **La fioreria:**
  - «Da gestire» in cima alla Home: ordini da accettare con la prima scadenza, messaggi da leggere
    degli ordini e di Floral Care (il riquadro «Mensajes sin leer» entra qui), ognuno col suo link;
    niente se non c'è niente;
  - il numero su «Ordini» nel menu (barra laterale e barra in basso) solo per gli ordini da
    accettare e solo per chi li accetta: il layout non si ricarica a ogni cambio di pagina, quindi
    i messaggi (che cambiano spesso) stanno in «Da gestire» e sulle righe degli ordini;
  - filtro «Con mensajes por leer», segno «En línea» in Elenco, Giorno e Percorso, numero dei
    messaggi da leggere sulla riga e in cima all'ordine;
  - la scadenza nel pannello «Da accettare», nell'elenco e in «Da gestire», mostrata come l'ultimo
    minuto utile (`pendingOrderDeadlineShown`: mai «sábado, 12:00 a.m.» per la mezzanotte).
- **Email del nuovo ordine, promemoria e scadenza:** l'email ai proprietari e gerenti ha prodotti,
  zona (colonia e città, mai l'indirizzo intero), chi riceve, commenti, totale, scadenza e «Ver y
  aceptar». Il giro giornaliero manda il promemoria agli ordini che si annullerebbero prima del giro
  dopo (una volta, `EXPIRY_REMINDER`) e, quando un ordine si annulla da solo, scrive anche alla
  fioreria. Annullamento, promemoria e scadenza mostrata usano `pendingOrderDeadline`; la funzione
  SQL `app_pending_orders_to_expire` ha la stessa formula, provata contro il dominio.
- **Motivi di rifiuto pronti (PROPOSTO):** «Non abbiamo disponibilità per quel giorno», «Non
  arriviamo a quell'indirizzo», «È finito un prodotto», «Altro motivo» (testo obbligatorio); per i
  primi tre un dettaglio facoltativo. Chi compra legge la frase nella lingua del mercato più il
  dettaglio, al massimo 300 caratteri; il registro tiene `reasonCode`, mai il testo (per i report
  di M8).
- **«Pedir de nuevo» (PROPOSTO):** per un ordine consegnato, ritirato o annullato di una fioreria
  che prende ancora ordini online. `POST /f/<slug>/pedido/repetir` (stessa origine, sessione) rimette
  i prodotti del catalogo nel carrello con `mergeIntoCart` (20 prodotti, 50 pezzi) e apre il
  modulo; composizioni e voci libere non si ripetono e il modulo lo dice; quelli non più ordinabili
  li toglie con l'avviso di sempre. È una rotta della vetrina perché il cookie del carrello vale
  solo sotto `/f/<slug>`.
- **Foto cancellate (PROPOSTO, eccezione a «niente cancellazioni» come Floral Care):** i file delle
  foto dei messaggi si cancellano 30 giorni dopo consegna, ritiro o annullamento (per un ordine
  rimasto aperto, 30 giorni dopo il suo giorno), subito se tolti dalla fioreria e con la fioreria
  eliminata; testo e chiavi restano (`photoDeletedAt`). CLAUDE.md §5.
- **Dati della persona e della fioreria:** «Descargar mis datos» con i messaggi scritti dalla
  persona in tutte le fiorerie (`app_buyer_order_messages`, DEFINER); lo ZIP della fioreria con
  `pedidos_mensajes.csv`. Chi elimina il conto lascia i messaggi alla fioreria senza nome («Cuenta
  eliminada») e il filo si chiude.
- **Correzione insieme:** nei Report e in `pagos.csv` uno storno contava al contrario (nel database
  è già negativo e il codice lo cambiava di segno un'altra volta).
- **M3-2 «Cambi da confermare» (su staging, 26/11, merge `90645bd`):**
  - **Com'era e com'è** (`OrderChangeRequest`, una per ordine, RLS e guardia di chi compra nella
    stessa migrazione): il primo cambio che chi compra vedrebbe su un ordine online da accettare
    salva l'ordine com'era (`before`: prodotti con quantità e prezzi, giorno e fascia, consegna o
    ritiro, indirizzo, costo di consegna, sconto, totale); «Chiedi conferma al cliente» salva com'è
    (`after`), alza `round` e manda l'email. Fotografie e differenze solo nel server, dal database
    (`orderChangeSnapshot`, `diffOrderChanges`); le righe di un ordine da accettare ora si cambiano
    (ADR-067 diceva che prima di accettare si cambiano anche i prodotti: adesso è vero).
  - **Stati** `EDITING → ASKED → CONFIRMED | DECLINED`: un cambio dopo la richiesta la ritira
    (torna `EDITING`, l'ora della richiesta resta per la scadenza) e chi compra non vede più niente
    da confermare; una risposta vale solo per il `round` che la persona ha visto
    (`order_change_outdated`) e «Confirmar» mai con il giorno di consegna passato.
  - **Accettare:** con dei cambi «Accetta l'ordine» lascia il posto a «Chiedi conferma al cliente»,
    anche nel servizio (`order_change_needs_confirmation`); senza cambi, o con i cambi tornati com'
    erano, resta com'era. «Proponi un'altra data» cambia giorno e fascia e chiede, in un passo.
  - **Chi compra**, sempre da `withBuyerOrder`: «Confirmar cambios» accetta l'ordine come «Accetta
    l'ordine» ma senza scrivere nell'inventario della fioreria (la merce si mette da parte al primo
    passo del fiorista, `syncOrderReservationTx`, idempotente); «No, gracias», con un motivo
    facoltativo fino a 300 caratteri, riporta l'ordine alla fioreria. Il registro le scrive con chi
    compra come autore, mai i testi.
  - **Scadenza:** mentre si aspetta chi compra, la base è la più recente fra invio, ultima richiesta
    e ultima risposta, con il tetto della fine del nuovo giorno di consegna (`pendingOrderDeadline`
    e la stessa formula nelle funzioni SQL, provata contro il dominio). Un promemoria per scadenza.
    Senza risposta l'ordine si annulla con il motivo «No confirmaste los cambios».
  - **Domande «sì / no»:** `OrderMessage.kind` `MESSAGE | QUESTION | ANSWER` (CHECK: la domanda è
    della fioreria e solo testo; la risposta è di chi compra, `YES | NO`, senza testo né foto, una
    per domanda con FK composita e indice unico). Chi compra risponde con un tocco; la risposta
    avvisa come un messaggio. «Chiedi nell'app» in «Mancano fiori» prepara il testo nel server,
    nella lingua del mercato, e ricorda riga, fiore che manca e fiore proposto (`questionContext`):
    con il «Sí» la casella «Il cliente ha accettato il cambio» è già spuntata.
  - **«Da gestire», menu ed elenco:** «N clienti hanno detto no ai cambi» con il filtro
    `changes=declined`; segni «In attesa del cliente» e «Il cliente ha detto no» sulle righe.
  - **PROPOSTO (da confermare in staging):** 1) il promemoria del giorno prima va a chi compra
    quando l'ordine aspetta la sua conferma; 2) email alla fioreria anche quando chi compra
    conferma; 3) biglietto, chi riceve, note interne e fattorino non contano come cambi; 4) il link
    di stato dice che ci sono cambi da confermare nel conto, senza pulsanti; 5) gli ordini che
    aspettano chi compra non contano in «Da gestire» né nel numero del menu; 6) se chi compra ha
    eliminato il conto non può rispondere, quindi «Accetta l'ordine» resta anche con i cambi.
- **M3-3 «Soldi e squadra» (su staging, 28/11):**
  - **Dati per pagare solo a ordine accettato:** `OnlineStore.paymentInstructions` (CLABE, conto)
    non arriva più alla vetrina, alla scheda del prodotto, all'anteprima né al modulo d'ordine (le
    letture pubbliche non lo restituiscono); `readCustomerOrderTx` lo dà solo con
    `paymentInstructionsVisible` (ordine online accettato e non annullato): pagina dell'ordine, link
    di stato, email di accettazione. Vetrina e modulo dicono «Te damos los datos para pagar cuando
    la florería acepte tu pedido» (senza ordini online, «Pide los datos para pagar a la florería»).
  - **Prove di pagamento** (`OrderPaymentProof`, RLS, FK composite e guardia di chi compra nella
    stessa migrazione): «Ya pagué: sube tu comprobante» dal conto, solo da `withBuyerOrder` con il
    lock, dopo l'accettazione e con qualcosa da pagare; foto obbligatoria (la catena dei messaggi,
    chiavi sotto `tenants/<id>/order-payment-proofs/` con CHECK, rotte private), importo fino a
    quanto manca, nota facoltativa, `submitKey` contro i doppi invii, al massimo 3 in attesa. Le
    vedono solo proprietario e gerente (`orders:payments`: la foto ha dati bancari). «Confermo» apre
    «Registra pagamento» già compilato e scrive il pagamento e la prova confermata nella stessa
    transazione, con l'ordine bloccato; «Non lo trovo» la rifiuta con un motivo che chi compra legge.
    Stati con CHECK (confermata ⇔ il pagamento; rifiutata ⇔ il motivo; decisa ⇔ `reviewedAt`).
  - **«Registramos tu pago de $X»** a chi compra dopo il commit per ogni pagamento registrato su un
    ordine online (a mano, da una prova, dai contanti), con totale, pagato e quanto manca, e la
    frase «no es un comprobante fiscal». Lo storno no (PROPOSTO).
  - **Rimborso** (`OrderPaymentKind.REFUND`, in una migrazione a parte come vuole Postgres): solo su
    un ordine annullato, fino al pagato, anche in più volte; negativo e senza pagamento collegato
    (`OrderPayment_amount_check` riscritto), non si storna. Uno storno non porta più il pagato sotto
    zero (`reversal_below_zero`, il caso di un pagamento già rimborsato). L'ordine mostra
    «Rimborsato $X», chi compra riceve «Te reembolsamos $X»; Report, `pagos.csv` («Reembolso») e la
    cronologia del cliente lo contano col segno giusto.
  - **Contanti di chi consegna** (`OrderCashCollection`, RLS e FK composite; chi compra non li
    tocca): «Ho incassato $X in contanti» dall'ordine o da Percorso → «Le mie consegne»
    (`orders:fulfill`), uno in attesa per ordine (indice unico parziale); proprietario o gerente li
    confermano (un saldo in Contanti del giorno in cui sono stati segnati, fino a quanto segnato e a
    quanto manca) o li rifiutano con un motivo. È il giro di «Cobré en la visita» di Floral Care.
  - **Staff:** permesso nuovo `orders:accept` per tutti i ruoli; i servizi di accettare, rifiutare,
    chiedere conferma, proporre una data e cambiare un ordine da accettare aprono con quello e poi,
    sull'ordine bloccato, `assertCanHandlePendingOnlineTx` / `assertOrderEditableTx`: proprietario e
    gerente sempre, lo staff solo con `OnlineStore.staffCanAccept` (Impostazioni → Negozio online,
    spento di default) e solo su un ordine online da accettare. `getOrder`, il numero del menu e i
    pulsanti seguono la stessa regola. L'impostazione va nel registro di `store.orders_updated` con
    il suo cambio (al posto di un'azione a parte).
  - **Squadra e giorno:** assegnando un ordine a un'altra persona le arriva «Te asignaron la entrega
    del pedido PED-… para el …» (zona, mai l'indirizzo intero); Ordini → Giorno ha «Stampa le
    comande» (una per pagina, con l'intestazione) e «Stampa i biglietti» (10 × 7 cm, con la linea di
    taglio e il numero fuori dal taglio) per gli ordini da preparare quel giorno.
  - **«Da gestire» ed elenco:** «N prove di pagamento da controllare» e «N incassi in contanti da
    confermare», solo per chi gestisce i soldi, con i filtri `money=proofs` e `money=cash`.
  - **Esportazioni e cancellazioni:** `pedidos_comprobantes.csv` e `pedidos_efectivo.csv` nello ZIP
    (senza le foto), le prove in «Descargar mis datos» (`app_buyer_order_payment_proofs`), le foto
    delle prove cancellate 30 giorni dopo la chiusura come quelle dei messaggi
    (`app_order_payment_proof_photos_to_purge`, lavoro giornaliero) e con la fioreria eliminata.
  - **PROPOSTO (da confermare in staging):** 1) email ai proprietari e gerenti quando arriva una
    prova; 2) email a chi compra quando la prova è rifiutata, con il motivo; 3) niente email per uno
    storno; 4) foto obbligatoria, importo proposto = quanto manca, al massimo 3 prove in attesa; 5)
    più rimborsi parziali fino al pagato, un rimborso non si annulla; 6) i contanti li segna chi
    prepara e consegna e non registra i pagamenti (lo staff: proprietario e gerente usano «Registra
    pagamento»), uno in attesa per ordine, si conferma fino a quanto segnato; 7) la stampa del giorno
    con gli ordini confermati, in preparazione e pronti, i biglietti solo di quelli con il biglietto; 8) con l'impostazione lo staff accetta, rifiuta, propone una data, chiede conferma e cambia gli
    ordini online da accettare, non annulla quelli accettati né registra pagamenti; 9) i dati per
    pagare spariscono dalla vetrina anche per le fiorerie solo WhatsApp; 10) l'email di assegnazione
    solo assegnando un'altra persona; 11) una prova in attesa su un ordine poi annullato non si
    conferma più (si rifiuta, e un rimborso si registra solo su quanto è stato registrato).
- **Revisione di tutto M3 (28/11, a blocco finito):** `/code-review` a livello alto su M3-1, M3-2 e
  M3-3 più l'elenco fisso; cinque correzioni, ognuna con il suo test:
  - **«Por aceptar» come il menu:** l'elenco (filtro, numero, avviso in cima) e Impostazioni →
    Negozio online contavano anche gli ordini che aspettano la conferma di chi compra; ora una regola
    sola (`awaitingShopWhere`) per menu, «Da gestire», elenco e Impostazioni, e quegli ordini hanno
    il filtro «In attesa del cliente» (`changes=asked`);
  - **prove da controllare:** il filtro dell'elenco contava gli ordini, «Da gestire» le prove (fino a
    3 per ordine); ora tutti e due le prove (e i contanti);
  - **«Confirmar cambios»** ricontrolla sui dati che l'ordine sia ancora quello chiesto
    (`order_change_outdated`), oltre al ritiro automatico della richiesta a ogni cambio;
  - **doppi invii di pagamenti e rimborsi:** «Registra pagamento» e «Registra rimborso» mandano una
    chiave del modulo (`OrderPayment.submitKey`, unica per fioreria, migrazione
    `order_payment_submit_key`), come i pagamenti di Floral Care: lo stesso invio due volte scrive un
    movimento e un'email;
  - un commento doppio in `assignOrder`.
  - Prima della revisione, negli E2E: ogni persona che si registra arriva da un suo IP di prova
    (il limite di 5 registrazioni al minuto per IP si sommava fra test di fila) e i link «Ver
    pedidos» di «Da gestire» hanno la descrizione della loro riga per i lettori di schermo.
- **DA VALIDARE:** termini per chi compra (PROFECO) con i messaggi e gli avvisi, i cambi proposti e
  confermati nell'app, le sostituzioni concordate con una domanda, le prove di pagamento e i
  rimborsi; aviso de privacidad con i messaggi, le foto dei messaggi e delle prove (dati bancari: chi
  le vede, per quanto) e gli avvisi per email (bozze aggiornate); l'email del pagamento registrato
  non è un CFDI (contador).
- **Fuori da M3:** recensioni (M8), domande prima di ordinare (M5), prenotazioni di Floral Care
  (M6), tempo per accettare regolabile e capienza (M4), notifiche push o WhatsApp automatico,
  pagamenti online (D-26).

### ADR-089 — Marketplace M5: servizi in vetrina e richieste — IN CORSO (M5-1 sul ramo di lavoro, 28/11/2026)

- **Perché:** blocco M5 del giro del marketplace (ADR-086, C7 e F9 di `docs/MARKETPLACE_FLOWS.md`),
  nell'ordine approvato il 25/11 e con il «tutto di fila» del 28/11: chi compra chiede dalla
  vetrina tutti i servizi della fioreria, non solo i prodotti. Due rilasci: **M5-1** «Servizi in
  vetrina e richieste» (questo), **M5-2** «Dal preventivo all'ordine» (preventivo legato alla
  richiesta, «Aceptar» dal conto, ordine o contratto dalla richiesta, messaggi).
- **I servizi** (`StorefrontService`, `StorefrontServicePhoto`): quattro predefiniti per fioreria
  (`EVENT` «Eventos y bodas», `VENUE` «Decoración de espacios», `WEEKLY` «Flores cada semana»,
  `CARE` «Floral Care»; uno per tipo con l'indice unico parziale, la riga nasce al primo
  salvataggio, alla pubblicazione o alla prima foto) e fino a 20 della fioreria (`CUSTOM`, con
  nome e le domande «data» e «indirizzo»). Descrizione, «cosa include», «Desde $X» facoltativo,
  fino a 6 foto (la catena delle foto del catalogo), acceso o spento, archivio solo per quelli della
  fioreria. In vetrina prima i predefiniti nel loro ordine, poi quelli della fioreria nell'ordine
  delle frecce. Floral Care si accende solo con l'offerta pronta (piano, tariffe con frequenze e
  una fascia attiva, `careOfferReadyTx`) e sparisce da solo dalla vetrina se l'offerta smette di
  esserlo. Impostazioni → Negozio online → «Servizi in vetrina», proprietario e gerente
  (`tenant:settings:update`). La regola per pubblicare il negozio non cambia (serve un prodotto
  online).
- **Le richieste** (`ServiceRequest`, `ServiceRequestPhoto`): una per invio, numero «SOL-0001»
  per fioreria (`nextTenantCounter`), il tipo del servizio, la data, l'indirizzo in colonne
  (salvato nel conto o nuovo), il budget in unità minime, telefono, messaggio (fino a 1000) e le
  risposte del modulo per tipo in `answers` (JSON validato dal dominio, CHECK oggetto), fino a 3
  foto di ispirazione nella riga (chiavi `tenants/<id>/service-requests/` con CHECK). Stati `NEW`,
  `QUOTED` e `ACCEPTED` (M5-2), `DECLINED` (con il motivo pronto e il testo che legge chi compra),
  `CANCELLED`, `CLOSED`. Il cliente del CRM si collega per email o si crea, come per gli ordini
  online (`linkBuyerCustomerTx`, estratto da `placeMarketplaceOrder`). Doppio invio con
  `submitKey` unica; al massimo 5 aperte (nuove o con preventivo) per persona e fioreria, sotto
  advisory lock; date da domani a 12 mesi; frequenze di Floral Care e fasce di «Flores cada
  semana» solo fra quelle della fioreria.
- **Chi compra entra da un solo punto:** `withBuyerRequest` (`packages/core/src/buyer-service-requests.ts`),
  gemello di `withBuyerOrder`: la fioreria da `app_buyer_request_shop` (DEFINER, solo per le
  richieste della persona), poi `withBuyerRequestContext` con `app.buyer_request_id` e le policy
  RESTRICTIVE `buyer_request_guard` su `ServiceRequest` e `ServiceRequestPhoto`. L'invio passa
  invece, come l'ordine online, dal contesto della fioreria con l'utente di chi compra (il limite
  delle aperte deve contare le altre richieste della persona) e filtri espliciti. «Mis
  solicitudes» da `app_buyer_service_requests()`, «Descargar mis datos» da
  `app_buyer_service_requests_export()`.
- **La fioreria:** voce «Richieste» sotto Ordini (il numero delle nuove per chi può rispondere),
  riga «N richieste di servizio nuove» in «Da gestire» (stesso numero del filtro «Nuove»), elenco
  con i filtri, pagina con il cliente del CRM e le foto private, «Rifiuta» con un motivo pronto
  («Non abbiamo disponibilità», «Non arriviamo», «Non facciamo questo lavoro», «Altro» con il
  testo). Permessi nuovi `requests:read` (tutti i ruoli) e `requests:write` (proprietario e
  gerente). Finché M5-2 non lega il preventivo alla richiesta, la pagina porta a «Nuovo
  preventivo» per quel cliente.
- **Email** (lingua del mercato, dopo il commit, mai il messaggio di chi compra né l'indirizzo
  intero): «Recibimos tu solicitud SOL-…» a chi compra, «Nueva solicitud SOL-…: servizio» a
  proprietari e gerenti (data e zona), «… no puede atender tu solicitud» con il motivo, «Se canceló
  la solicitud» alla fioreria.
- **Dati:** `servicios_tienda.csv` e `solicitudes.csv` nello ZIP della fioreria (senza foto), le
  richieste in «Descargar mis datos», le foto nella cancellazione della fioreria, le foto di
  ispirazione cancellate 30 giorni dopo la chiusura (rifiutata, annullata, chiusa) dal lavoro
  giornaliero (`app_service_request_photos_to_purge`); la richiesta e il testo restano. Registro:
  `storefront_service.*` e `service_request.*` con tipi e ID, mai i testi.
- **PROPOSTO (da confermare in staging):**
  1. due rilasci (M5-1, M5-2);
  2. conto obbligatorio per chiedere un servizio, come per ordinare (D-26);
  3. nomi dei predefiniti tradotti da noi; descrizioni e servizi della fioreria nella lingua del
     mercato, senza traduzioni;
  4. al massimo 5 richieste aperte per persona e fioreria, 3 foto per richiesta, 20 servizi della
     fioreria, 6 foto per servizio;
  5. Floral Care in vetrina solo con l'offerta pronta; fino a M6 una richiesta semplice (piante e
     frequenza) a cui il fiorista risponde con il contratto di oggi;
  6. nessuna scadenza automatica delle richieste;
  7. «Flores cada semana» accettato diventa ordini fatti a mano fino a M7;
  8. lo staff vede le richieste ma non le rifiuta (e non vede il numero nel menu);
  9. in vetrina prima i predefiniti, poi quelli della fioreria;
  10. le foto di ispirazione si cancellano 30 giorni dopo la chiusura, come quelle dei messaggi
      degli ordini (un'eccezione nuova alla regola «niente cancellazioni», da confermare).
- **DA VALIDARE:** aviso de privacidad (richieste con foto e indirizzi, chi le vede, cancellazione
  delle foto); termini per chi compra (la richiesta non è vincolante, il preventivo accettato è un
  accordo con la fioreria, PROFECO).
- **Fuori da M5-1:** il preventivo dalla richiesta, l'accettazione dal conto, l'ordine o il
  contratto dalla richiesta e i messaggi (M5-2); le prenotazioni di Floral Care con prezzo subito
  (M6); gli abbonamenti di «Flores cada semana» (M7).

## 3. Proposte da approvare

| ID   | Proposta                                                                                                                                                                               | Motivazione                                                                                                                                  | Quando serve                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| P-01 | ✅ **ADOTTATA** (delegata dal founder, 21/11/2026) — **Coda job su PostgreSQL** invece di BullMQ + Redis (spec §13.2); vedi ADR-025                                                    | Un servizio in meno da gestire; accodamento **nella stessa transazione** del record `AiJob` (niente job orfani); volumi MVP modesti          | Sprint 2 (AI)                |
| P-02 | ✅ **ADOTTATA** (delegata dal founder, 21/11/2026) — Object storage S3-compatibile (**Cloudflare R2**) con chiavi per tenant; vedi ADR-025                                             | Nessun costo di egress per le immagini; standard S3                                                                                          | Sprint 1 (immagini catalogo) |
| P-03 | ✅ **ADOTTATA** (founder, 22/11/2026) — **Vercel + Neon** in regione US-East, dettagli in `docs/PLATFORM_PLAN.md`; per ora un solo ambiente online di prova, budget 20 USD/mese (O-04) | Next.js nativo, anteprima con database per ogni PR, rollback istantaneo; job AI in funzioni su coda Postgres; latenza buona verso il Messico | Prima del pilota             |
| P-04 | **Stripe Billing** per il canone SaaS (adattatore `payments`); Mercado Pago valutato per gli incassi dei fioristi verso i loro clienti                                                 | Stripe è più completo per abbonamenti SaaS; MP è più diffuso fra i consumatori MX                                                            | Sprint 4                     |
| P-05 | Error tracking con Sentry (adattatore, DSN facoltativo)                                                                                                                                | Diagnosi errori in produzione                                                                                                                | Prima del pilota             |
| P-06 | Prezzi di catalogo intesi **IVA inclusa**, aliquota configurabile per tenant                                                                                                           | Prassi consumer in Messico; da validare con un contador                                                                                      | Sprint 1 (preventivi)        |
| P-07 | Provider email transazionale con dominio verificato (SPF/DKIM/DMARC)                                                                                                                   | Recapito affidabile di verifiche e inviti                                                                                                    | Prima del pilota             |
| P-08 | Numerazione preventivi/ordini per tenant con contatore transazionale (`COT-0001`)                                                                                                      | Numeri leggibili e senza buchi per il fiorista                                                                                               | Sprint 1                     |
| P-09 | ✅ **ADOTTATA** (founder, 24/11/2026) — 2FA (TOTP) per OWNER, obbligatoria dopo 14 giorni: ADR-077 (il login con Google è adottato: ADR-036)                                           | Meno attrito; più sicurezza per chi gestisce dati fiscali                                                                                    | Sprint 4                     |

---

## 4. Decisioni aperte (bloccano funzionalità future, NON lo Sprint 0)

| ID   | Domanda                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Chi decide         | Blocca                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------- |
| O-01 | ✅ **RISOLTA** (21/11/2026): **fal.ai** con **Nano Banana 2** (alternativa GPT Image 2), scelto col confronto sui ramos demo; vedi ADR-026. Resta la prova da ~100 immagini prima del pilota (costo reale → prezzi dei pacchetti)                                                                                                                                                                                                                                                                                                  | Founder            | Prima del pilota (solo la prova da ~100 immagini)  |
| O-02 | **Entità legale** che fattura il SaaS (Messico o Italia): impatta CFDI, IVA, provider di pagamento. **Rinviata** dal founder (22/11/2026): per ora solo tester, si decide prima dei pagamenti veri. Analisi del 23/11/2026 in `docs/BUSINESS_MODEL.md` §6: per partire è praticabile una partita IVA italiana (forfettario) con Stripe Italia, niente prestanome; IVA messicana sui servizi digitali, CFDI, ritenuta ISR e soglia di 85.000 € da confermare con contador e commercialista (domande elencate lì)                    | Founder + contador | Prima del lancio a pagamento                       |
| O-03 | Nome commerciale e dominio: il founder propone **Gardelia** (22/11/2026); **dominio `gardelia.co` comprato dal founder su Cloudflare (24/11/2026, uso in ADR-073)**. DA VALIDARE: ricerca marchi (IMPI in Messico, classi 9, 35 e 42; EUIPO per l'Italia); nome già in uso nell'app dal 22/11/2026 su richiesta del founder (`packages/domain/src/brand.ts`: Gardelia, Gardelia Network, Gardelia Studio; nomi dei servizi online in inglese, `gardelia-staging`); la verifica di marchio e dominio resta da fare prima del lancio | Founder            | Prima dell'ambiente online di prova                |
| O-04 | ✅ **RISOLTA** (22/11/2026): Vercel + Neon, Stati Uniti est; budget fino a **20 USD/mese** finché lo usa solo il founder. Proposta: Vercel Hobby gratuito finché è solo lui, Pro con i tester o prima di far pagare; piani gratuiti di Neon, R2, Resend, Sentry; più l'AI a consumo (`docs/PLATFORM_PLAN.md` §3)                                                                                                                                                                                                                   | Founder            | —                                                  |
| O-05 | Modello di costo AI deciso (ADR-024: extra senza scadenza, tetto 50 USD/mese). Proposti il 23/11/2026 (D-23): quote 15 e 30 per livello, pacchetti 169 / 299 / 549 MXN, utenti inclusi 2 / 3 / 5 con utente extra a 99 MXN, sede extra a 300 MXN. Restano: conferma dopo la prova da ~100 immagini e la prova gratuita (O-12)                                                                                                                                                                                                      | Founder            | Billing, Builder                                   |
| O-06 | Trattamento fiscale nei preventivi (IVA inclusa/esclusa, aliquota zona di frontiera, ricevute); domande concrete in ADR-076                                                                                                                                                                                                                                                                                                                                                                                                        | Contador           | Preventivi con imposte                             |
| O-07 | Términos y condiciones e Aviso de privacidad (LFPDPPP 2025): **bozze scritte** su richiesta del founder (`docs/legal/`, 22/11/2026), da far revisionare a un avvocato messicano prima del lancio                                                                                                                                                                                                                                                                                                                                   | Legale             | Lancio commerciale                                 |
| O-08 | Conferma della matrice ruoli: lo STAFF non vede costi; il MANAGER invita solo STAFF e non modifica dati fiscali; lo STAFF compone nel Builder ma non crea preventivi né clienti                                                                                                                                                                                                                                                                                                                                                    | Founder            | — (default già implementato)                       |
| O-09 | ✅ **RISOLTA** (founder, 24/11/2026): la tassonomia la mantiene **Gardelia**, unica per tutte le fiorerie, con la **revisione di un fiorista** sul foglio `docs/LISTA_FLORES_REVISION.md` (ADR-081); copertura iniziale 72 specie (ADR-043)                                                                                                                                                                                                                                                                                        | Founder            | Builder, Network                                   |
| O-10 | Durata della finestra di attribuzione delle fee del Network (spec §8.4). Proposta del 23/11/2026: 12 mesi (D-25)                                                                                                                                                                                                                                                                                                                                                                                                                   | Founder + legale   | Network                                            |
| O-11 | ✅ **RISOLTA** (founder, 22/11/2026): la promo delle date speciali resta in tutti i piani per ora; le promo più articolate saranno a pagamento (ADR-047)                                                                                                                                                                                                                                                                                                                                                                           | Founder            | —                                                  |
| O-12 | Fase gratuita iniziale (detta dal founder il 22/11/2026): solo con la V1 completa (D-22) o prima? Durata, quota AI ridotta (proposta 10 immagini), termini che annunciano il passaggio a pagamento; "precio de fundador" per i primi 20 fioristi (proposta: −30% per 12 mesi). Senza incassi non serve ancora la partita IVA                                                                                                                                                                                                       | Founder            | Lancio                                             |
| O-13 | Ruolo e compenso della partner sul territorio (spec §19, punto 11): proposta a percentuale, il 30% della fee dei clienti che porta per il primo anno, con accordo scritto. Il contador deve dire se l'attività abituale in Messico per una partita IVA italiana crea una stabile organizzazione                                                                                                                                                                                                                                    | Founder + contador | Aziende (D-25)                                     |
| O-14 | ✅ **RISOLTA** (founder, 23/11/2026): **Google Places** adottato (ADR-059). Chiave su Google Cloud creata dal founder (24/11/2026, quote e avviso di spesa come in `docs/DEPLOY_VERCEL.md` §9); riga nell'aviso de privacidad nella bozza (O-07)                                                                                                                                                                                                                                                                                   | Founder            | Ricerca del marketplace, costi e ruta per distanza |

---

## 5. Conflitti fra specifica e prompt iniziale (e risoluzione adottata)

| ID   | Conflitto                                                                                                                  | Risoluzione                                                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | Spec §20: "job AI mock e poi provider reale" ↔ regola "nessun mock che sembri live"                                        | Un adattatore finto è ammesso **solo in dev/test**, etichettato in UI ("simulado"), e disattivato in produzione.                                                     |
| C-02 | Spec §16: inventario (slice 4) prima di preventivi (slice 5) ↔ priorità MVP del prompt: CRM → preventivo → Builder         | Seguita la priorità del prompt. L'inventario arriva dopo (Sprint 3); i preventivi dichiarano la disponibilità come "da verificare".                                  |
| C-03 | Spec Slice 1: "subscription SaaS (prima anche simulata)" ↔ nessuna funzionalità simulata                                   | Nessuna subscription finta: nel pilota il piano sarà **assegnato manualmente da un admin di piattaforma**, in modo trasparente, fino all'integrazione dei pagamenti. |
| C-04 | Spec CORE-01: scelta del piano Basic/Plus in onboarding                                                                    | Rimandata allo sprint billing: senza provider di pagamento non è realizzabile onestamente.                                                                           |
| C-05 | Spec §13.2: BullMQ + Redis                                                                                                 | Proposta alternativa P-01 (coda su Postgres), da confermare prima dello Sprint 2.                                                                                    |
| C-06 | Spec §12: "progettare gli schemi solo dopo aver verificato i flussi" ↔ deliverable Sprint 0 con `Quote` e `AiJob`          | Inclusi come **confini dati minimi** (con RLS e vincoli), senza UI; saranno rivisti nello Sprint 1/2 con migrazioni additive.                                        |
| C-07 | Spec §3.2 e D-05: Basic 19,90 € e Plus 26,90 € (differenza ≈ 7 €) ↔ listino a livelli del founder (23/11/2026)             | Prevale la decisione del founder D-23; la spec resta il riferimento storico. Le fee della spec (§3.2, §8.4) sono aggiornate da D-24 e D-25.                          |
| C-08 | Spec D-15 e §9.1 (B2C in P2, "solo in seguito") e roadmap del 23/11 (tappa 3) ↔ marketplace nella V1 (founder, 23/11/2026) | Prevale D-26: il marketplace entra nella V1; resta D-22 (nessun cliente vero prima della V1 completa). Il lancio si sposta più avanti.                               |
