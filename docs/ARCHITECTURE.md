# Architettura di Floral OS

Stato: Sprint 0 (fondazioni). Le motivazioni delle scelte sono in [`DECISIONS.md`](./DECISIONS.md).

## 1. Vista d'insieme

Modular monolith in un monorepo pnpm. Un solo deployable oggi (l'app Next.js); il worker per i
job AI arriverà nello Sprint 2 riusando gli stessi package.

```text
 Browser (mobile-first, es-MX)
        │  HTTPS
        ▼
 ┌──────────────────────────── apps/web (Next.js 16) ─────────────────────────────┐
 │ proxy.ts   → requestId, CSP con nonce, redirect ottimistico al login            │
 │ /api/auth  → Better Auth (identità, sessioni, rate limit)                       │
 │ pagine RSC + server action (sottili): contesto → validazione → servizio         │
 └───────────────────────────────┬─────────────────────────────────────────────────┘
                                 ▼
 ┌──────────────────── packages/core (casi d'uso, multi-tenant) ───────────────────┐
 │ resolveTenantContext · requirePermission · servizi (catalogo, ricette, team,    │
 │ fiorerie, dashboard) · audit · mailer · logger                                   │
 └───────────────┬───────────────────────────────────────────┬─────────────────────┘
                 ▼                                           ▼
 ┌──── packages/domain (puro) ────┐          ┌──── packages/db ────────────────────┐
 │ denaro · permessi · schemi Zod │          │ Prisma 7 + adapter pg               │
 │ mercati · costi ricette · slug │          │ withTenantContext / withUserContext │
 └────────────────────────────────┘          │ / withSystemContext · seed          │
                                             └───────────────┬─────────────────────┘
                                                             ▼
                                   PostgreSQL 16 — Row-Level Security su ogni tabella tenant
                                   (ruolo runtime floral_app: non superuser, non BYPASSRLS)
```

Servizi esterni attuali: SMTP (email transazionali). Futuri (adattatori): object storage, coda
job, provider AI, pagamenti.

## 2. Struttura del repository

```text
apps/web/
  messages/es-MX.json         testi UI (unica lingua attiva)
  src/proxy.ts                CSP con nonce, requestId, redirect login
  src/instrumentation.ts      verifica all'avvio che il ruolo DB non possa aggirare la RLS
  src/lib/                    auth (server/client), sessione, contesto tenant, env, action, form
  src/components/             design system (ui/), form, app shell, brand
  src/app/                    route (auth), onboarding, app/[tenantSlug]/…, invite, api
  e2e/                        Playwright + pozzo SMTP
packages/core/src/            context, authorization, audit, mailer, email-templates, services/*,
                              ai/ (provider, coda, archivio), media/ (validazione immagini, sharp)
packages/db/prisma/           schema.prisma, migrations/ (SQL con RLS), seed.ts, seed-data.ts
packages/db/src/              client, tenancy (contesti RLS), errors, testing
packages/db/scripts/          provisioning ruoli/database per sviluppo e CI
packages/domain/src/          regole pure + schemi di validazione
docs/                         spec, decisioni, architettura
```

## 3. Ciclo di vita di una richiesta

Esempio: un gerente modifica il prezzo di un articolo.

1. `proxy.ts` assegna `x-request-id`, genera il nonce CSP; se manca il cookie di sessione
   reindirizza a `/login` (solo UX, non sicurezza).
2. La server action `updateItemAction(slug, itemId, …)` chiama `getTenantContext(slug)`:
   - `getSession()` verifica la sessione con Better Auth (DB, cookie cache firmato di 5 min);
   - `resolveTenantContext` cerca, **dentro `withUserContext`**, una membership `ACTIVE` dell'utente
     su un tenant `ACTIVE` con quello slug. Se non esiste → `notFound()` (404) e, se il tenant
     esiste, evento di sicurezza `security.tenant_access_denied`.
3. L'input del form è validato con `catalogItemFormSchema(currency)` (codici d'errore → es-MX).
4. Il servizio `updateCatalogItem(ctx, id, input)`:
   - `requirePermission(ctx, 'catalog:write')`;
   - rivalida l'input normalizzato;
   - apre `withTenantContext` (transazione con `app.tenant_id`/`app.user_id`), legge l'articolo con
     `where: { id, tenantId }`, calcola il diff, aggiorna, scrive `AuditLog` **nella stessa transazione**.
   - Se l'ID non esiste nel tenant → `notFound()`: 404 e, se l'ID appartiene a un altro tenant,
     evento `security.cross_tenant_access_attempt`.
