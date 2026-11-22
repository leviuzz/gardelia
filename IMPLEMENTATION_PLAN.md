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

**Sprint 2 — anteprime AI: funzionanti con il provider reale** (21/11/2026): fal.ai con
**Nano Banana 2** (ADR-026), scelto col confronto su 5 ramos demo; quota 25/mese, pacchetti extra via
CLI, cache per fioreria, tetto di spesa, worker, archivio R2/locale; provider simulato solo in
locale. Ultima verifica: lint ✅ · format ✅ · typecheck ✅ · test 262/262 ✅ · build ✅ ·
E2E 28/28 ✅ · una generazione reale dal Diseñador ✅ (12 s, 0,08 USD).

**Foto del catalogo e "Mis ramos"** (21/11/2026, ADR-029): fiori da più angolazioni, carte e
nastri per colore, foto di stile con consenso.

**Colori di carta e nastro nel Diseñador** (21/11/2026, ADR-030): colore obbligatorio quando
l'articolo ne ha più di uno, con la sua foto; arriva in cotización e nell'anteprima.

**Stile della fioreria nelle anteprime** (21/11/2026, ADR-032): lo stile di "Mis ramos",
descritto a parole una volta per foto, accompagna le anteprime; la foto non va mai al modello.

**Scontorno automatico delle foto del catalogo** (21/11/2026, ADR-033): BiRefNet via fal
(~0,002 USD a foto, a carico della piattaforma), stato per foto ("Quitando el fondo…", "Sin
fondo", consiglio per rifarla, "Reintentar"); "Mis ramos" mantiene il fondo. Ultima verifica:
lint ✅ · format ✅ · typecheck ✅ · test 272/272 ✅ · build ✅ · E2E 28/28 ✅.

**Anteprima esatta** (21/11/2026, ADR-034): con la foto di ogni fiore il Diseñador mostra
subito il boceto con il numero esatto di fiori (gratis); la foto realistica parte dal boceto e si
mostra solo se un modello di visione ritrova gli stessi numeri ("Número de flores verificado").
Dopo il giudizio del founder sulla v1 ("sembra un collage") il boceto è stato rifatto come un
ramo vero (v2: corolle fitte a cupola, steli nascosti) e il conteggio ha una seconda opinione.
Ultima verifica: lint ✅ · format ✅ · typecheck ✅ · test 310/310 ✅ · build ✅ · E2E 30/30 ✅.

**Login con Google** (21/11/2026, ADR-036, richiesto dal founder): "Continuar con Google" in
accesso, registrazione e inviti; attivo solo con le chiavi del client OAuth (senza, il pulsante non
compare). Collegamento a un account esistente solo con email verificata da Google e da noi; email
non verificata da Google = nessuna sessione; niente foto del profilo; token cifrati. Negli E2E
Google è simulato nel server di test, il resto del flusso è reale. Ultima verifica: lint ✅ ·
format ✅ · typecheck ✅ · test 329/329 ✅ (+15 unità del web) · build ✅ · E2E 36/36 ✅.
**Per attivarlo serve il founder:** client OAuth su Google Cloud con dominio e account aziendale
(passi in ADR-036) e una riga nell'aviso de privacidad (O-07).

**Prossimo:** prova con foto vere di una fioreria del pilota e prova da ~100 immagini (costo
reale). Vedi "I prossimi task".

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

| Ord. | ID    | Task (piccolo e verificabile)                                                                                                                                                                                                                                                                               | Spec             | Stima | Dipende da          |
| ---- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----- | ------------------- |
| 1    | S1-01 | **Elenco clienti**: ricerca (nome, telefono, email), filtri per tipo/tag, paginazione, stati vuoti                                                                                                                                                                                                          | CRM-01           | 1     | —                   |
| 2    | S1-02 | **Scheda cliente**: creazione/modifica/archiviazione (persona/azienda, telefono E.164, consenso marketing con data, origine), audit                                                                                                                                                                         | CRM-01           | 1,5   | S1-01               |
| 3    | S1-03 | **Indirizzi cliente** multipli (destinatario, indirizzo MX strutturato, istruzioni di consegna)                                                                                                                                                                                                             | CRM-01           | 1     | S1-02               |
| 4    | S1-04 | **Ricorrenze** (compleanno, anniversario, personalizzata; acquirente vs destinatario) + "prossime ricorrenze" in dashboard                                                                                                                                                                                  | CRM-01           | 1     | S1-02               |
| 5    | S1-05 | **Pricing engine v1** (dominio puro): righe, sconti, policy fiscale configurabile (default "IVA incluida", da validare O-06), arrotondamenti documentati, test esaustivi                                                                                                                                    | ORD-01, BQ-01    | 1,5   | —                   |
| 6    | S1-06 | **Numerazione per tenant** (`TenantCounter`, incremento atomico, formato `COT-0001`)                                                                                                                                                                                                                        | P-08             | 0,5   | —                   |
| 7    | S1-07 | **Preventivo in bozza**: righe da catalogo (bouquet con snapshot della distinta) e righe libere, validità, note; totali solo lato server                                                                                                                                                                    | ORD-01           | 2     | S1-02, S1-05, S1-06 |
| 8    | S1-08 | **Stati del preventivo** (DRAFT→SENT→ACCEPTED/REJECTED/EXPIRED/CANCELLED) come macchina a stati nel dominio + audit; test ORD-01 (lo snapshot non cambia se cambia il listino)                                                                                                                              | ORD-01           | 1     | S1-07               |
| 9    | S1-09 | **Piani ed entitlements** v0: `SaasPlan`, `TenantSubscription` assegnata manualmente (stato `PILOT`), `requireEntitlement`, quota AI per periodo; nessun pagamento                                                                                                                                          | BILL-01          | 1,5   | —                   |
| 10   | S1-10 | **Bouquet Builder (merchant)**: flag "usabile nel Builder" sugli SKU, scelta ingredienti/quantità/stile/packaging, prezzo live deterministico calcolato dal server, avvisi di disponibilità (`ON_REQUEST`, `LIMITED`, `OUT_OF_STOCK`), salvataggio `BouquetConfiguration` con snapshot → crea preventivo    | AI-BQ-01…04, 06  | 3     | S1-05, S1-07, S1-09 |
| 11   | S1-11 | **Object storage** (R2/S3, URL firmati, chiavi per tenant, validazione tipo/dimensione) + immagini del catalogo                                                                                                                                                                                             | CAT-01, MEDIA-01 | 1,5   | P-02                |
| 12   | S1-12 | **Pipeline job AI**: coda (P-01), processo `apps/worker`, adattatore provider, stati `queued/generating/ready/failed`, retry limitati, timeout, quota mensile + crediti extra (`AiCreditGrant`, CLI `platform:grant-ai-credits`) consumati solo a successo (ADR-024), caching per hash della configurazione | AI-BQ-05, 11     | 3     | S1-09, S1-11, P-01  |
| 13   | S1-13 | **Provider AI reale**: adattatore, prompt versionato, immagini di riferimento con licenza, moderazione, disclaimer "anteprima illustrativa"                                                                                                                                                                 | AI-BQ-05, 07     | 2     | ⛔ O-01             |
| 14   | S1-14 | **E2E della slice**: cliente → preventivo → Builder → preventivo con distinta esatta; anteprima AI (BQ-02: se l'AI fallisce il preventivo resta e nessuna anteprima viene inventata)                                                                                                                        | BQ-01/02         | 1     | S1-10, S1-12        |

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
| E2E   | ✅    | cliente → preventivo → Builder → preventivo; anteprima (simulata) con cache e privacy              |

### Sprint 2 — stato

| ID    | Stato | Dove                                                                                                              |
| ----- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| S1-11 | ✅    | archivio R2/locale; foto del catalogo (viste, colori, scontorno ADR-033) e "Mis ramos" con consenso (ADR-029)     |
| S1-12 | ✅    | `AiJob` come coda (SKIP LOCKED, lease, retry), worker nel processo web, quota/pacchetti/cache/tetto (ADR-024/025) |
| S1-13 | ✅    | provider reale fal.ai + Nano Banana 2 (`core/src/ai/fal.ts`, ADR-026); alternativa GPT Image 2 con `AI_MODEL`     |
| S1-14 | ✅    | E2E con provider simulato; BQ-02 e errori del provider coperti da test; una generazione reale verificata nell'app |

### I prossimi task (nell'ordine)

**In attesa del founder:** piano di piattaforma (`docs/PLATFORM_PLAN.md`: ambienti, hosting,
rilasci, errori, refactor del codice, roadmap). Rivisto il 21/11 sera su richiesta del founder
("non risparmiamo"): consigliati **Vercel + Neon** (job AI in funzioni su coda Postgres, anteprima
con database per ogni PR); Render resta la riserva. Approvato il link pubblico del preventivo (21/11).

**Fase 0, errori e log (fatto il 22/11):** un errore in una pagina della fioreria non fa più
sparire il menu (confine d'errore con "Reintentar", "Ir al inicio" e riferimento); 404 dentro il
menu con lo stato 404 conservato; errore globale; rotella sulla voce del menu durante la
navigazione; ogni errore non gestito finisce nel log JSON con ID della richiesta, `digest` e route
(senza percorsi reali né token); ID della richiesta anche sulle API. Verificato dal vivo con un
errore provocato apposta (poi rimosso): 500, menu presente, riferimento uguale nel log. Ultima
verifica: lint ✅ · format ✅ · typecheck ✅ · test 333/333 ✅ · build ✅ · E2E 38/38 ✅.

**Fase 0, configurazione unica (fatto il 22/11):** ogni regola sulle variabili d'ambiente è
scritta una volta: schema del web (URL, login, database) e schema della piattaforma diviso in AI,
archivio ed email (`packages/core/src/config.ts`, anche come `@floral/core/config`); gli
adattatori leggono valori già validati. All'avvio l'app controlla tutto e, se qualcosa non va, il log
elenca tutti i problemi e ogni richiesta (anche `/api/health`) risponde con un errore: un rilascio
sbagliato non va in linea (prima alcuni emergevano solo al primo login o al primo invio).
Tabella delle variabili e valori per ambiente in `docs/CONFIGURATION.md`. Cambio di comportamento:
con `AI_PROVIDER=fal` senza chiave, o il simulato con un URL pubblico, anche scontorni, conteggio
e stile ora segnalano l'errore invece di spegnersi in silenzio. Ultima verifica: lint ✅ ·
format ✅ · typecheck ✅ · test 343/343 ✅ · build ✅ · E2E 38/38 ✅ · avvio con tre errori di
configurazione provato dal vivo. Prossimo blocco della fase 0: errori silenziosi (avviso nel form,
riavvio del worker AI).

**Fase 0, sicurezza delle dipendenze (fatto il 22/11):** Better Auth all'ultima versione stabile
(1.7.27). L'avviso alto su `effect` 3.20.0 (ReDoS, GHSA-7589-6fvf-x4pw), arrivato tramite
`prisma` → `@prisma/config`, è chiuso con un override pnpm a ≥ 3.22.1 (`pnpm-workspace.yaml`);
`pnpm audit --prod` non trova vulnerabilità; `prisma generate`, migrazioni e 329 test verdi. Da
togliere quando Prisma aggiornerà la dipendenza.

1. Prima del pilota: foto vere di una fioreria (scontorno e anteprima esatta) e prova da ~100 immagini → costo reale (foto, controlli, scontorni) riconciliato con la fattura fal → prezzi dei pacchetti (ADR-024); `FAL_KEY` e R2 nell'hosting (P-03, O-04).
2. Boceto: contenitori (caja, florero) disegnati meglio e "tamaño" del ramo; foto: scelta della copertina e "usa l'originale" se il ritaglio non piace. (Fatto: proporzioni per tipo di fiore e angolazioni alternate.)
3. Link per il cliente: pagina pubblica del preventivo (token, scadenza, revoca) con l'immagine del ramo, da mandare su WhatsApp; privacy da validare (O-07). Oggi l'immagine si scarica e si allega a mano (ADR-035).
4. Builder pubblico per i clienti della fioreria (AI-BQ-10), dopo il pilota del Builder interno.
5. Aggiungere un disegno del Builder a un preventivo in bozza esistente.
6. Ordini da preventivo accettato (Sprint 3) con la stessa distinta.
7. Contador: IVA nei preventivi e fatturazione dei pacchetti (O-06, O-02).
8. Pannello admin di piattaforma minimo (oggi CLI) con autenticazione forte e audit.

---

## Roadmap tecnica (indicativa)

| Sprint | Obiettivo                                                                                                                                                         | Moduli spec                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| S0 ✅  | Fondazioni: monorepo, DB con RLS, auth, tenant, ruoli, inviti, catalogo, ricette, dashboard                                                                       | CORE-01, CAT-01 (parziale)               |
| S1 ✅  | CRM + preventivi + Builder deterministico + entitlements v0                                                                                                       | CRM-01, ORD-01 (preventivi), AI-BQ-01…06 |
| S2 🟡  | Immagini + pipeline AI + provider reale + quote (pipeline e quote fatte; manca il provider reale)                                                                 | AI-BQ-05/07/11, MEDIA-01                 |
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

### 2026-11-21 — Decisione sul costo dell'AI

- Il founder ha scelto (D-21, ADR-024): quota mensile inclusa nel Plus + pacchetti extra pagati
  alla piattaforma, che sblocca X anteprime (CLI auditata nel pilota). Nessun collegamento di
  account AI del fiorista.
- Da definire: numero di anteprime incluse, taglie/prezzi dei pacchetti, scadenza dei crediti,
  tetto mensile di spesa; restano aperte O-01, P-01, P-02 per iniziare lo Sprint 2.

### 2026-11-21 — Sprint 2: pipeline delle anteprime AI

- Decisioni (delegate dal founder): 25 anteprime/mese nel Plus, extra senza scadenza, tetto 50 USD/mese,
  pacchetti 25/50/100 (prezzi dopo il benchmark), coda su PostgreSQL, archivio R2, provider fal.ai.
- Cache per fioreria (idea del founder): ramo identico = stessa immagine per qualsiasi cliente, senza
  consumo; mai fra fiorerie (spec 6.6). Il prompt non contiene dati del cliente.
- Fatto: regole di dominio (periodo nel fuso, saldo, prompt), `AiCreditGrant` + funzioni SQL della
  coda, servizio anteprime, worker, CLI `platform:grant-ai-credits`, pannello nel Diseñador, uso nel
  piano, route privata delle immagini, provider simulato etichettato (rifiutato in produzione).
- Verifiche: lint ✅, format ✅, typecheck ✅, `pnpm test` 206/206 ✅ (due esecuzioni), build ✅ (senza
  avvisi Edge), E2E 22/22 ✅ (due esecuzioni della parte Builder).
- Bloccato: provider reale (serve la chiave del founder).
- Revisione (domanda del founder): fal.ai non è necessario adesso. Scelta del modello in 3 passi
  (`docs/AI_BENCHMARK.md`): prova manuale gratuita in ChatGPT/Gemini con i nostri prompt, poi
  account diretto del vincitore con ~10 € prepagati, poi prova da ~100 immagini prima del pilota.

### 2026-11-21 — Sprint 2: provider reale (fal.ai)

- Founder: account fal.ai con 10 € prepagati; chiave salvata nel modulo sicuro dell'ambiente
  cloud (il proxy la inserisce nelle richieste a `fal.run`, mai vista né salvata nel repo).
- Confronto di 3 modelli sui 5 ramos demo (15 immagini, ~0,80 USD): scelto **Nano Banana 2**,
  alternativa GPT Image 2, escluso FLUX.2 pro (`docs/AI_BENCHMARK.md`, ADR-026).
- Fatto: `FalImageProvider` (`sync_mode`, tipo dai byte, limiti di dimensione, download solo da
  `*.fal.media`, chiave in campo privato), errori `content_rejected`/`invalid_request` senza nuovi
  tentativi, `AI_PROVIDER=fal` + `AI_MODEL` + `FAL_KEY` in `env.ts` e `.env.example`; tipi comuni
  in `core/src/ai/provider-types.ts`.
- Verifiche: lint ✅, format ✅, typecheck ✅, `pnpm test` 222/222 ✅ (+16: adattatore fal con
  `fetch` finto, fabbrica da env, worker senza retry su `invalid_request`), build ✅, E2E 22/22 ✅.
  Generazione reale dal Diseñador (server di produzione locale con `AI_PROVIDER=fal`): immagine in
  12 s, job SUCCEEDED, 1 credito, costo stimato 0,08 USD; rose 8 invece di 7 e un fiocco in più
  (limite noto, avvertenza già presente).
- Nota per le sessioni cloud: il `fetch` di Node passa dal proxy solo con `NODE_USE_ENV_PROXY=1`;
  `FAL_KEY` può essere un segnaposto perché la chiave la inserisce il proxy.
- Spesa fal finora: ≈0,90 USD su 10 € (stima da listino).

### 2026-11-21 — Prompt v2 e direzione "conteggio esatto"

- Founder: il fiorista caricherà foto dei singoli fiori (più angolazioni); il cliente comporrà il
  ramo e sceglierà colore di carta e nastro; l'immagine deve avere il numero esatto di fiori.
- Prove (~0,70 USD, `docs/AI_BENCHMARK.md`): prompt v2 esatto in 2 ramos su 3 (v1: 0 su 3);
  conteggio automatico con modelli di visione utile ma non infallibile; la composizione fatta dal
  sistema e resa foto dall'AI è risultata esatta al primo colpo, le sole foto di riferimento no.
- Fatto: prompt `bouquet-preview-v2` (ADR-027) con nome comune inglese dalla tassonomia,
  conteggi espliciti, colori di carta e nastro, niente nastro se non in distinta; test di dominio e
  di integrazione. ADR-028 (requisito del founder + approccio proposto) registrato.
- Verifiche: lint ✅, format ✅, typecheck ✅, `pnpm test` 225/225 ✅, build ✅, E2E 22/22 ✅.
- Spesa fal totale: ≈1,6 USD su 10 € (stima da listino).

### 2026-11-21 — Naturalezza, stile del fiorista, carte e nastri

- Founder: anche carte e nastri hanno tipi diversi → foto anche per loro; le immagini sono troppo
  simmetriche; domanda se addestrare l'AI con i ramos del fiorista.
- Prove (~0,40 USD, `docs/AI_BENCHMARK.md`): prompt "fatto a mano" esatto su 3 + 3 e più
  naturale; composizione asimmetrica resa foto esatta (serve scontorno pulito); foto di stile del
  fiorista ripresa senza copiarne fiori e carta.
- Fatto: prompt `bouquet-preview-v3` (ADR-027). ADR-028 aggiornato: foto per carte e nastri,
  stile tramite riferimenti, niente addestramento per ora (motivi nell'ADR).
- Verifiche: lint ✅, format ✅, typecheck ✅, `pnpm test` 226/226 ✅, build ✅, E2E 22/22 ✅.
- Spesa fal totale: ≈2 USD su 10 € (stima da listino).

### 2026-11-21 — Foto del catalogo e "Mis ramos" (S1-11, ADR-029)

- Founder: foto dei singoli fiori da più angolazioni, foto anche per carte e nastri (tipi e colori
  diversi), foto dei propri ramos come stile, con consenso.
- Fatto: tabelle `CatalogItemPhoto` e `StyleReferencePhoto` (RLS, FK composita, CHECK sulle chiavi
  dell'archivio), normalizzazione con sharp (tipo dai byte, limiti, EXIF/GPS eliminati, 1600 px +
  miniatura), servizi con limiti sotto lock, audit e attività in dashboard, route private, sezione
  "Fotos" nella scheda dell'articolo (vista, colore obbligatorio per carte/vasi/nastri), copertina
  nell'elenco, pagina "Mis ramos" (Plus, consenso obbligatorio), caricamento una foto alla volta
  con riduzione nel browser e avanzamento.
- Verifiche: lint ✅, format ✅, typecheck ✅, `pnpm test` 245/245 ✅ (+19: dominio, RLS/chiavi,
  servizi con immagini vere, isolamento A↔B), build ✅, E2E 27/27 ✅ (+5: caricamento reale, privacy
  fra fiorerie, colore del nastro, staff in sola lettura, consenso, piano Basic).
- Nota: le foto non entrano ancora nelle anteprime AI (prossimi passi in "I prossimi task").

### 2026-11-21 — Colore di carta e nastro nel Diseñador (ADR-030)

- Founder: il cliente sceglie il colore della carta e del nastro; carte e nastri hanno tipi e
  colori diversi.
- Fatto: regola unica del colore di riga (dominio), colonna `BouquetConfigurationLine.color`,
  validazione sul server a salvataggio/preventivo/anteprima, foto per colore nel catalogo del
  Builder, selettore con foto o campione, riepilogo "1 × Papel coreano · Lila", distinta della
  cotización "(lila)", prompt con il solo colore scelto; nuovi colori (negro, dorado, plateado,
  café, transparente), fino a 12 colori per articolo; demo: "Papel coreano" (4 colori) e
  "Listón de organza" (3 colori).
- Verifiche: lint ✅, format ✅, typecheck ✅, `pnpm test` 252/252 ✅ (+7: regola del colore, schema,
  servizi, preventivo, catalogo con foto per colore, prompt e cache), build ✅, E2E 28/28 ✅ (+1:
  colore obbligatorio → salvataggio → cotización).

### 2026-11-21 — Prova: "Mis ramos" come riferimento nelle anteprime (ADR-031)

- Criterio del founder: attivare solo se i numeri dei fiori non peggiorano.
- Prova (9 immagini, ~0,72 USD): con la foto di stile ramos esatti 1 su 6 contro 1 su 3 senza; in
  4 immagini su 6 è comparso il vaso di vetro della foto di stile. **Non attivato**; nessuna
  modifica al codice di produzione (la variante del prompt usata per la prova è stata tolta).
- Prossimo: provare lo stile descritto a parole, oppure passare allo scontorno e alla composizione.
- Spesa fal totale: ≈2,9 USD su 10 € (stima da listino).

### 2026-11-21 — Stile di "Mis ramos" a parole nelle anteprime (ADR-032)

- Prova (~0,50 USD): stile descritto a parole da Claude Sonnet 4.5 → ramos esatti 4 su 6, nessun
  oggetto copiato (con la foto: 1 su 6 e vaso copiato). Criterio del founder rispettato.
- Fatto: `cleanStyleDescription` e prompt v4 (dominio), colonne della descrizione su
  `StyleReferencePhoto`, `FalStyleDescriber` e simulato, scelta stabile della foto per stile,
  worker che descrive una volta e ripiega senza stile se qualcosa fallisce, costo nel job, UI
  ("Estilo: …" in "Mis ramos", nota nell'anteprima).
- Verifiche: lint ✅, format ✅, typecheck ✅, `pnpm test` 262/262 ✅ (+10: pulizia del testo, chiave
  di cache, descrittore fal, descrizione una sola volta, scelta per stile, ripiego, isolamento),
  build ✅, E2E 28/28 ✅; anteprima reale nell'app: 3 girasoli esatti, carta lilla, nastro dorato,
  stile ripreso, 19 s, 0,09 USD.
- Spesa fal totale: ≈3,5 USD su 10 € (stima da listino).

### 2026-11-21 — Scontorno automatico delle foto (ADR-033)

- Richiesta del founder: togliere il fondo alle foto di fiori, carte, nastri e ramos del catalogo,
  chiedendo al fiorista un fondo liso che contrasti; valutare remove.bg e i costi.
- Confronto (~0,08 USD): BiRefNet v2 e Bria RMBG 2.0 via fal ugualmente puliti anche su fondi non
  lisi; BiRefNet ~0,002 USD a foto contro 0,018 → scelto. remove.bg scartato (più caro, e a mano
  sarebbe un passaggio in più per il fiorista). Algoritmo locale solo per sviluppo e test.
- Fatto: `judgeCutout` e `canRequestCutout` (dominio, limite di 3 richieste per foto); stato del
  ritaglio su `CatalogItemPhoto` con vincoli SQL; `BackgroundRemover` (fal BiRefNet, locale);
  job `PHOTO_CUTOUT` accodato nella stessa transazione del caricamento, senza crediti e dentro il
  tetto di spesa (`fitsMonthlyAiBudget`, ora condiviso con le anteprime); worker con controllo di
  qualità, rifilatura, PNG e miniatura; route con `?size=cutout|cutout-thumb`; UI con fondo a
  scacchi, stati, consigli, "Reintentar" e aggiornamento automatico; nota in "Mis ramos".
- Verifiche: lint ✅, format ✅, typecheck ✅, `pnpm test` 272/272 ✅ (+10: regole del dominio,
  ritaglio vero con l'algoritmo locale, foto vuota, errore del servizio e limite dei tentativi,
  tetto di spesa, nessun servizio, isolamento A↔B, adattatore fal), build ✅, E2E 28/28 ✅ (il
  test delle foto ora verifica il ritaglio PNG e la privacy di originale e ritaglio); controllo
  visivo a 1280 e 320 px (nessuno scorrimento orizzontale) e del "Reintentar".
- Verifica reale nell'app (fal, BiRefNet): rosa su un tavolo di negozio con oggetti dietro →
  ritaglio pulito, "Sin fondo" 3,1 s dopo il caricamento, PNG di ~400 KB.
- Spesa fal totale: ≈3,6 USD su 10 € (stima da listino).

### 2026-11-21 — Anteprima esatta: boceto, foto realistica, conteggio verificato (ADR-034)

- Richiesta del founder ("vai"): l'anteprima con il numero esatto di fiori costruita dai ritagli.
- Fatto: dominio (`exactPreviewPlan`, `layoutBouquetSketch` deterministico con ritagli
  specchiati, prompt v5 dal boceto, prompt e confronto del conteggio, chiave di cache con
  modalità e ritagli); core (disegno del boceto con sharp, variante "edit" di Nano Banana 2,
  `FlowerCounter` fal/simulato, worker con controllo, un nuovo tentativo e `count_mismatch`
  senza credito, limite di 2 richieste scartate per ramo, lease del job a 300 s, costi nel
  tetto); web (route privata del boceto, pannello con boceto, "Generar foto realista", bollino
  "Número de flores verificado", fiori da fotografare con link, messaggi es-MX).
- Prove reali (~0,70 USD): 3 ramos di prova e uno nell'app, 4 su 4 esatti al primo tentativo,
  confermati anche a occhio; foto ~13 s, controllo ~5 s.
- Verifiche: lint ✅, format ✅, typecheck ✅, `pnpm test` 301/301 ✅ (+29: disposizione, limiti,
  prompt, conteggio e chiave nel dominio; boceto, foto verificata, nuovo tentativo, scarto senza
  credito e limite, controllo assente, foto tolta, anteprima a parole, isolamento A↔B nel core;
  variante "edit" e contatore fal), build ✅, E2E 30/30 ✅ (+2: boceto, foto verificata e
  privacy; fiori da fotografare); controllo visivo del pannello a 1280 e 320 px.
- Spesa fal totale: ≈4,3 USD su 10 € (stima da listino).

### 2026-11-21 — Anteprima esatta v2 (dopo il giudizio del founder)

- Il founder ha bocciato la v1 ("sembra un collage, fiori innaturali"): aveva ragione, fiori
  sparsi su steli dritti copiati alla lettera dal modello.
- Confronto (~1,7 USD): solo testo 1/3 esatti, testo + foto dei fiori 1/3, boceto nuovo 3/3;
  "reinventare" i fiori 1/3. Contatori: Claude 5/6 sulla dozzina, Gemini 2.5 Pro 6/6, Gemini
  Flash inutilizzabile.
- Fatto: boceto `sketch-v2` (corolle senza stelo, cupola fitta, esterne dietro, fino a 3
  angolazioni alternate, luce/rotazione/specchio), `extractBloomHead` (erosione + componente più
  grande, cache), prompt v6, `TwoStepFlowerCounter` (Claude, poi Gemini Pro con riquadri solo se
  serve), costo reale del controllo nel job, lease e tempi del conteggio adeguati.
- Verifiche: lint ✅, format ✅, typecheck ✅, `pnpm test` 310/310 ✅ (+9: angolazioni e ordine
  del boceto, riquadri con doppioni e JSON rovinato, seconda opinione, corolla senza stelo),
  build ✅, E2E 30/30 ✅; nell'app con fal: 12 rose in carta nera esatte, 18,6 s.
- Spesa fal totale: ≈6,0 USD su 10 € (stima da listino).

### 2026-11-21 — Proporzioni dei fiori e immagine del ramo nel preventivo (ADR-034 v3, ADR-035)

- Founder: "ok meglio così, vai avanti".
- Boceto v3: diametro tipico della corolla riconosciuto dal nome (girasole 15 cm, rosa 8,
  margarita 5…), fiori grandi al centro e piccoli intorno, carta davanti sotto ogni corolla.
  Prove (~0,30 USD): 3 rose + 3 margherite esatte; 3 girasoli + 5 margherite esatti grazie alla
  seconda opinione.
- Immagine nel preventivo: `QuoteLine.previewJobId` (migrazione `quote_line_preview`, FK composita
  e CHECK), aggancio alla creazione del preventivo dal disegno, stato nel DTO, route privata con
  download per WhatsApp, pagina e stampa con avviso e bollino; corretto lo sbordo a 320 px.
- Verifiche: lint ✅, format ✅, typecheck ✅, `pnpm test` 314/314 ✅ (+4: proporzioni e immagine
  nel preventivo con isolamento A↔B), build ✅, E2E 30/30 ✅ (il test dell'anteprima esatta ora
  crea anche la cotización e scarica l'immagine); controllo visivo di pagina, stampa e 320 px.
- Spesa fal totale: ≈6,3 USD su 10 € (stima da listino).

### 2026-11-21 — Piano di piattaforma (proposta)

- Richiesta del founder: struttura professionale con staging e produzione, DB, auth, gestione
  errori, codice organizzato in componenti e moduli; Sentry e notifiche push in roadmap.
- Fatto: `docs/PLATFORM_PLAN.md` (PROPOSTO) con ambienti, hosting consigliato (Render + Neon +
  R2 + Resend), costi indicativi, flusso di rilascio, gestione errori, sicurezza, osservabilità,
  roadmap a fasi e decisioni richieste; analisi del codice con le duplicazioni e le falle di
  gestione errori da chiudere nella fase 0.
- Il founder manderà foto vere di fiori singoli su fondo liso; link pubblico del preventivo
  approvato.
