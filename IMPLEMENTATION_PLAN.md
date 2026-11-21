# IMPLEMENTATION_PLAN — Floral OS

Documento vivo per la continuità fra sessioni di sviluppo. **Aggiornalo alla fine di ogni sessione.**
Requisiti: [`docs/FLORAL_OS_MASTER_SPEC.md`](docs/FLORAL_OS_MASTER_SPEC.md) · Decisioni:
[`docs/DECISIONS.md`](docs/DECISIONS.md) · Architettura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

Legenda: ✅ fatto e testato · 🟡 parziale · ⬜ da fare · ⛔ bloccato da una decisione aperta

---

## Stato attuale

**Sprint 1 — CRM → preventivi → Builder deterministico: completato** (21/11/2026), compresi
S1-01…S1-10. Ultima verifica: lint ✅ · format ✅ · typecheck ✅ · test unit + integrazione
187/187 ✅ (89 dominio, 19 DB/RLS, 79 servizi) · build ✅ · E2E 21/21 ✅.

**Prossimo:** Sprint 2 (immagini + pipeline AI) — richiede prima le decisioni **O-01**
(provider/budget AI), **P-01** (coda) e **P-02** (object storage). Vedi "I prossimi task".

---

## Sprint 0 — Fondazioni (completato)

| #   | Elemento                                                                                         | Stato         | Dove                                                               |
| --- | ------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------ |
| 1   | Analisi della documentazione, conflitti e decisioni aperte                                       | ✅            | `docs/DECISIONS.md`                                                |
| 2   | Architettura (modular monolith, 4 package)                                                       | ✅            | `docs/ARCHITECTURE.md`                                             |
| 3   | Monorepo pnpm, TypeScript strict, ESLint (type-aware), Prettier                                  | ✅            | root                                                               |
| 4   | PostgreSQL 16 + Prisma 7: schema, 3 migrazioni, RLS, FK composite, CHECK, indici parziali        | ✅            | `packages/db`                                                      |
| 5   | Due ruoli DB (owner/app) + controllo all'avvio contro ruoli che aggirano la RLS                  | ✅            | `packages/db/scripts`, `apps/web/src/instrumentation.ts`           |
| 6   | Autenticazione: registrazione, verifica email obbligatoria, login, reset password, rate limiting | ✅            | `apps/web/src/lib/auth.ts`, `(auth)/*`                             |
| 7   | Fiorerie (tenant): onboarding con sede strutturata (MX), selettore multi-fioreria, impostazioni  | ✅            | `core/services/tenants.ts`, `/onboarding`, `/settings`             |
| 8   | Ruoli OWNER/MANAGER/STAFF, matrice permessi, inviti via email, cambio ruolo, disattivazione      | ✅            | `domain/permissions.ts`, `core/services/team.ts`, `/settings/team` |
| 9   | Design system (token, componenti, shell responsive con navigazione inferiore mobile)             | ✅            | `apps/web/src/components`                                          |
| 10  | Dashboard con soli dati reali (statistiche catalogo, primi passi, attività recente)              | ✅            | `/app/[tenantSlug]`                                                |
| 11  | Catalogo CRUD (filtri, paginazione, archiviazione), tassonomia canonica                          | ✅            | `/catalog`                                                         |
| 12  | Ricette bouquet (BOM) con costi e margini deterministici                                         | ✅            | `/catalog/[id]`                                                    |
| 13  | Audit log append-only + eventi di sicurezza cross-tenant                                         | ✅            | `core/audit.ts`                                                    |
| 14  | i18n es-MX (next-intl), it/en predisposti                                                        | ✅            | `apps/web/messages`                                                |
| 15  | Seed demo idempotente: 2 fiorerie, 4 utenti, 14 SKU, 2 ricette, 3 clienti                        | ✅            | `packages/db/prisma/seed*.ts`                                      |
| 16  | Test: unit, integrazione su DB reale (isolamento A↔B), E2E con email reali                       | ✅            | `*/test`, `apps/web/e2e`                                           |
| 17  | CI GitHub Actions, docker-compose (Postgres + Mailpit), `.env.example`                           | ✅            | `.github/workflows/ci.yml`                                         |
| 18  | Confini dati per CRM, preventivi e job AI (`Customer`, `Quote`, `AiJob`)                         | ✅ (senza UI) | `schema.prisma`                                                    |

