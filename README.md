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

## Cosa funziona oggi (Sprint 0)

- Registrazione con verifica email obbligatoria, login, recupero password (rate limiting incluso).
- Creazione della fioreria (onboarding con indirizzo strutturato per il Messico), più fiorerie per utente.
- Ruoli **Propietario / Gerente / Equipo** con permessi applicati lato server; inviti via email,
  cambio ruolo, disattivazione; lo staff non vede costi e margini.
- **Catalogo**: fiori, follaje, piante, ramos, materiali e servizi, con prezzo, costo, disponibilità,
  colori, etichette, ricerca, filtri, paginazione, archiviazione.
- **Ricette dei ramos** (distinta base) con costo materiali, manodopera e margini calcolati in modo
  deterministico; i margini non vengono mostrati se mancano dei costi.
- Dashboard con dati reali, registro attività, banner per le fiorerie demo.
- Isolamento fra fiorerie garantito anche dal database (Row-Level Security PostgreSQL).

Clienti, preventivi, ordini, Builder AI e pagamenti **non sono ancora disponibili** e non compaiono
nell'interfaccia (vedi `IMPLEMENTATION_PLAN.md`).

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
