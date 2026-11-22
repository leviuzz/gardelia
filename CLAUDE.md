# CLAUDE.md — istruzioni permanenti per lo sviluppo di Floral OS

Questo file vale per OGNI sessione di Claude Code su questo repository. Leggilo per intero
prima di modificare codice.

## 1. Fonti di verità (in quest'ordine)

1. **Requisiti di prodotto:** `docs/FLORAL_OS_MASTER_SPEC.md` (fonte principale). Le etichette
   DECISO / PROPOSTO / DA VALIDARE vanno rispettate: non trasformare proposte in decisioni.
2. **Decisioni e ADR:** `docs/DECISIONS.md` — aggiornalo quando prendi o cambi una decisione.
3. **Architettura:** `docs/ARCHITECTURE.md` — come è fatto il sistema e perché.
4. **Stato e backlog:** `IMPLEMENTATION_PLAN.md` — cosa è fatto, cosa manca, prossimi task.
   **Perimetro della V1 e criterio di "finito":** `docs/V1_SCOPE.md` (D-22: ai clienti veri arriva solo
   il prodotto finito, nessun pilota).
5. Prompt iniziale storico: `docs/CLAUDE_CODE_START.md`.

Se trovi un conflitto fra richiesta dell'utente, spec e decisioni: **segnalalo prima di implementare**.

## 2. Regole di lavoro

- Ispeziona il codice esistente prima di cambiarlo; non riscrivere architetture senza motivazione scritta in `docs/DECISIONS.md`.
- Lavora per **slice verticali** complete (DB → servizio → UI → test), non per moduli scollegati.
- **Mai funzionalità simulate presentate come reali**: niente pulsanti che promettono funzioni inesistenti, niente pagamenti/AI finti visibili all'utente. Un adattatore finto è ammesso solo in dev/test, etichettato in UI, mai in produzione.
- Nessun segreto nel repo. Ogni nuova variabile va in `.env.example` (con commento) e in `apps/web/src/lib/env.ts` se serve al server web.
- Non inventare fiscalità messicana (IVA, CFDI), split payment o condizioni legali: prepara adattatori e segnala cosa va validato da professionisti.
- A fine sessione aggiorna `IMPLEMENTATION_PLAN.md` (fatto/mancante/prossimi passi) e, se serve, `docs/DECISIONS.md`.
- Lingue: **UI in spagnolo messicano (es-MX)**, codice e identificatori in inglese, documentazione tecnica e commenti in italiano.

## 3. Mappa del monorepo

| Percorso          | Ruolo                                                                  | Dipendenze consentite                            |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| `packages/domain` | Regole pure: denaro, permessi, schemi Zod, costi ricette, mercati      | solo `zod` (nessun I/O)                          |
| `packages/db`     | Schema Prisma, migrazioni SQL (RLS), client, contesti di tenancy, seed | `domain`                                         |
| `packages/core`   | Casi d'uso (servizi) multi-tenant, audit, mailer, logger               | `db`, `domain`                                   |
| `apps/web`        | Next.js 16: pagine, server action, auth, i18n, design system           | `core`, `db` (solo tipi/enum e health), `domain` |

La logica di business sta in `domain`/`core`, **mai** nelle pagine o nelle server action.

## 4. Tenancy — regole NON negoziabili

1. Ogni tabella con dati di un merchant ha `tenantId` **e** una policy RLS. Nella stessa migrazione
   che crea la tabella esegui `SELECT app_enable_tenant_rls('"NomeTabella"');`
   (il test `packages/db/test/rls.test.ts` fallisce se lo dimentichi).
