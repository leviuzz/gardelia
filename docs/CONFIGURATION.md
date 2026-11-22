# Configurazione (variabili d'ambiente)

Tutte le variabili dell'app, chi le controlla e quando servono. I valori si mettono nel file
`.env` in locale (copia di [`.env.example`](../.env.example)) e nelle variabili della piattaforma
negli ambienti pubblici. **I segreti non vanno mai nel repository né in chat.**

## Controllo all'avvio

All'avvio del server (`apps/web/src/instrumentation-node.ts`) l'app controlla tutta la
configurazione **prima di ogni altra cosa**. Se qualcosa manca o non torna, il log elenca tutti i
problemi insieme, con il nome della variabile e mai il suo valore, e l'app **non serve nulla**:
ogni richiesta, compreso il controllo di salute `/api/health`, risponde con un errore. Così un
rilascio con una configurazione sbagliata non va in linea, perché il controllo di salute fallisce.
Verificato il 22/11/2026 avviando l'app con tre errori:

```text
Configurazione non valida:
  - BETTER_AUTH_SECRET: deve avere almeno 32 caratteri (generala con: openssl rand -base64 32)
  - FAL_KEY: obbligatoria con AI_PROVIDER=fal (nelle variabili dell’hosting, mai nel repo)
  - STORAGE_DRIVER: filesystem è ammesso solo in locale: con un APP_URL pubblico usa r2
```

Le regole stanno in due schemi, ciascuno scritto una volta sola:

- **server web** (`apps/web/src/lib/env.ts`): URL, login, database;
- **piattaforma** (`packages/core/src/config.ts`), divisa in parti (AI, archivio, email): ogni
  adattatore legge solo la sua parte, già validata.

`apps/web/src/lib/config-check.ts` li unisce per il controllo all'avvio. Dopo la configurazione
l'app verifica anche che il ruolo del database non aggiri la RLS (in produzione, altrimenti, non
parte).

## Regole fra variabili

- `AI_PROVIDER=simulated` e `STORAGE_DRIVER=filesystem` solo con un `APP_URL` locale (localhost):
  mai anteprime simulate o file su disco in un ambiente pubblico.
- `AI_PROVIDER=fal` richiede `FAL_KEY`; `AI_MODEL` deve essere un modello provato.
- Con i job su funzioni (`AI_WORKER_MODE=serverless`, predefinito su Vercel) serve `CRON_SECRET`
  di almeno 32 caratteri, anche senza provider AI: protegge la coda AI e la manutenzione
  giornaliera (scadenze); `AI_MAX_CONCURRENT_JOBS` è un intero da 1 a 50.
- `STORAGE_DRIVER=r2` richiede le quattro variabili `R2_*`.
- In produzione (`NODE_ENV=production`) serve `SMTP_URL`.
- `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`: entrambe o nessuna.
- Una riga vuota nel file `.env` (`X=`) conta come variabile assente.

## Elenco

