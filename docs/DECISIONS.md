# Registro delle decisioni — Floral OS

Ultimo aggiornamento: 21 novembre 2026 (Sprint 0).

**Legenda stati**

| Stato        | Significato                                                                    |
| ------------ | ------------------------------------------------------------------------------ |
| **DECISO**   | Confermato dai founder (spec §2).                                              |
| **ADOTTATO** | Decisione tecnica presa nello Sprint 0. Reversibile, ma solo con un nuovo ADR. |
| **PROPOSTO** | Suggerimento da approvare: non va trattato come definitivo.                    |
| **APERTO**   | Richiede input dei founder o di professionisti (fiscale, legale, provider).    |

---

## 1. Decisioni di prodotto (dalla spec) e loro impatto tecnico

| ID         | Decisione                                                                                                        | Stato                        | Come si riflette nel codice (Sprint 0)                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| D-01       | Prodotto principale = gestionale SaaS per fioristi                                                               | DECISO                       | Moduli gestionali prima del marketplace.                                                              |
| D-02       | Primo mercato Aguascalientes, poi Italia (niente pilota su un prodotto incompleto: D-22)                         | DECISO                       | UI es-MX; mercato `MX` abilitato, `IT` predisposto ma disattivato (`packages/domain/src/markets.ts`). |
| D-03       | Nessun acquisto/rivendita diretta di fiori                                                                       | DECISO                       | Nessun magazzino centrale: catalogo e stock sono sempre del tenant.                                   |
| D-04       | Bouquet Builder con il gestionale, piano superiore                                                               | DECISO                       | Distinta (BOM) e costi già pronti; Builder nello Sprint 2.                                            |
| D-05       | Differenza Basic/Plus ≈ 7 €/mese                                                                                 | DECISO (strategia)           | Quote AI da modellare nel billing (Sprint 4).                                                         |
| D-06/07/08 | Floral Network B2B come addon, fee sui contratti procurati                                                       | DECISO                       | Enum `AcquisitionSource` già presente su `Customer`/`Quote`: base per l'attribuzione delle fee.       |
| D-09/10/11 | Flora Studio addon separato, **dopo il lancio della V1** (founder, 22/11/2026); video in fase successiva         | DECISO                       | Enum `AiFeature.ROOM_PREVIEW` predisposto; nessuna implementazione.                                   |
| D-12/13/14 | Floral Care, rinnovi, vasi autoirriganti                                                                         | DECISO                       | Tipi catalogo `SERVICE`, `SERVICE_ADDON`, `CONTAINER`, `ACCESSORY` già disponibili.                   |
| D-15       | B2C e accessori solo in seguito                                                                                  | DECISO                       | Nessun modulo; nessun pulsante in UI.                                                                 |
| D-16/17    | Prezzi e fee                                                                                                     | PROPOSTO                     | **Nessun prezzo nel codice.** Saranno letti dal DB (sprint billing).                                  |
| D-18       | Stack Next.js/TypeScript/Prisma/PostgreSQL                                                                       | PROPOSTO → ADOTTATO          | Vedi ADR-002.                                                                                         |
| D-19       | Vendita iniziale tramite contatto diretto                                                                        | PROPOSTO                     | Onboarding self-service + tenant `DEMO` per le dimostrazioni.                                         |
| D-20       | Unica piattaforma multi-tenant                                                                                   | DECISO                       | Vedi ADR-003.                                                                                         |
| D-21       | Costi AI: quota mensile inclusa nel Plus + pacchetti extra pagati alla piattaforma                               | DECISO (founder, 21/11/2026) | Nessun collegamento di account/chiavi AI del fiorista; vedi ADR-024.                                  |
| D-22       | Ai clienti veri arriva solo un **prodotto finito**, non un pilota: prima della V1 lo usano solo founder e tester | DECISO (founder, 22/11/2026) | Perimetro e criterio di "finito" in `docs/V1_SCOPE.md`; la roadmap non ha più una fase pilota.        |

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

---

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
| P-09 | 2FA (TOTP) per OWNER (il login con Google è adottato: ADR-036)                                                                                                                         | Meno attrito; più sicurezza per chi gestisce dati fiscali                                                                                    | Sprint 4                     |

---

## 4. Decisioni aperte (bloccano funzionalità future, NON lo Sprint 0)