5. La action fa `revalidatePath` e restituisce uno stato tradotto; il form mostra un toast.

## 4. Modello di tenancy (dettaglio)

### Contesti di accesso al DB (`packages/db/src/tenancy.ts`)

| Helper                                          | Imposta                        | Uso                                                                                                           |
| ----------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `withTenantContext(db, {tenantId, userId}, fn)` | `app.tenant_id`, `app.user_id` | Tutte le operazioni di un utente dentro una fioreria; creazione di una nuova fioreria (con l'ID pre-generato) |
| `withUserContext(db, userId, fn)`               | `app.user_id`                  | Elenco delle proprie fiorerie, risoluzione dello slug                                                         |
| `withSystemContext(db, {reason}, fn)`           | `app.bypass_rls = on`          | Seed, inviti via token, verifiche di sicurezza (whitelist ESLint)                                             |

I valori sono impostati con `set_config(…, true)`: valgono solo per la transazione corrente,
anche con pool di connessioni o PgBouncer in transaction mode. Un test verifica che il contesto non
"trapeli" su altre connessioni del pool.

### Policy RLS (migrazione `tenant_rls`)

- **Standard** (`app_enable_tenant_rls`): righe visibili/modificabili solo se `tenantId = app_current_tenant_id()`
  (oppure bypass di sistema). `WITH CHECK` impedisce di inserire o spostare righe verso un altro tenant.
- **Tenant:** leggibile dal tenant corrente **o** dai membri attivi (necessario per risolvere lo slug).
- **Membership:** leggibile dal tenant corrente o dall'utente stesso; modificabile solo nel contesto del tenant.
- **AuditLog:** solo SELECT/INSERT → append-only per l'applicazione.
- **CanonicalFlower:** lettura pubblica, scrittura solo di sistema.
- Vincoli aggiuntivi nel SQL: CHECK su importi/quantità/valute/slug, indici univoci parziali
  (una sede primaria per tenant, un invito pendente per email).

### Garanzie verificate dai test

`packages/db/test/rls.test.ts` (database reale, ruolo applicativo): fail-closed senza contesto,
invisibilità/immodificabilità delle righe altrui, rifiuto di INSERT/UPDATE verso altri tenant, FK
composite anche con RLS aggirata, nessuna fuga di contesto nel pool, audit append-only, copertura
RLS di ogni tabella con `tenantId`. `packages/core/test/tenant-isolation.test.ts`: gli stessi
principi a livello di servizi e ruoli (TEN-01).

## 5. Autenticazione e autorizzazione

- **Identità (Better Auth):** registrazione → email di verifica (obbligatoria) → accesso automatico dopo la
  conferma; reset password con revoca delle sessioni; sessioni su DB; rate limiting su DB
  (`/sign-in` 10/min, `/sign-up` 5/min, `/sign-in/social` 10/min, reset e verifica 5/5 min per IP);
  utenti sospesi non possono aprire sessioni.
- **Login con Google (ADR-036, facoltativo):** attivo solo con `GOOGLE_CLIENT_ID`/`SECRET`. Email
  obbligatoriamente verificata da Google; collegamento a un account esistente solo se l'email è
  verificata da entrambe le parti; niente foto del profilo; token del provider cifrati. Negli E2E
  Google è simulato nel server di test (`e2e/support/google-oauth-mock.mjs`).
- **Autorizzazione (nostro dominio):** `Membership(role: OWNER|MANAGER|STAFF, status)` + matrice
  `PERMISSIONS`. Il controllo avviene nei servizi; la UI nasconde soltanto ciò che non è consentito.
- **Inviti:** token casuale da 32 byte (solo l'hash SHA-256 nel DB), validità 7 giorni, legato all'email
  invitata, revocabile; un nuovo invito sostituisce quello pendente; l'accettazione è idempotente.

## 6. Dati (Sprint 0 + Sprint 1)

| Area       | Modelli                                                               | Stato                                                       |
| ---------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Identità   | User, Session, Account, Verification, RateLimit                       | completo                                                    |
| Tenancy    | Tenant, Location, Membership, Invitation, AuditLog                    | completo                                                    |
| Catalogo   | CanonicalFlower, CatalogItem, BouquetRecipe, BouquetRecipeLine        | completo; foto con scontorno automatico (ADR-029, ADR-033)  |
| CRM        | Customer, CustomerAddress, CustomerOccasion                           | completo                                                    |
| Preventivi | Quote, QuoteLine (`CATALOG_ITEM`, `CUSTOM`, `BUILDER`), TenantCounter | completo (ordini nello Sprint 3)                            |
| Piani      | SaasPlan (globale), TenantSubscription                                | v0: assegnazione manuale da CLI, nessun pagamento (ADR-021) |
| Builder    | BouquetConfiguration, BouquetConfigurationLine                        | deterministico (ADR-023); anteprime AI nello Sprint 2       |
| AI         | AiJob (coda di anteprime e scontorni), AiCreditGrant                  | pipeline completa; provider fal.ai/Nano Banana 2 (ADR-026)  |

Flusso del valore (Sprint 1): **catalogo** (prezzi, costi, disponibilità, flag Builder) →
**Builder** (`priceBouquet`, stessa funzione in browser e server) → **preventivo** (riga `BUILDER`
con distinta esatta e prezzi del momento) → stampa/PDF o WhatsApp; il cliente del **CRM** è
obbligatorio per il preventivo. I servizi delle funzioni a pagamento chiamano `requireEntitlement`
dopo `requirePermission`.

Anteprime AI (Sprint 2, ADR-024/025): il Diseñador chiede l'anteprima del disegno **salvato** →
il servizio calcola la descrizione del ramo (solo composizione) e la sua impronta → se la stessa
fioreria ha già quell'immagine la riusa, altrimenti prenota un credito (prima quota del mese, poi
extra) sotto lock e accoda un `AiJob` → il worker (nel processo web) lo preleva con
`app_claim_ai_job` (SECURITY DEFINER, `SKIP LOCKED`), genera l'immagine col provider configurato
(fal.ai con Nano Banana 2, ADR-026; simulato solo in locale), la salva nell'archivio
(`tenants/{tenantId}/…`, R2 in produzione) e consuma il credito solo a successo. L'immagine si
serve da una route che verifica tenant e permessi.

Foto (ADR-029): il browser riduce le foto e le invia una alla volta → la server action le passa
al servizio (`catalog-photos`, `style-references`) → `media/images.ts` le valida e le ricodifica
(niente metadati, 1600 px + miniatura) → archivio privato per tenant e riga nel DB nella stessa
transazione, con audit. Le route `/catalog/photos/[id]` e `/builder/references/[id]` servono i
file solo ai membri della fioreria.

Stile della fioreria (ADR-032): all'accodamento il servizio sceglie una foto di "Mis ramos" (stesso
stile del disegno, poi la prima caricata) e ne mette l'ID nella descrizione del ramo; il worker
usa il testo dello stile già salvato o lo fa scrivere una volta a un modello di visione, e lo
aggiunge al prompt. La foto non va mai al modello delle immagini.

