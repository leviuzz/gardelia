# Floral OS

Piattaforma SaaS multi-tenant per fioristi: gestionale (catalogo, ricette dei bouquet, team,
clienti, preventivi…), AI Bouquet Builder nel piano Plus e, in seguito, il marketplace B2B
**Floral Network** e il configuratore di ambienti **Flora Studio**.

> I nomi sono di lavoro (spec §19.1). Mercato pilota: Aguascalientes, Messico. UI in spagnolo messicano.

- Requisiti di prodotto: [`docs/FLORAL_OS_MASTER_SPEC.md`](docs/FLORAL_OS_MASTER_SPEC.md)
- Decisioni e ADR: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Architettura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Stato e backlog: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)
- Istruzioni per Claude Code: [`CLAUDE.md`](CLAUDE.md)

## Cosa funziona oggi (Sprint 1)

- Registrazione con verifica email obbligatoria, login, recupero password (rate limiting incluso).
- Creazione della fioreria (onboarding con indirizzo strutturato per il Messico), più fiorerie per utente.
- Ruoli **Propietario / Gerente / Equipo** con permessi applicati lato server; inviti via email,
  cambio ruolo, disattivazione; lo staff non vede costi e margini.
- **Catalogo** con prezzi, costi, disponibilità, colori, etichette, archiviazione e **ricette dei
  ramos** (distinta base) con costi e margini deterministici.
- **Clienti (CRM):** schede persona/azienda, indirizzi di consegna, fechas especiales con le
  prossime ricorrenze in dashboard, contatto diretto (telefono, WhatsApp, email).
- **Cotizaciones:** righe dal catalogo con snapshot di prezzo e distinta, righe libere, sconto,
  validità, stati (borrador → enviada → aceptada/rechazada, vencida, cancelada), stampa/PDF e invio
  via WhatsApp. Prezzi finali senza scorporo IVA finché il trattamento fiscale non è validato (O-06).
- **Plan y funciones:** piano Basic/Plus della fioreria, assegnato manualmente durante il pilota
  (nessun pagamento online, nessun pagamento finto).
- **Diseñador de ramos (Plus):** composizione con fiori, follaje, empaque e complementi del
  catalogo, prezzo calcolato all'istante (stessa formula sul server), avvisi di disponibilità,
  disegni salvati e creazione della cotización con la receta esatta.
- **Foto del catalogo:** più foto per articolo (de frente, de lado, desde arriba, detalle) e, per
  carte, vasi e nastri, una foto per colore; ricodificate senza metadati (niente GPS).
- **Mis ramos (Plus):** foto dei ramos della fioreria come riferimento di stile, caricate solo con
  consenso esplicito; mai usate per addestrare modelli.