| ID   | Domanda                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Chi decide         | Blocca                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------- |
| O-01 | ✅ **RISOLTA** (21/11/2026): **fal.ai** con **Nano Banana 2** (alternativa GPT Image 2), scelto col confronto sui ramos demo; vedi ADR-026. Resta la prova da ~100 immagini prima del pilota (costo reale → prezzi dei pacchetti)                                                                                                                                                                                                                             | Founder            | Prima del pilota (solo la prova da ~100 immagini) |
| O-02 | **Entità legale** che fattura il SaaS (Messico o Italia): impatta CFDI, IVA, provider di pagamento. **Rinviata** dal founder (22/11/2026): per ora solo tester, si decide prima dei pagamenti veri                                                                                                                                                                                                                                                            | Founder + contador | Prima del lancio a pagamento                      |
| O-03 | Nome commerciale e dominio: il founder propone **Gardelia** (22/11/2026). DA VALIDARE: ricerca marchi (IMPI in Messico, classi 9, 35 e 42; EUIPO per l'Italia) e dominio disponibile; nome già in uso nell'app dal 22/11/2026 su richiesta del founder (`packages/domain/src/brand.ts`: Gardelia, Gardelia Network, Gardelia Studio; nomi dei servizi online in inglese, `gardelia-staging`); la verifica di marchio e dominio resta da fare prima del lancio | Founder            | Prima dell'ambiente online di prova               |
| O-04 | ✅ **RISOLTA** (22/11/2026): Vercel + Neon, Stati Uniti est; budget fino a **20 USD/mese** finché lo usa solo il founder. Proposta: Vercel Hobby gratuito finché è solo lui, Pro con i tester o prima di far pagare; piani gratuiti di Neon, R2, Resend, Sentry; più l'AI a consumo (`docs/PLATFORM_PLAN.md` §3)                                                                                                                                              | Founder            | —                                                 |
| O-05 | Modello di costo AI deciso (ADR-024: 25 incluse, extra senza scadenza, tetto 50 USD/mese). Restano: prezzi dei pacchetti (proposta in ADR-024), prova gratuita, limiti per piano (utenti, sedi)                                                                                                                                                                                                                                                               | Founder            | Billing, Builder                                  |
| O-06 | Trattamento fiscale nei preventivi (IVA inclusa/esclusa, aliquota zona di frontiera, ricevute)                                                                                                                                                                                                                                                                                                                                                                | Contador           | Preventivi con imposte                            |
| O-07 | Términos y condiciones e Aviso de privacidad (LFPDPPP 2025): **bozze scritte** su richiesta del founder (`docs/legal/`, 22/11/2026), da far revisionare a un avvocato messicano prima del lancio                                                                                                                                                                                                                                                              | Legale             | Lancio commerciale                                |
| O-08 | Conferma della matrice ruoli: lo STAFF non vede costi; il MANAGER invita solo STAFF e non modifica dati fiscali; lo STAFF compone nel Builder ma non crea preventivi né clienti                                                                                                                                                                                                                                                                               | Founder            | — (default già implementato)                      |
| O-09 | Chi mantiene la tassonomia canonica dei fiori e con quale copertura                                                                                                                                                                                                                                                                                                                                                                                           | Founder            | Builder, Network                                  |
| O-10 | Durata della finestra di attribuzione delle fee del Network (spec §8.4)                                                                                                                                                                                                                                                                                                                                                                                       | Founder + legale   | Network                                           |
| O-11 | ✅ **RISOLTA** (founder, 22/11/2026): la promo delle date speciali resta in tutti i piani per ora; le promo più articolate saranno a pagamento (ADR-047)                                                                                                                                                                                                                                                                                                      | Founder            | —                                                 |

---

## 5. Conflitti fra specifica e prompt iniziale (e risoluzione adottata)

| ID   | Conflitto                                                                                                          | Risoluzione                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | Spec §20: "job AI mock e poi provider reale" ↔ regola "nessun mock che sembri live"                                | Un adattatore finto è ammesso **solo in dev/test**, etichettato in UI ("simulado"), e disattivato in produzione.                                                     |
| C-02 | Spec §16: inventario (slice 4) prima di preventivi (slice 5) ↔ priorità MVP del prompt: CRM → preventivo → Builder | Seguita la priorità del prompt. L'inventario arriva dopo (Sprint 3); i preventivi dichiarano la disponibilità come "da verificare".                                  |
| C-03 | Spec Slice 1: "subscription SaaS (prima anche simulata)" ↔ nessuna funzionalità simulata                           | Nessuna subscription finta: nel pilota il piano sarà **assegnato manualmente da un admin di piattaforma**, in modo trasparente, fino all'integrazione dei pagamenti. |
| C-04 | Spec CORE-01: scelta del piano Basic/Plus in onboarding                                                            | Rimandata allo sprint billing: senza provider di pagamento non è realizzabile onestamente.                                                                           |
| C-05 | Spec §13.2: BullMQ + Redis                                                                                         | Proposta alternativa P-01 (coda su Postgres), da confermare prima dello Sprint 2.                                                                                    |
| C-06 | Spec §12: "progettare gli schemi solo dopo aver verificato i flussi" ↔ deliverable Sprint 0 con `Quote` e `AiJob`  | Inclusi come **confini dati minimi** (con RLS e vincoli), senza UI; saranno rivisti nello Sprint 1/2 con migrazioni additive.                                        |