Scontorno (ADR-033): caricando una foto del catalogo il servizio accoda, nella stessa transazione,
un `AiJob` `PHOTO_CUTOUT` (costo della piattaforma, nessun credito del fiorista, dentro il tetto di
spesa) → lo stesso worker chiede il ritaglio al `BackgroundRemover` configurato (BiRefNet via fal;
algoritmo locale per fondi lisi solo in sviluppo), lo controlla e lo rifila (`finishCutout`) e
salva PNG e miniatura accanto all'originale; la foto passa da `PENDING` a `READY` o `FAILED`
(codice di errore). La route della foto serve anche `?size=cutout` / `cutout-thumb`. Le foto di
"Mis ramos" non si scontornano: il fondo fa parte dello stile.

Anteprima esatta (ADR-034): il servizio sceglie per ogni fiore e follaje fino a 3 foto senza fondo
(di frente per prima) e le mette nella descrizione del ramo; se ogni fiore contato ne ha una e il
provider sa partire da un'immagine, la richiesta è in modalità EXACT. Il boceto
(`layoutBouquetSketch` nel dominio: corolle fitte a cupola; disegno SVG + corolle estratte dai
ritagli con sharp in `ai/sketch-renderer.ts` e `ai/bloom-head.ts`) si serve gratis da
`/builder/[id]/sketch`; il worker lo passa al modello (`nano-banana-2/edit`), fa contare i fiori
(`TwoStepFlowerCounter`: Claude, poi Gemini Pro con i riquadri solo se i numeri non tornano) e
accetta solo numeri identici, con un nuovo tentativo; altrimenti FAILED `count_mismatch` senza
credito.

Immagine nel preventivo (ADR-035): `createQuoteFromConfiguration` aggancia alla riga BUILDER
l'anteprima riuscita del disegno in quel momento (`currentPreviewJobId`, stessa chiave di cache
delle anteprime); `getQuote` ne espone lo stato e `getQuoteLineImage` la serve con i permessi dei
preventivi dalla route `/quotes/[id]/lines/[lineId]/image` (`?download=1` per WhatsApp).

