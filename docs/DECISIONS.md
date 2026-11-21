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

| ID         | Decisione                                                                          | Stato                        | Come si riflette nel codice (Sprint 0)                                                                |
| ---------- | ---------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| D-01       | Prodotto principale = gestionale SaaS per fioristi                                 | DECISO                       | Moduli gestionali prima del marketplace.                                                              |
| D-02       | Pilota ad Aguascalientes, poi Italia                                               | DECISO                       | UI es-MX; mercato `MX` abilitato, `IT` predisposto ma disattivato (`packages/domain/src/markets.ts`). |
| D-03       | Nessun acquisto/rivendita diretta di fiori                                         | DECISO                       | Nessun magazzino centrale: catalogo e stock sono sempre del tenant.                                   |
| D-04       | Bouquet Builder con il gestionale, piano superiore                                 | DECISO                       | Distinta (BOM) e costi già pronti; Builder nello Sprint 2.                                            |
| D-05       | Differenza Basic/Plus ≈ 7 €/mese                                                   | DECISO (strategia)           | Quote AI da modellare nel billing (Sprint 4).                                                         |
| D-06/07/08 | Floral Network B2B come addon, fee sui contratti procurati                         | DECISO                       | Enum `AcquisitionSource` già presente su `Customer`/`Quote`: base per l'attribuzione delle fee.       |
| D-09/10/11 | Flora Studio addon separato; video in fase successiva                              | DECISO                       | Enum `AiFeature.ROOM_PREVIEW` predisposto; nessuna implementazione.                                   |
| D-12/13/14 | Floral Care, rinnovi, vasi autoirriganti                                           | DECISO                       | Tipi catalogo `SERVICE`, `SERVICE_ADDON`, `CONTAINER`, `ACCESSORY` già disponibili.                   |
| D-15       | B2C e accessori solo in seguito                                                    | DECISO                       | Nessun modulo; nessun pulsante in UI.                                                                 |
| D-16/17    | Prezzi e fee                                                                       | PROPOSTO                     | **Nessun prezzo nel codice.** Saranno letti dal DB (sprint billing).                                  |
| D-18       | Stack Next.js/TypeScript/Prisma/PostgreSQL                                         | PROPOSTO → ADOTTATO          | Vedi ADR-002.                                                                                         |
| D-19       | Vendita iniziale tramite contatto diretto                                          | PROPOSTO                     | Onboarding self-service + tenant `DEMO` per le dimostrazioni.                                         |
| D-20       | Unica piattaforma multi-tenant                                                     | DECISO                       | Vedi ADR-003.                                                                                         |
| D-21       | Costi AI: quota mensile inclusa nel Plus + pacchetti extra pagati alla piattaforma | DECISO (founder, 21/11/2026) | Nessun collegamento di account/chiavi AI del fiorista; vedi ADR-024.                                  |

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
- Social login (Google) e 2FA: rimandati (PROPOSTO per lo sprint billing/admin).

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
- **Elaborazione (sharp, nel core):** tipo riconosciuto dai byte (JPEG/PNG/WebP), massimo 8 MB e
  50 megapixel, lato corto ≥ 320 px; orientamento EXIF applicato e **tutti i metadati eliminati**
  (niente GPS né dati del telefono); si salvano un JPEG da 1600 px e una miniatura da 480 px. Il
  browser riduce le foto a 2048 px prima dell'invio solo per velocità: il server rivalida sempre.
- **Caricamento:** una foto per richiesta (server action con limite 9 MB, sotto i 10 MB del proxy
  di Next), con avanzamento visibile; una foto sbagliata non blocca le altre.
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

---

## 3. Proposte da approvare