- **Vista previa con IA (Plus):** 25 al mese + pacchetti extra, cache per fioreria, tetto di
  spesa. Immagini reali con **fal.ai / Nano Banana 2** (~10 s, ~0,08 USD l'una; ADR-026); in
  locale, senza chiave, si usa un **provider simulato** dichiarato in UI.
- Dashboard con dati reali (cotizaciones abiertas, fechas especiales, attività), banner demo.
- Isolamento fra fiorerie garantito anche dal database (Row-Level Security PostgreSQL).

Ordini e pagamenti online **non sono ancora disponibili** e non compaiono
nell'interfaccia come funzioni attive (vedi `IMPLEMENTATION_PLAN.md`).

## Requisiti

- Node.js **22** (`.nvmrc`) e pnpm **10** (`corepack enable`)
- Docker (per Postgres e Mailpit) — oppure PostgreSQL 16 installato localmente

## Avvio in locale

```bash
corepack enable
pnpm install                 # genera anche il client Prisma
cp .env.example .env         # poi imposta BETTER_AUTH_SECRET:
openssl rand -base64 32      # → incolla il valore in BETTER_AUTH_SECRET
docker compose up -d         # Postgres (ruoli e database inclusi) + Mailpit
pnpm db:deploy               # applica le migrazioni (ruolo proprietario)
pnpm db:seed                 # dati demo (idempotente)
pnpm dev                     # http://localhost:3000
```

Anteprime AI reali in locale (a pagamento, ~0,08 USD l'una): in `.env` imposta `AI_PROVIDER=fal`
e `FAL_KEY` con la chiave del tuo account fal.ai (mai nel repo). Senza chiave lascia
`AI_PROVIDER=simulated`.

Le email inviate in sviluppo (verifica, reset, inviti) si leggono in **Mailpit:
http://localhost:8025**. Senza `SMTP_URL`, in sviluppo vengono scritte nel log del server.

### PostgreSQL senza Docker

Esegui una volta, come superuser: `psql -U postgres -f packages/db/scripts/setup-local-roles.sql`
(crea i ruoli `floral_owner`/`floral_app` e i database `floral_dev`/`floral_test`).

### Account demo (dopo `pnpm db:seed`)

Password: il valore di `SEED_DEMO_PASSWORD` nel tuo `.env`.

| Email                       | Ruolo       | Fioreria                                    |
| --------------------------- | ----------- | ------------------------------------------- |
| `duena@lascamelias.test`    | Propietario | Florería Las Camelias (demo)                |
| `gerente@lascamelias.test`  | Gerente     | Florería Las Camelias (demo)                |
| `staff@lascamelias.test`    | Equipo      | Florería Las Camelias (demo)                |
| `dueno@floresdelvalle.test` | Propietario | Flores del Valle (per provare l'isolamento) |

Prova dell'isolamento: entra come `dueno@floresdelvalle.test` e apri
`/app/las-camelias` → risposta 404.

La fioreria demo ha il piano **Plus in pilota** (Bouquet Builder incluso); Flores del Valle è
senza abbonamento, quindi **Basic**.

### Assegnare un piano (pilota, senza pagamenti)

Durante il pilota i piani si assegnano a mano dalla CLI di piattaforma (ADR-021). L'operatore deve
essere un utente con `platformRole = SUPER_ADMIN` (impostato direttamente nel database da chi
gestisce la piattaforma); ogni assegnazione è registrata nell'audit della fioreria.

```bash
pnpm platform:assign-plan --operator tu@empresa.mx --tenant flores-del-valle --plan PLUS --status PILOT --until 2027-03-31
```

Dopo il pagamento di un pacchetto di anteprime (fuori dall'app nel pilota), si sbloccano così
(gli extra non scadono e si usano dopo le 25 del mese):

```bash
pnpm platform:grant-ai-credits --operator tu@empresa.mx --tenant las-camelias --units 50 --note "Paquete 50"
```

## Comandi

| Comando                               | Descrizione                                                    |
| ------------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                            | App in sviluppo                                                |
| `pnpm build` / `pnpm start`           | Build e avvio in modalità produzione                           |
| `pnpm lint` / `pnpm lint:fix`         | ESLint (0 warning ammessi)                                     |
| `pnpm format` / `pnpm format:check`   | Prettier                                                       |
| `pnpm typecheck`                      | TypeScript su tutti i package                                  |
| `pnpm test`                           | Unit + integrazione                                            |
| `pnpm test:unit`                      | Solo regole di dominio (nessun database)                       |
| `pnpm test:integration`               | Servizi e RLS su `TEST_DATABASE_URL` (migrato automaticamente) |
| `pnpm test:e2e`                       | Playwright sull'app di produzione (richiede `pnpm build`)      |
| `pnpm db:migrate`                     | Crea e applica una nuova migrazione (sviluppo)                 |
| `pnpm db:deploy`                      | Applica le migrazioni (CI/produzione)                          |
| `pnpm db:seed`                        | Dati demo (rifiutato con `NODE_ENV=production`)                |
| `pnpm platform:assign-plan`           | Assegna il piano a una fioreria (solo operatori SUPER_ADMIN)   |
| `pnpm platform:grant-ai-credits`      | Sblocca anteprime AI extra pagate (solo operatori SUPER_ADMIN) |
| `pnpm --filter @floral/web mail-sink` | Pozzo SMTP su file, alternativa a Mailpit senza Docker         |

### Test end-to-end

```bash
pnpm build
pnpm test:e2e
```

Playwright avvia l'app di produzione sulla porta 3100 e un pozzo SMTP sulla porta 1125. I test
leggono le email reali (verifica e inviti) e ne seguono i link. Usano il database di `DATABASE_URL`
(il seed è non distruttivo; i test creano dati con nomi univoci).

## Struttura

```text
apps/web          Next.js 16 (UI, server action, auth, i18n, design system, E2E)
packages/core     casi d'uso multi-tenant (servizi, audit, mailer, logger)
packages/db       Prisma 7, migrazioni con Row-Level Security, contesti di tenancy, seed
packages/domain   regole pure: denaro, permessi, schemi di validazione, costi delle ricette
docs/             specifica, decisioni, architettura
```

## Sicurezza in breve

- L'app usa un ruolo database **senza** privilegi di bypass della RLS; in produzione si rifiuta di
  partire altrimenti.
- Nessun segreto nel repository; le variabili sono validate all'avvio.
- CSP con nonce, header di sicurezza, rate limiting dell'autenticazione, audit log append-only.
- Dettagli in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