2. Relazioni fra entità dello stesso tenant: **FK composite** `(tenantId, xId) → (tenantId, id)` con `@@unique([tenantId, id])` sul target.
3. Accesso ai dati: solo dentro `withTenantContext(db, ctx, fn)`; **in più** filtra sempre esplicitamente `where: { tenantId: ctx.tenantId, ... }` e imposta `tenantId: ctx.tenantId` nelle create (difesa in profondità).
4. I servizi ricevono un `TenantContext` ottenuto **solo** da `resolveTenantContext` (sessione + membership attiva). Mai accettare `tenantId` dal client.
5. Ogni servizio chiama `requirePermission(ctx, '...')` come prima istruzione. I permessi sono definiti SOLO in `packages/domain/src/permissions.ts`.
6. Ogni pagina e **ogni server action** sotto `/app/[tenantSlug]` chiama `getTenantContext(slug)` (il layout non protegge le action).
7. ID non trovato nel tenant → `notFound(ctx, entity, id)` di `core/src/audit.ts` (404 + evento di sicurezza se l'ID è di un altro tenant). Rispondi 404, mai 403, per risorse di altri tenant.
8. `withSystemContext` (bypass RLS) è vietato da ESLint fuori da: seed/test, `core/src/audit.ts`, `core/src/context.ts`, `core/src/services/team.ts` (inviti via token), `core/src/platform/**` (operazioni di piattaforma, solo CLI: ADR-021; importarlo dal web è vietato). Aggiungerne altri richiede una motivazione in `docs/DECISIONS.md`.
9. L'app deve connettersi con un ruolo **non** superuser e **senza** BYPASSRLS (`DATABASE_URL`); le migrazioni usano il ruolo proprietario (`DATABASE_MIGRATION_URL`).
10. Le funzioni a pagamento chiamano `requireEntitlement(ctx, feature)` nel servizio, dopo `requirePermission`. Il piano non si modifica mai dal web: solo dalla CLI di piattaforma.

## 5. Altre convenzioni tecniche

- **Denaro:** interi in unità minime (`priceMinor`), valuta ISO per riga; conversioni solo ai bordi con `parseMoneyInput` / `formatMoney`. Mai `float` per importi. Prezzi e commissioni si calcolano **solo lato server**; mai fidarsi di importi inviati dal client.
- **AI:** il render non determina mai quantità, inventario, costi o prezzi: la distinta (BOM) è la fonte di verità.
- **Validazione:** schemi Zod in `domain`; messaggi = codici (`required`, `invalid_money`…) tradotti in `messages/es-MX.json` → `validation.*`. I servizi rivalidano sempre l'input.
- **Form:** server action + `useActionState` + `preserveOnSubmit` (evita che React 19 azzeri i campi su errore) + `useActionToast`. Argomenti legati con `.bind()` arrivano dal client: non sono affidabili.
- **Auth:** Better Auth gestisce solo l'identità; i form auth usano il client (`/api/auth/*`) così si applica il rate limiting.
- **Testi UI:** mai stringhe hardcoded nei componenti: chiavi in `apps/web/messages/es-MX.json`.
- **Audit:** modifiche critiche → `recordAudit(tx, ctx, …)` nella stessa transazione, con diff (`diffFields`). Niente PII o dati fiscali in chiaro nei metadati.
- **Log:** `logger` di `@floral/core` (pino, JSON). Logga ID, non email; nessun token/password.
- **Archiviazione:** nessuna cancellazione fisica di dati commerciali; si usa `status: ARCHIVED`.
- **Migrazioni:** `pnpm db:migrate` (crea + applica); vincoli CHECK, policy e indici parziali vanno nel SQL della migrazione (Prisma li ignora nel diff). Non modificare migrazioni già applicate in ambienti condivisi.

## 6. Comandi

```bash
docker compose up -d          # Postgres (ruoli inclusi) + Mailpit
pnpm install
pnpm db:deploy && pnpm db:seed
pnpm dev                      # http://localhost:3000
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test                     # unit + integrazione (DB di test reale, RLS attiva)
pnpm build && pnpm test:e2e   # Playwright sull'app in modalità produzione
```

## 7. Definition of Done (per ogni funzionalità)

- User story chiara (ruolo, scenario principale, almeno un caso d'errore).
- Input validato lato client (UX) e lato server (sicurezza); permessi e tenant verificati nel servizio.
- Test: unit per le regole di dominio, integrazione per servizi/DB **incluso un test di isolamento A↔B**, E2E per il flusso utente critico.
- Stati UI: loading, vuoto, successo, errore; responsive da 320 px; accessibilità di base; testi es-MX.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (e `pnpm test:e2e` se tocchi flussi UI) eseguiti e **verdi**, con esiti riportati onestamente.
- `.env.example`, documentazione e `IMPLEMENTATION_PLAN.md` aggiornati.

## 8. Git

- Branch di lavoro dedicati; commit piccoli e descrittivi (stile conventional commits: `feat`, `fix`, `chore`, `docs`, `test`).
- Mai committare `.env`, dump di database o file in `apps/web/e2e/.auth|.mail`.