### Rimandato consapevolmente (non presente nello Sprint 0)

- ⬜ Upload immagini (catalogo, logo): richiede object storage (P-02).
- ⬜ Orari di apertura della sede, sedi multiple.
- ✅ Piani SaaS / entitlements / pagina "Plan y funciones" (Sprint 1, ADR-021; pagamenti nello Sprint 4).
- ⬜ Pannello admin di piattaforma (fiorerie, piani, eventi di sicurezza).
- ⬜ Import CSV di clienti/catalogo.
- ⬜ Profilo utente (cambio nome/password da dentro l'app), Google login, 2FA.
- ⬜ Deploy (hosting da decidere, O-04), error tracking (P-05).

---

## Sprint 1 — Slice verticale CRM → preventivo → Builder AI (backlog ordinato e stimato)

Stime in **giorni ideali** di uno sviluppatore (incluse test e documentazione). Ogni task si chiude
solo con la Definition of Done di `CLAUDE.md` (incluso un test di isolamento A↔B per ogni nuova entità).

| Ord. | ID    | Task (piccolo e verificabile)                                                                                                                                                                                                                                                                            | Spec             | Stima | Dipende da          |
| ---- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----- | ------------------- |
| 1    | S1-01 | **Elenco clienti**: ricerca (nome, telefono, email), filtri per tipo/tag, paginazione, stati vuoti                                                                                                                                                                                                       | CRM-01           | 1     | —                   |
| 2    | S1-02 | **Scheda cliente**: creazione/modifica/archiviazione (persona/azienda, telefono E.164, consenso marketing con data, origine), audit                                                                                                                                                                      | CRM-01           | 1,5   | S1-01               |
| 3    | S1-03 | **Indirizzi cliente** multipli (destinatario, indirizzo MX strutturato, istruzioni di consegna)                                                                                                                                                                                                          | CRM-01           | 1     | S1-02               |
| 4    | S1-04 | **Ricorrenze** (compleanno, anniversario, personalizzata; acquirente vs destinatario) + "prossime ricorrenze" in dashboard                                                                                                                                                                               | CRM-01           | 1     | S1-02               |
| 5    | S1-05 | **Pricing engine v1** (dominio puro): righe, sconti, policy fiscale configurabile (default "IVA incluida", da validare O-06), arrotondamenti documentati, test esaustivi                                                                                                                                 | ORD-01, BQ-01    | 1,5   | —                   |
| 6    | S1-06 | **Numerazione per tenant** (`TenantCounter`, incremento atomico, formato `COT-0001`)                                                                                                                                                                                                                     | P-08             | 0,5   | —                   |
| 7    | S1-07 | **Preventivo in bozza**: righe da catalogo (bouquet con snapshot della distinta) e righe libere, validità, note; totali solo lato server                                                                                                                                                                 | ORD-01           | 2     | S1-02, S1-05, S1-06 |
| 8    | S1-08 | **Stati del preventivo** (DRAFT→SENT→ACCEPTED/REJECTED/EXPIRED/CANCELLED) come macchina a stati nel dominio + audit; test ORD-01 (lo snapshot non cambia se cambia il listino)                                                                                                                           | ORD-01           | 1     | S1-07               |
| 9    | S1-09 | **Piani ed entitlements** v0: `SaasPlan`, `TenantSubscription` assegnata manualmente (stato `PILOT`), `requireEntitlement`, quota AI per periodo; nessun pagamento                                                                                                                                       | BILL-01          | 1,5   | —                   |
| 10   | S1-10 | **Bouquet Builder (merchant)**: flag "usabile nel Builder" sugli SKU, scelta ingredienti/quantità/stile/packaging, prezzo live deterministico calcolato dal server, avvisi di disponibilità (`ON_REQUEST`, `LIMITED`, `OUT_OF_STOCK`), salvataggio `BouquetConfiguration` con snapshot → crea preventivo | AI-BQ-01…04, 06  | 3     | S1-05, S1-07, S1-09 |
| 11   | S1-11 | **Object storage** (R2/S3, URL firmati, chiavi per tenant, validazione tipo/dimensione) + immagini del catalogo                                                                                                                                                                                          | CAT-01, MEDIA-01 | 1,5   | P-02                |
| 12   | S1-12 | **Pipeline job AI**: coda (P-01), processo `apps/worker`, adattatore provider, stati `queued/generating/ready/failed`, retry limitati, timeout, quota consumata solo a successo (O-05), caching per hash della configurazione                                                                            | AI-BQ-05, 11     | 3     | S1-09, S1-11, P-01  |
| 13   | S1-13 | **Provider AI reale**: adattatore, prompt versionato, immagini di riferimento con licenza, moderazione, disclaimer "anteprima illustrativa"                                                                                                                                                              | AI-BQ-05, 07     | 2     | ⛔ O-01             |
| 14   | S1-14 | **E2E della slice**: cliente → preventivo → Builder → preventivo con distinta esatta; anteprima AI (BQ-02: se l'AI fallisce il preventivo resta e nessuna anteprima viene inventata)                                                                                                                     | BQ-01/02         | 1     | S1-10, S1-12        |

**Totale stimato:** ≈ 21,5 giorni ideali. Una sola iterazione di 2 settimane non basta: si propone
il **taglio** seguente.

- **Sprint 1 (≈ 2 settimane):** S1-01 → S1-10 + E2E parziale (cliente → preventivo → Builder
  deterministico). Risultato vendibile in demo: preventivi reali con distinta e prezzo corretto.
- **Sprint 2 (≈ 1,5 settimane):** S1-11 → S1-14 (immagini, pipeline AI, provider reale). Richiede
  prima le decisioni **O-01** (provider/budget) e **P-01/P-02** (coda e storage).

### Stato dello Sprint 1

| ID    | Stato | Dove                                                                                               |
| ----- | ----- | -------------------------------------------------------------------------------------------------- |
| S1-01 | ✅    | `/customers` (ricerca, filtri, paginazione), `core/services/customers.ts`                          |
| S1-02 | ✅    | `/customers/[id]`: scheda, archiviazione, consenso con data, audit senza PII (ADR-019)             |
| S1-03 | ✅    | indirizzi multipli con predefinito unico (indice parziale)                                         |
| S1-04 | ✅    | ricorrenze (29/02 → 28/02 negli anni non bisestili) + "Fechas especiales próximas" in dashboard    |
| S1-05 | ✅    | `domain/quote.ts` (`priceQuote`), prezzi finali senza IVA finché O-06 è aperta (ADR-020)           |
| S1-06 | ✅    | `TenantCounter` atomico, `COT-0001`                                                                |
| S1-07 | ✅    | `/quotes`, `/quotes/new`, `/quotes/[id]`: righe da catalogo con snapshot, righe libere, sconto     |
| S1-08 | ✅    | stati con macchina a stati di dominio, scadenza "pigra", stampa/PDF, WhatsApp                      |
| S1-09 | ✅    | `SaasPlan`/`TenantSubscription`, `requireEntitlement`, CLI `platform:assign-plan` (ADR-021)        |
| S1-10 | ✅    | `/builder`: prezzo live = prezzo server, disegni salvati, preventivo con distinta esatta (ADR-023) |
| E2E   | 🟡    | cliente → preventivo → Builder → preventivo ✅; parte AI (BQ-02) con lo Sprint 2                   |

### I prossimi task (nell'ordine)

1. **Decisioni** O-01 (provider AI e budget del benchmark), P-01 (coda su Postgres), P-02 (R2) — bloccanti per lo Sprint 2.
2. S1-11 Object storage + immagini del catalogo (anche nel Builder e nei preventivi stampati).
3. S1-12 Pipeline job AI (`apps/worker`, stati, retry, quota a consumo secondo O-05).
4. S1-13 Provider AI reale (prompt versionato, moderazione, disclaimer "vista previa ilustrativa").
5. S1-14 E2E BQ-02 (se l'AI fallisce il preventivo resta e nessuna anteprima viene inventata).
6. Aggiungere un disegno del Builder a un preventivo in bozza esistente (oggi crea un nuovo preventivo).
7. Ordini da preventivo accettato (Sprint 3): `ACCEPTED → ordine` con la stessa distinta.
8. Contador: validare O-06 (IVA nei preventivi) prima di mostrare imposte.
9. Pannello admin di piattaforma minimo (oggi CLI) con autenticazione forte e audit.
10. Promemoria delle ricorrenze (email/WhatsApp) — richiede consenso e canale validati.

---

## Roadmap tecnica (indicativa)

| Sprint | Obiettivo                                                                                                                                                         | Moduli spec                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| S0 ✅  | Fondazioni: monorepo, DB con RLS, auth, tenant, ruoli, inviti, catalogo, ricette, dashboard                                                                       | CORE-01, CAT-01 (parziale)               |
| S1 ✅  | CRM + preventivi + Builder deterministico + entitlements v0                                                                                                       | CRM-01, ORD-01 (preventivi), AI-BQ-01…06 |
| S2     | Immagini + pipeline AI + provider reale + quote                                                                                                                   | AI-BQ-05/07/11, MEDIA-01                 |
| S3     | Ordini (da preventivo, stati, pagamenti registrati a mano, consegne, calendario) + inventario base (saldi, movimenti, riserve)                                    | ORD-01, INV-01                           |
| S4     | Billing Basic/Plus (adattatore Stripe, webhook idempotenti, "Plan y uso"), admin di piattaforma minimo, form lead B2B con coda manuale (NET-00), Google login/2FA | BILL-01, NET-00                          |
| S5     | Floral Care: abbonamenti cliente, visite programmate, checklist; report P0                                                                                        | SUB-01, CARE-01, BI-01                   |
| S6+    | Floral Network (profili, lead strutturati, offerte, contratti, ledger fee) → Flora Studio                                                                         | NET-01…03, AI-RM                         |

---

## Registro delle sessioni

### 2026-11-21 — Sprint 0

- Repo vuoto all'inizio: creato il monorepo da zero.
- Implementati tutti gli elementi della tabella Sprint 0.
- Verifiche eseguite: `pnpm lint` ✅, `pnpm format:check` ✅, `pnpm typecheck` ✅,
  `pnpm test` 113/113 ✅ (57 unit, 17 DB/RLS, 39 servizi), `pnpm build` ✅, `pnpm test:e2e` 12/12 ✅.
- Problemi trovati e risolti durante lo sprint: reset automatico dei form in React 19 (ADR-017);
  link di verifica email senza `callbackURL` dopo un login non verificato (ora conserva la destinazione);
  HSTS/`upgrade-insecure-requests` ora solo con HTTPS.
- Prossimo passo: decisioni O-01, O-06 e P-01/P-02, poi Sprint 1 (S1-01).

### 2026-11-21 — Sprint 1 (S1-01 → S1-10)

- **Slice A — CRM:** clienti (persona/azienda, telefono E.164, consenso con data, origine sempre
  `MERCHANT_DIRECT`), indirizzi di consegna, ricorrenze con prossime date in dashboard.
- **Slice B — Preventivi:** motore prezzi puro, numerazione per tenant, righe da catalogo con
  snapshot (prezzo, costo, distinta), righe libere, sconto ≤ subtotale, stati e scadenza, stampa/PDF,
  condivisione WhatsApp generata dal server, scheda cliente con i suoi preventivi.
- **Slice C — Piani:** `SaasPlan`/`TenantSubscription` con RLS (il merchant legge, non scrive),
  `requireEntitlement`, assegnazione solo da CLI di piattaforma con operatore SUPER_ADMIN.
- **Slice D — Builder:** componenti abilitati dal catalogo, prezzo live con la stessa funzione del
  server (BQ-01), disegni salvati, preventivo con distinta esatta e prezzi attuali, cargo per armado
  configurabile, invito all'upgrade per Basic.
- Trasversale: toast emessi alla fine dell'azione (ADR-022), menu "Más" su mobile, stampa pulita.
- Verifiche: `pnpm lint` ✅, `pnpm format:check` ✅, `pnpm typecheck` ✅, `pnpm test` 187/187 ✅,
  `pnpm build` ✅, `pnpm test:e2e` 21/21 ✅ (anche 320 px verificato a mano con screenshot).
- Problemi risolti: toast persi quando il componente si smonta dopo l'azione; `ALTER TYPE … ADD VALUE`
  non utilizzabile nella stessa transazione (vincolo spostato in una migrazione separata);
  aggiornamento dati in migrazione con FORCE RLS (bypass solo per quello statement).