| Variabile                                          | A cosa serve                                                                     | Quando serve                   | Predefinito                                 | Segreto | Controllata da         |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------- | ------- | ---------------------- |
| `APP_URL`                                          | URL pubblico dell'app; decide se gli adattatori locali sono ammessi              | sempre                         | —                                           | no      | web + piattaforma      |
| `LOG_LEVEL`                                        | livello dei log JSON (pino)                                                      | facoltativa                    | `info`                                      | no      | logger                 |
| `NEXT_TELEMETRY_DISABLED`                          | disattiva la telemetria di Next.js                                               | facoltativa                    | —                                           | no      | Next.js                |
| `DATABASE_URL`                                     | connessione dell'app: ruolo **senza** `BYPASSRLS` (su Neon, URL con pool)        | sempre                         | —                                           | sì      | web + controllo RLS    |
| `DATABASE_MIGRATION_URL`                           | migrazioni con il ruolo proprietario (su Neon, URL diretto)                      | per le migrazioni              | —                                           | sì      | Prisma                 |
| `DATABASE_POOL_MAX`                                | connessioni massime per processo                                                 | facoltativa                    | `10`                                        | no      | client del database    |
| `BETTER_AUTH_SECRET`                               | firma di cookie e token (almeno 32 caratteri)                                    | sempre                         | —                                           | sì      | web                    |
| `BETTER_AUTH_URL`                                  | URL usato da Better Auth                                                         | facoltativa                    | `APP_URL`                                   | no      | web                    |
| `TRUSTED_IP_HEADER`                                | header con l'IP reale dietro proxy (limiti anti-abuso)                           | facoltativa                    | `x-forwarded-for`                           | no      | web                    |
| `GOOGLE_CLIENT_ID`                                 | login con Google (ADR-036)                                                       | facoltativa, con la successiva | —                                           | no      | web                    |
| `GOOGLE_CLIENT_SECRET`                             | login con Google (ADR-036)                                                       | facoltativa, con la precedente | —                                           | sì      | web                    |
| `SMTP_URL`                                         | invio email (verifiche, inviti, reset)                                           | in produzione                  | in sviluppo le email vanno nel log          | sì      | piattaforma (email)    |
| `EMAIL_FROM`                                       | mittente delle email                                                             | facoltativa                    | `Gardelia <no-reply@localhost>`             | no      | piattaforma (email)    |
| `AI_PROVIDER`                                      | `none`, `simulated` (solo locale) o `fal`                                        | facoltativa                    | `none`                                      | no      | piattaforma (AI)       |
| `AI_MODEL`                                         | modello di fal per le anteprime                                                  | facoltativa                    | `nano-banana-2`                             | no      | adattatore fal         |
| `FAL_KEY`                                          | chiave di fal.ai                                                                 | con `AI_PROVIDER=fal`          | —                                           | sì      | piattaforma (AI)       |
| `AI_MONTHLY_BUDGET_USD`                            | tetto di spesa AI del mese, in USD                                               | facoltativa                    | `50`                                        | no      | piattaforma (AI)       |
| `AI_WORKER_MODE`                                   | motore dei job AI: `inline` (nel processo) o `serverless` (funzione a richiesta) | facoltativa                    | `serverless` su Vercel, altrimenti `inline` | no      | piattaforma (AI)       |
| `AI_MAX_CONCURRENT_JOBS`                           | job AI in corso al massimo su tutta la piattaforma                               | facoltativa                    | `8`                                         | no      | piattaforma (AI)       |
| `CRON_SECRET`                                      | protegge i job su funzioni e Vercel Cron (coda AI, manutenzione giornaliera)     | su Vercel (job su funzioni)    | —                                           | sì      | piattaforma (AI)       |
| `STORAGE_DRIVER`                                   | `filesystem` (solo locale) o `r2`                                                | facoltativa                    | `filesystem`                                | no      | piattaforma (archivio) |
| `STORAGE_DIR`                                      | cartella dell'archivio locale                                                    | facoltativa                    | `.storage`                                  | no      | piattaforma (archivio) |
| `R2_ACCOUNT_ID`, `R2_BUCKET`                       | account e bucket di Cloudflare R2                                                | con `STORAGE_DRIVER=r2`        | —                                           | no      | piattaforma (archivio) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`         | chiavi di accesso a R2                                                           | con `STORAGE_DRIVER=r2`        | —                                           | sì      | piattaforma (archivio) |
| `SEED_DEMO_PASSWORD`                               | password degli utenti demo (`pnpm db:seed`, mai in produzione)                   | sviluppo e test                | —                                           | sì      | seed                   |
| `TEST_DATABASE_URL`, `TEST_DATABASE_MIGRATION_URL` | database dei test di integrazione                                                | solo test                      | —                                           | sì      | test                   |

Le variabili `E2E_*` esistono solo nei test end-to-end (porte e Google simulato:
`apps/web/playwright.config.ts`).

## Fuori dall'app (hosting e GitHub)

| Variabile                      | Dove                          | A cosa serve                                                                                      |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `VERCEL`, `VERCEL_ENV`         | impostate da Vercel           | `VERCEL` sceglie i job AI su funzioni; con `VERCEL_ENV=production` la build applica le migrazioni |
| `ENABLE_EXPERIMENTAL_COREPACK` | progetto Vercel, valore `1`   | la build usa la versione di pnpm del repository (`packageManager`)                                |
| `PLATFORM_DATABASE_URL`        | segreto del repository GitHub | workflow "Operazioni di piattaforma": uguale a `DATABASE_URL` dell'ambiente online (ruolo app)    |

La versione di Node in linea è fissata a 22, come in CI (`engines` di `apps/web/package.json` e
`.nvmrc`): si cambiano insieme. Passi per creare l'ambiente online: `docs/DEPLOY_VERCEL.md`.

## Per ambiente

| Variabile                   | Locale                  | Anteprima per PR          | Staging                     | Produzione                  |
| --------------------------- | ----------------------- | ------------------------- | --------------------------- | --------------------------- |
| `APP_URL`                   | `http://localhost:3000` | URL dell'anteprima        | `https://staging.<dominio>` | `https://app.<dominio>`     |
| `DATABASE_URL`              | Postgres in Docker      | branch Neon della PR      | database di staging         | database di produzione      |
| `AI_PROVIDER`               | `simulated` o `fal`     | `none`                    | `fal` (tetto basso)         | `fal`                       |
| `AI_WORKER_MODE`            | `inline`                | `serverless` (automatico) | `serverless`                | `serverless`                |
| `STORAGE_DRIVER`            | `filesystem`            | `r2` (bucket di prova)    | `r2` (bucket di staging)    | `r2` (bucket di produzione) |
| `SMTP_URL`                  | Mailpit                 | cattura, nessun invio     | solo indirizzi del team     | provider reale              |
| `GOOGLE_CLIENT_ID`/`SECRET` | client di sviluppo      | assenti (URL variabili)   | client di staging           | client di produzione        |