| ID   | Proposta                                                                                                                                   | Motivazione                                                                                                                         | Quando serve                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| P-01 | ✅ **ADOTTATA** (delegata dal founder, 21/11/2026) — **Coda job su PostgreSQL** invece di BullMQ + Redis (spec §13.2); vedi ADR-025        | Un servizio in meno da gestire; accodamento **nella stessa transazione** del record `AiJob` (niente job orfani); volumi MVP modesti | Sprint 2 (AI)                |
| P-02 | ✅ **ADOTTATA** (delegata dal founder, 21/11/2026) — Object storage S3-compatibile (**Cloudflare R2**) con chiavi per tenant; vedi ADR-025 | Nessun costo di egress per le immagini; standard S3                                                                                 | Sprint 1 (immagini catalogo) |
| P-03 | Deploy containerizzato (Railway/Render/Fly) + Postgres gestito (Neon/Supabase/RDS) in regione US-central/East                              | Web e worker sullo stesso provider; latenza buona verso il Messico                                                                  | Prima del pilota             |
| P-04 | **Stripe Billing** per il canone SaaS (adattatore `payments`); Mercado Pago valutato per gli incassi dei fioristi verso i loro clienti     | Stripe è più completo per abbonamenti SaaS; MP è più diffuso fra i consumatori MX                                                   | Sprint 4                     |
| P-05 | Error tracking con Sentry (adattatore, DSN facoltativo)                                                                                    | Diagnosi errori in produzione                                                                                                       | Prima del pilota             |
| P-06 | Prezzi di catalogo intesi **IVA inclusa**, aliquota configurabile per tenant                                                               | Prassi consumer in Messico; da validare con un contador                                                                             | Sprint 1 (preventivi)        |
| P-07 | Provider email transazionale con dominio verificato (SPF/DKIM/DMARC)                                                                       | Recapito affidabile di verifiche e inviti                                                                                           | Prima del pilota             |
| P-08 | Numerazione preventivi/ordini per tenant con contatore transazionale (`COT-0001`)                                                          | Numeri leggibili e senza buchi per il fiorista                                                                                      | Sprint 1                     |
| P-09 | Google login e 2FA (TOTP) per OWNER                                                                                                        | Meno attrito; più sicurezza per chi gestisce dati fiscali                                                                           | Sprint 4                     |

---

## 4. Decisioni aperte (bloccano funzionalità future, NON lo Sprint 0)

| ID   | Domanda                                                                                                                                                                                                                           | Chi decide         | Blocca                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------- |
| O-01 | ✅ **RISOLTA** (21/11/2026): **fal.ai** con **Nano Banana 2** (alternativa GPT Image 2), scelto col confronto sui ramos demo; vedi ADR-026. Resta la prova da ~100 immagini prima del pilota (costo reale → prezzi dei pacchetti) | Founder            | Prima del pilota (solo la prova da ~100 immagini)             |
| O-02 | **Entità legale** che fattura il SaaS (Messico o Italia): impatta CFDI, IVA, provider di pagamento                                                                                                                                | Founder + contador | Billing (Sprint 4)                                            |
| O-03 | Nome commerciale definitivo (il repo si chiama "gardelia", la spec usa "Floral OS" come nome di lavoro) e dominio                                                                                                                 | Founder            | Lancio (cambio a basso costo: `packages/domain/src/brand.ts`) |
| O-04 | Hosting, regione dei dati, budget infrastruttura                                                                                                                                                                                  | Founder            | Deploy del pilota                                             |
| O-05 | Modello di costo AI deciso (ADR-024: 25 incluse, extra senza scadenza, tetto 50 USD/mese). Restano: prezzi dei pacchetti (proposta in ADR-024), prova gratuita, limiti per piano (utenti, sedi)                                   | Founder            | Billing, Builder                                              |
| O-06 | Trattamento fiscale nei preventivi (IVA inclusa/esclusa, aliquota zona di frontiera, ricevute)                                                                                                                                    | Contador           | Preventivi con imposte                                        |
| O-07 | Términos y condiciones e Aviso de privacidad (LFPDPPP)                                                                                                                                                                            | Legale             | Lancio commerciale                                            |
| O-08 | Conferma della matrice ruoli: lo STAFF non vede costi; il MANAGER invita solo STAFF e non modifica dati fiscali; lo STAFF compone nel Builder ma non crea preventivi né clienti                                                   | Founder            | — (default già implementato)                                  |
| O-09 | Chi mantiene la tassonomia canonica dei fiori e con quale copertura                                                                                                                                                               | Founder            | Builder, Network                                              |
| O-10 | Durata della finestra di attribuzione delle fee del Network (spec §8.4)                                                                                                                                                           | Founder + legale   | Network                                                       |

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