Colore di carta e nastro (ADR-030): l'editor invia `{catalogItemId, quantity, color}`; il server
calcola il colore effettivo con `resolveLineColor` sui colori attuali dell'articolo, lo salva sulla
riga e lo riporta nella distinta del preventivo e nel prompt dell'anteprima.

Convenzioni: UUID v7, importi in unità minime + valuta, date in UTC, indirizzi strutturati,
archiviazione invece di cancellazione, `AcquisitionSource` su clienti/preventivi per
l'attribuzione delle fee future.

## 7. Sicurezza applicativa (riepilogo)

- Validazione Zod lato server su ogni input; importi mai presi dal client per i calcoli.
- CSP con nonce, `frame-ancestors 'none'`, HSTS quando l'app è in HTTPS, `poweredByHeader` disattivato.
- Server action protette dal controllo di origine di Next.js; Better Auth verifica `trustedOrigins`.
- Redirect post-login solo verso percorsi interni (`safeNextPath`).
- Log JSON con `requestId`, campi sensibili oscurati; errori inattesi mostrati con un riferimento,
  mai con dettagli tecnici. Gli errori non gestiti di pagine, route e server action passano da
  `onRequestError` (`instrumentation.ts` → `lib/request-errors.ts`): una riga con `requestId`
  (anche per le API), `digest` (= "Referencia" mostrata all'utente) e il percorso della route,
  mai quello reale. Confini d'errore: dentro il menu della fioreria (`app/[tenantSlug]/error.tsx`,
  `not-found.tsx`, che conserva il 404) e globale (`global-error.tsx`). Nei form, un errore di
  validazione su un campo che la pagina non mostra diventa un toast (`lib/use-action-toast.ts`).
- All'avvio, se il database non risponde, il controllo della RLS e l'avvio del worker AI si
  ritentano in background con attesa crescente (`instrumentation-node.ts`).
- Segreti solo da variabili d'ambiente. All'avvio si controlla tutta la configurazione: schema del
  web (`src/lib/env.ts`) e della piattaforma (`packages/core/src/config.ts`, diviso in AI, archivio
  ed email; ogni adattatore legge solo la sua parte, già validata). Se qualcosa non va l'app non
  parte ed elenca tutti i problemi (`src/lib/config-check.ts`, `docs/CONFIGURATION.md`).

## 8. Test

| Livello      | Strumento                 | Dove                                     | Cosa                                                                                                                    |
| ------------ | ------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Unit         | Vitest                    | `packages/domain/test`                   | denaro, permessi, slug/ID, mercati, catalogo, ricette, clienti e ricorrenze, preventivi, piani, Builder (BQ-01)         |
| Integrazione | Vitest + PostgreSQL reale | `packages/db/test`, `packages/core/test` | RLS (anche piani/abbonamenti), seed, isolamento A↔B per ogni entità, ruoli, CRM, preventivi, piani, Builder             |
| End-to-end   | Playwright + pozzo SMTP   | `apps/web/e2e`                           | registrazione e inviti con email reali, catalogo, preventivi, piano, Builder → preventivo, permessi, isolamento, mobile |

## 9. Note di deploy (per il pilota)

1. Creare due ruoli Postgres: proprietario (migrazioni) e applicativo (`NOSUPERUSER NOBYPASSRLS`),
   con i privilegi di default di `packages/db/scripts/grant-app-role.sql`.
2. `DATABASE_MIGRATION_URL` (proprietario) solo nel passo di migrazione (`pnpm db:deploy`);
   `DATABASE_URL` (applicativo) nel runtime.
3. Variabili obbligatorie: `APP_URL` (HTTPS), `BETTER_AUTH_SECRET` (≥ 32 caratteri), `DATABASE_URL`,
   `SMTP_URL`, `EMAIL_FROM`; `TRUSTED_IP_HEADER` coerente con il proxy/CDN.
4. Anteprime AI: `AI_PROVIDER=fal` + `FAL_KEY` (segreto) + `AI_MODEL` facoltativa,
   `AI_MONTHLY_BUDGET_USD`; archivio `STORAGE_DRIVER=r2` con le variabili `R2_*` (il provider
   simulato e l'archivio su file sono rifiutati con un `APP_URL` pubblico).
5. Health check: `GET /api/health`.
6. Mai eseguire il seed demo in produzione (lo script si rifiuta con `NODE_ENV=production`).
