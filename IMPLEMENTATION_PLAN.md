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

**Prossimo:** niente pilota (D-22, 22/11): si costruisce la V1 completa (`docs/V1_SCOPE.md`) e la
usano solo founder e tester fino al lancio. Vedi "I prossimi task".

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

**Decisioni del founder (22/11):** **Vercel + Neon** confermati; budget **20 USD/mese** finché lo
usa solo lui (Vercel Hobby gratuito finché lo usa solo lui, Pro quando entrano i tester o prima di
incassare; piani gratuiti di Neon, R2, Resend, Sentry; un solo ambiente online di prova); nome proposto **Gardelia** (da verificare: marchi IMPI e dominio, O-03); intestatario
rinviato (O-02, per ora solo tester); bozze di aviso de privacidad e termini scritte in
`docs/legal/`, revisione dell'avvocato prima del lancio (O-07); **niente pilota: si lancia la V1
completa** (D-22, `docs/V1_SCOPE.md`). Approvato il link pubblico del preventivo (21/11).

**Serve dal founder per l'ambiente online di prova:** account Vercel (Hobby), Neon, Cloudflare
(R2), Resend e fal a suo nome, seguendo passo passo `docs/DEPLOY_VERCEL.md` (circa un'ora); dominio
quando è deciso il nome. Le chiavi vanno nelle variabili di Vercel e nei segreti di GitHub, mai in
chat.

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

**Fase 0, errori silenziosi (fatto il 22/11):** un errore di validazione su un valore che il form
non mostra (es. il cliente scelto con un pulsante in "Nueva cotización") restava invisibile: ora
ogni errore per campo che la pagina non mostra diventa un toast, in tutti i form. Se all'avvio il
database non risponde, l'app ritenta in background (2 s, 4 s, 8 s… fino a 60 s) e avvia il worker AI
appena il database torna, senza riavvio (provato dal vivo spegnendo e riaccendendo Postgres).
Ultima verifica: lint ✅ · format ✅ · typecheck ✅ · test 349/349 ✅ · build ✅ · E2E 39/39 ✅.
Prossimo blocco della fase 0: immagini private (un solo helper per route, lettura e `<img>`; file
salvati fuori dalla transazione del database).

**Errori accanto ai campi senza doppione (fatto il 23/11, ADR-022 aggiornato):** il controllo che
decide se un errore per campo è già visibile (e quindi niente toast) aspettava due frame; quando
React impiegava di più (telefono lento, CI) lo stesso messaggio compariva accanto al campo e nel
toast (visto nell'E2E delle fasce di consegna). Ora si controlla dopo il commit del nuovo stato: in
`useActionToast` nell'effetto, in `useToastActionState` con un effetto sullo stato (se il form si
smonta prima, toast). Gli errori di campi che la pagina non mostra restano un toast. Test: hook con
React vero in happy-dom (prima dipendenza di test per il DOM, `apps/web/test/*.test.tsx`) e un
rendering lento, 3 casi su 6 fallivano col codice di prima; E2E con la CPU di Chromium rallentata
20× (`errors.spec.ts`): col codice di prima il toast doppio usciva 5 volte su 5, ora mai. Nel merge
con staging (C1) corretto il commento dell'E2E delle fasce, che dava il doppione per normale. Verifiche locali:
lint ✅ · format ✅ · typecheck ✅ · test 704/704 ✅ (+6) · build ✅ · E2E 76/76 ✅ (+1); dopo il merge
con staging (C1, inventario blocco 4): test 725/725 ✅ · build ✅ · E2E 78/78 ✅.

**Fase 0, immagini private (fatto il 22/11):** un solo helper per livello. Core: `readStoredImage`
(file mancante → "non trovata" e avviso nel log, invece di un 500) e `storeFilesThenCommit` (i
file si salvano prima della transazione, che resta breve, e si cancellano se la registrazione
fallisce o l'articolo non c'è; l'archivio ha ora `delete`). Web: `privateImageRoute` per le 5
route (404 uguale per "non esiste", "altra fioreria", "ruolo" e "piano": prima alcuni casi davano 500) e `<PrivateImage>` per le 7 immagini (pigre nelle liste, subito nella pagina del preventivo da
stampare). Ultima verifica: lint ✅ · format ✅ · typecheck ✅ · test 354/354 ✅ (+5 sui file:
pulizia dopo limite, altra fioreria, rete caduta a metà, Mis ramos, file mancante) · build ✅ ·
E2E 39/39 ✅. Prossimo blocco della fase 0: azioni e percorsi (`defineTenantAction`, `routes.ts`).

**Fase 0, job AI su Vercel (fatto il 22/11, ADR-037):** su Vercel non c'è un processo sempre
acceso, quindi la coda AI (sempre in Postgres) si svuota con una funzione protetta da
`CRON_SECRET`, avviata appena si accoda un job, quando una pagina aspetta un job da troppo e una
volta al giorno da Vercel Cron. Limite globale di 8 job in corso (sotto le 10 richieste di fal),
atomico anche con più funzioni insieme (nuova migrazione `ai_claim_concurrency_cap`). In locale e
nei test resta il worker nel processo. Nuove variabili: `AI_WORKER_MODE`, `AI_MAX_CONCURRENT_JOBS`,
`CRON_SECRET` (`docs/CONFIGURATION.md`). Prossimo: configurazione del deploy su Vercel
(migrazioni, guida passo passo per creare gli account) e limite di 4 MB sui caricamenti.

**Fase 0, rilascio su Vercel (fatto il 22/11, ADR-038):** tutto ciò che serve per mettere l'app
in linea è nel repository; manca solo che il founder crei gli account. La build di produzione su
Vercel applica le migrazioni con il ruolo proprietario prima di `next build` (le anteprime non
toccano il database); regione `iad1`, cron giornaliero dei job AI, Node 22 come in CI, pnpm del
repository. Ruolo dell'app su Neon con `setup-hosted-db.sql`; il controllo all'avvio ora rifiuta
anche il ruolo proprietario delle tabelle. Operazioni di piattaforma dal workflow GitHub
"Operazioni di piattaforma" (primo amministratore con la nuova CLI `platform:bootstrap-admin`,
piani, crediti AI), senza installare nulla. Foto fino a 4 MB (prima 8), sotto il limite di 4,5 MB
delle funzioni, con il nostro messaggio. Guida: `docs/DEPLOY_VERCEL.md`. Ultima verifica: lint ✅ ·
format ✅ · typecheck ✅ · test 366/366 ✅ (+4: primo amministratore e ruolo proprietario) ·
build ✅ · E2E 40/40 ✅.

**Fase 0, azioni e percorsi (fatto il 22/11, ADR-039):** le 39 server action della fioreria
passano da un'unica ossatura, `runTenantAction`: contesto per primo, errori tradotti nel form, poi
pagine da ricaricare, redirect e messaggio. Ogni azione scrive solo validazione (`parseForm`) e
servizio: 190 righe in meno nei file delle azioni. Tutti i percorsi `/app/…` (link, redirect,
revalidate, immagini) vengono da `tenantRoutes` (`lib/routes.ts`). Un test guardiano blocca
un'azione che salta il contesto o un percorso scritto a mano. Ultima verifica: lint ✅ · format ✅ · typecheck ✅ · test 385/385 ✅
(+19 del web: percorsi, ossatura, guardiano) · build ✅ · E2E 40/40 ✅.

**Fase 0, pagine elenco (fatto il 22/11):** catalogo, clienti, preventivi e Diseñador usano gli
stessi pezzi (`components/common/list/`): `FilterBar` (form GET con ricerca, filtri e "Limpiar
filtros"), `SearchInput` (anche nella scelta del cliente della nuova cotización), `ListResults`
("nessun risultato con questi filtri" distinto dall'elenco vuoto, conteggio annunciato) e
`ListPagination` (agli estremi il pulsante è disattivato davvero, non più un link nascosto che
da tastiera portava a una pagina inesistente). L'elenco degli archiviati del Diseñador ora ha lo
stesso stato vuoto degli altri. Nuovo E2E: ricerca, nessun risultato, pulizia e pagina 2 con il
filtro (prima nessun test copriva filtri e paginazione). Ultima verifica: lint ✅ · format ✅ · typecheck ✅ · test 385/385 ✅ ·
build ✅ · E2E 41/41 ✅.
Prossimo blocco della fase 0: altri componenti condivisi (dialoghi di conferma, pulsanti-azione,
campi indirizzo e fiscali, badge di stato).

**Fase 0, altri componenti condivisi (fatto il 22/11):** un pezzo unico per ciò che era copiato:
`ConfirmActionDialog` (archiviare, annullare una cotización, disattivare un membro: la finestra si
chiude solo se l'azione riesce; prima la disattivazione si chiudeva anche con un errore),
`ActionButton` (10 pulsanti di un solo form, con la rotella al posto dell'icona e il toast anche
quando la riga sparisce), `QuantityForm` (righe di cotización e ricetta: errore sotto il campo in
entrambe, prima la ricetta lo segnalava solo con un toast), `AddressFields`, `LegalFields` e
`ShopProfileFields` (onboarding, impostazioni, clienti: stessi campi, stesso autocompletamento),
`QuoteStatusBadge`, `AvailabilityBadge` e `ColorSwatch`. Il numero d'esempio del telefono ora è
un testo di es-MX. Circa 500 righe ripetute in meno. Nuovi E2E: disattivare e riattivare un
membro, cancellare un invito, cambiare la quantità di una riga di ricetta e di cotización.
Ultima verifica: lint ✅ · format ✅ · typecheck ✅ · test 385/385 ✅ · build ✅ ·
E2E 42/42 ✅.

**Fase 0, CI vera (fatto il 22/11):** la CI su GitHub non era mai partita: si attivava solo con
un push su `main`, ramo che nel repository non esiste. Ora gira a ogni push dei rami stabili e di lavoro
(`staging`, `prod`, `claude/**`: ADR-041), sulle pull request e a mano, con in più il controllo che le migrazioni
producano esattamente lo schema Prisma (database "ombra" vuoto), `pnpm audit` delle dipendenze di
produzione ed E2E solo dopo unit e integrazione. La prima esecuzione vera ha trovato un difetto
che in locale non si vedeva: la tassonomia dei fiori la caricava solo il seed demo, che in
produzione non gira (online il catalogo non si sarebbe collegato alla tassonomia e anteprime e
boceto avrebbero perso nomi e misure). Ora è un dato di riferimento allineato a ogni rilascio
(`pnpm db:deploy`, build di Vercel) e prima dei test (ADR-038). Seconda esecuzione: tutto verde su
GitHub, E2E compresi.

**Fase 0, scadenze senza scritture in lettura (fatto il 22/11, ADR-040):** aprire preventivi o team
non modifica più il database. Lo stato scaduto si calcola in lettura, anche nei filtri e nei cambi
di stato; un lavoro giornaliero (funzione SQL `app_expire_overdue`, Vercel Cron alle 06:07 UTC,
ciclo nel processo fuori da Vercel) salva le scadenze di tutte le fiorerie, ognuna nel suo fuso
orario. `CRON_SECRET` ora serve su Vercel anche senza AI. Ultima verifica: lint ✅ · format ✅ · typecheck ✅ ·
test 390/390 ✅ (+5: scadenze, dati di riferimento) · build ✅ · E2E 43/43 ✅ · CI su GitHub ✅.

**Nome e ambiente online (22/11):** su richiesta del founder l'app si chiama già **Gardelia**
(anche email e piani: "Gardelia Plus"); la verifica di marchio e dominio resta aperta (O-03). I
servizi online hanno nomi in inglese (`gardelia-staging`) e il ruolo del database è `gardelia_app`.
**Ambiente online di prova attivo (22/11):** `https://gardelia-staging.vercel.app` (progetto
Vercel `gardelia-staging`, nato come `gardelia`: `gardelia.vercel.app` rimanda lì con un 307 ed è
tenuto per la produzione; piano Hobby, ramo `staging`; Neon `gardelia-staging` in US East, bucket R2
`gardelia-staging` in ENAM, Resend con il mittente di prova, fal), creato insieme al founder con
`docs/DEPLOY_VERCEL.md`. Al primo deploy la build ha preparato il database; all'avvio l'app si è
rifiutata di partire per due segreti troppo corti, elencati per nome nei log (il controllo della
configurazione ha fatto il suo lavoro); corretti, `/api/health` risponde ok. Gli aggiornamenti di
`staging` vanno online con un commit di rilascio firmato dal founder (consenso del 22/11): sul piano
Hobby Vercel ignora i commit non fatti dal titolare dell'account, anche via Deploy Hook (ADR-041). Rami (ADR-041,
richiesta del founder): `staging` va online, `prod` sarà la produzione, i rami di lavoro non
creano deploy. Fatti anche account del founder, amministratore e piano Plus dal workflow.

**Prima prova del Diseñador online (22/11):** lo scontorno falliva al salvataggio su R2 con 411:
nella funzione di Vercel il corpo partiva come flusso senza `Content-Length`. Ora `R2Storage`
firma e invia i byte con la lunghezza esplicita (`packages/core/test/storage-r2.test.ts`) e lo
scontorno funziona; il messaggio dopo troppi tentativi non dà più la colpa alla foto. Nella foto
realistica quattro rose chiamate "Fiore 1", senza specie, sono diventate ortensie: il Diseñador
ora avvisa, con il link alla scheda, quando un fiore non ha la specie e il nome non dice che fiore
è (ADR-034, nota del 22/11). Proposta del founder per dopo: al cliente mostrare la foto originale
del fiore, nel Diseñador quella senza fondo (punto 10 qui sotto, "usa l'originale").

**Lingue dell'interfaccia (fatto il 22/11, ADR-042):** su richiesta del founder l'interfaccia è
anche in italiano e in inglese; lo spagnolo resta la lingua predefinita. Ogni persona sceglie la
lingua dal menu dell'account o dalle pagine di accesso (cookie per browser); il messaggio WhatsApp
al cliente e le email restano nella lingua del mercato della fioreria. Ogni testo nuovo va scritto
nelle tre lingue: lo controlla `apps/web/test/messages.test.ts`. Limite noto: il preventivo
stampato segue la lingua di chi lo stampa fino alla pagina pubblica del preventivo (V1).

**Specie dei fiori (fatto il 22/11, ADR-043, richiesta del founder):** la tassonomia passa da 14 a
72 specie usate in Messico (fiori recisi, fogliami, piante) con sinonimi per lingua (nube,
astromelia, pompón…); il campo Specie del catalogo è una ricerca nella lingua dell'interfaccia,
con una nota che lo spiega, e la specie viene suggerita dal nome del prodotto ("Rosa roja" → Rosa).
L'elenco è una proposta da far controllare a un fiorista (spec §19.6). Il Diseñador avvisa dei fiori
senza specie e con un nome generico (ADR-034, nota del 22/11). Ultima verifica: lint ✅ · format ✅
· typecheck ✅ · test 436/436 ✅ · build ✅ · E2E 49/49 ✅; controllo visivo su desktop e a 320 px.

**Procedure guidate (fatto il 22/11, ADR-044, richiesta del founder):** "Nuevo producto" guida in
cinque passi (cosa è, colori, prezzo, foto facoltativa, listo); la modifica resta un modulo unico.
Il Diseñador va a passi (flores, follaje y empaque, detalles e salvataggio, vista previa
facoltativa, listo con la cotización); un disegno salvato si riapre con i passi come schede.
Sotto la foto realistica c'è "Generar otra versión" (ADR-045): 1 credito, con conferma; senza quel
clic la stessa composizione riusa sempre la foto già fatta.

**Date speciali nel nuovo cliente (fatto il 22/11, richiesta del founder dopo i riscontri dei
fioristi):** il modulo "Nuevo cliente" ha la sezione "Fechas especiales" (compleanni, anniversari,
altre date, anche di un'altra persona, con "avvisa con anticipo"): si salvano col cliente nella
stessa transazione e un errore resta sulla sua riga. Le date si gestivano già nella scheda del
cliente, ma solo dopo averlo creato. I clienti demo hanno qualche data.

**Calendario delle date speciali (fatto il 22/11, richiesta del founder, ADR-046):** sezione
"Calendario" con le viste mese, settimana, giorno e agenda delle date dei clienti attivi; da ogni
data si scrive su WhatsApp, si apre un preventivo o la scheda del cliente. Vista e data stanno
nell'URL.

**Promo delle date speciali (fatto il 22/11, richiesta del founder, ADR-047):** pagina
"Promociones" con lo sconto (percentuale o importo fisso) e l'anteprima dell'email; email
automatica ai clienti con email e consenso, qualche giorno prima di ogni data (il preavviso della
data). Si manda una sola email per data e anno, mai dalle fiorerie demo, e si riprova se fallisce.
L'email ha un link firmato per non ricevere più promozioni, con pagina di conferma e
disiscrizione con un clic. Il calendario mostra lo stato della promo per ogni data. Il cron
giornaliero ora gira alle 9:07 del Messico e fa anche la promo. La promo resta in tutti i piani
(O-11).

**Codici e registro degli sconti (fatto il 22/11, richiesta del founder, ADR-048):** ogni email ha
un codice personale, scritto anche nel messaggio WhatsApp già pronto. La pagina "Descuentos" lo
cerca come lo scrive il cliente e dice se è vigente, usato o scaduto. "Marcar como usado" salva una
nota, chi e quando, e si può annullare. Gli sconti si vedono anche nella scheda del cliente e nel
calendario. Ora parte un'email per data. La pagina Promociones dice chiaramente che l'invio è
automatico ogni mattina e mostra i prossimi invii. La casella del consenso è più esplicita.
Prossimi passi:

- dominio email verificato (P-07; il founder lo compra, passi in `docs/DEPLOY_VERCEL.md` §4);
- parere legale sulle email promozionali;
- poi: sconto collegato al preventivo, promo aggiuntive inviate a mano, marketplace dei clienti.

**Pulsanti attivi solo quando funzionano (fatto il 22/11):** "Continuar con Google", uscita e i
moduli di accesso restano disattivati finché la pagina non ha caricato il JavaScript; i moduli
gestiti solo in JavaScript inviano in POST (prima, un invio anticipato metteva email e password
nell'indirizzo). Un test delle convenzioni lo impone ai moduli nuovi.

**Test E2E instabile del login Google (corretto il 22/11):** in CI, circa 2 esecuzioni su 10, il
ritorno dal Google simulato (`google-login.spec.ts`) non rispondeva entro 10 s, senza errori nel log;
in locale non si riproduceva. La diagnostica del server (`e2e/support/google-oauth-mock.mjs`) ha
mostrato la causa (CI 57): nessuna riga "ritorno da Google ricevuto", che si scrive appena la
richiesta arriva al server, e nessun blocco dell'event loop. La richiesta di ritorno restava ferma
nel browser, dentro l'intercettazione di `accounts.google.com`, che rispondeva con un redirect 302
(`route.fulfill`). Ora al posto di Google c'è una pagina con il link di ritorno: il test toglie
l'intercettazione e segue il link, quindi il ritorno è una navigazione normale, come quella che
parte da Google. Verificato in locale con 15 ripetizioni sotto carico (prima e dopo la modifica:
93 su 93), da confermare con le prossime CI. La diagnostica resta nel server di test.

**Dati di prova di una fioreria (fatto il 23/11, richiesta del founder, ADR-049):** l'operazione
di piattaforma `test-data` (`pnpm platform:test-data`, o il workflow "Operazioni di piattaforma")
riempie una fioreria del founder con 23 clienti inventati e le loro 26 date speciali nei prossimi
giorni e mesi, più "Cliente de prueba (tú)" con la sua email per ricevere la promo vera. Aggiunge 18
prodotti `PRB-…` (fiori e verdi con la specie, carte, nastro) e la foto di ogni fiore generata da
fal (~1,20 USD in tutto), con gli scontorni. Passa dai servizi veri, si può rilanciare e scrive solo
in una fioreria di cui l'operatore è proprietario o manager. Provata in locale su una fioreria vera
(con foto segnaposto): calendario, agenda, catalogo e promo pieni. Per le foto su staging servono i
segreti GitHub `FAL_KEY` e `R2_*` (`docs/DEPLOY_VERCEL.md` §8.6). Verifiche: lint ✅ · format ✅ · typecheck ✅ ·
test 485/485 ✅ (+7: conteggi e rilancio, calendario e consenso, codici e specie, foto fallita,
rifiuti per non amministratore, fioreria altrui e staff, prompt della foto).

**"Non va la generazione AI" su staging (23/11, segnalazione del founder):** nei log di Vercel le
righe rosse sono solo avvisi di Node (modalità SSL di `pg`, query in parallelo sullo stesso client),
non errori. Il job dell'anteprima era arrivato in fondo con una riga informativa: con ogni probabilità
foto realistica scartata perché i fiori non coincidevano con la distinta (ADR-034), senza che lo
schermo dicesse perché. Ora il Diseñador mostra cosa ha contato il controllo nell'ultima foto
(trovati di attesi per ogni fiore, fiori estranei). Funziona anche per i job già scartati e il log
riporta gli stessi numeri. **Causa trovata con il founder:** nel boceto 2 boccioli rosa finivano
dietro 3 rose rosse aperte e sparivano anche dalla foto realistica. Boceto v4 (ADR-034): ogni corolla
deve restare visibile per almeno il 60% dei petali, altrimenti il boceto si ridisegna più arioso.
Da osservare: i prodotti fotografati in bocciolo e il controllo che ignora i boccioli chiusi. Poi, con
tutti i fiori visibili, il controllo non riconosceva "Fiore 1" (nome generico, nessun colore in
catalogo): ora ogni tipo arriva al controllo anche con il colore misurato sulla sua foto. Con i
numeri giusti, la foto era però rigida, una copia del boceto. v7: ramo naturale disposto dal modello,
poi la correzione dei fiori in più sulla stessa foto; sul ramo del founder 4 richieste su 4
verificate, a ~0,24 USD l'una (ADR-034, `docs/AI_BENCHMARK.md`). v8: con la v7 le rose guardavano
quasi tutte verso la fotocamera ("non ci siamo ancora con la direzione delle rose"); ora il prompt
chiede fiori visti da angolazioni diverse e al massimo circa uno su quattro di fronte. Provato su 3
rose + 2 tulipani (3 su 3 verificate al primo colpo) e su 12 rose (6 su 6 verificate).
Il founder ha bocciato anche la v8: rose "orizzontali", girate di lato e ammucchiate. v9: il
modello non riceve più il collage ma le foto scontornate dei fiori del catalogo, una per tipo, e
compone un ramo in cui ogni corolla segue il suo stelo; il boceto resta l'anteprima esatta gratuita.
Prova: 6 rami naturali su 6 con i numeri verificati, contro 3 su 6 partendo dal collage. Codice: il
generatore accetta più immagini (`images`), `loadFlowerReferences` carica i ritagli (fondo bianco,
massimo 1024 px), `buildReferenceRenderPrompt`; la versione del boceto non è più nella chiave della
cache delle foto. Approvata dal founder e pubblicata su staging il 23/11 (CI verde). Il credito
fal, finito durante le prove del 23/11, lo ricarica il founder. Da osservare sulle foto vere dei
tester: fiori diversi dalla rosa e lo spago che a volte compare dove gli steli sono legati.
Primo test del founder con la v9: scartata per una rosa in più. Il modello aggiunge spesso un
fiore e la correzione lo toglie; ora una correzione che ha tolto fiori ma non tutti si ripete sulla
stessa foto invece di rifarla da capo (sempre al massimo 3 immagini, ADR-034).

**Foto vera del ramo (fatto il 23/11, richiesta del founder, ADR-052):** il passo 4 del Diseñador
ora è "Foto del ramo", con le schede "Foto con IA" e "Tu foto". La foto caricata diventa la foto del
disegno e va nei preventivi al posto di quella AI (pagina, stampa/PDF, WhatsApp). Cambiandola, i
preventivi già fatti tengono la loro. Proprietario e manager possono aggiungerla anche a "Mis ramos",
con il consenso. Le foto di "Mis ramos" danno lo stile alle foto AI e non addestrano modelli:
segnalato al founder (spec §6.4). Test: 4 d'integrazione (compresa l'altra fioreria che riceve 404)
e un E2E.

**Query sovrapposte sulla stessa connessione (fatto il 23/11, ADR-053):** l'avviso di pg "client is
already executing a query" (errore in pg 9) veniva dalle letture di Prisma con tre o più relazioni
incluse in una transazione. Ora ogni connessione del pool esegue una query alla volta
(`SerialClient`). Un test fallisce se l'avviso torna; suite completa ed E2E senza avvisi.

**Eliminare un disegno del Diseñador (fatto il 23/11, richiesta del founder, ADR-051):** accanto ad
"Archivar" c'è "Eliminar" (solo proprietario e manager, con conferma). Cancella il disegno e le foto
generate per lui dall'archivio. Se un preventivo lo usa, la finestra spiega che si può solo
archiviare. I crediti già usati non tornano. Le foto che mostra un preventivo o un altro disegno
identico restano. Una foto in preparazione blocca l'eliminazione finché non finisce. Test:
5 d'integrazione (compresa l'altra fioreria che riceve 404) e un E2E.
Ultima verifica: lint ✅ · format ✅ · typecheck ✅ · test 513/513 ✅ · build ✅ · E2E del
Diseñador 8/8 ✅. Nei test d'integrazione il tetto di spesa AI ora è altissimo: il database di
test locale accumulava la spesa finta del mese, finché ogni anteprima rispondeva "tetto raggiunto".
Il test del tetto resta.

**Tester senza email di conferma (fatto il 23/11, richiesta del founder, ADR-050):** operazione di
piattaforma `confirm-user`. L'amministratore conferma a mano l'email di una persona registrata e, se
serve, la aggiunge a una fioreria come manager o staff, con audit. Serve finché il dominio email non
è verificato; poi tornano le email normali.

**Log pubblici del workflow di piattaforma (corretto il 23/11):** il repository è pubblico e
l'email dell'operatore compariva in chiaro nei log delle operazioni (variabili `env:` stampate da
GitHub). Ora gli input si leggono dal file dell'evento e si mascherano (ADR-038, operazioni di
piattaforma). Restano da cancellare i log delle due esecuzioni del 22/11.

**Font Roboto (fatto il 22/11, richiesta del founder):** tutta l'app usa Roboto (testi e titoli) al
posto di Inter e Fraunces, sempre servito dall'app stessa (pacchetto `@fontsource-variable/roboto`,
nessuna richiesta a servizi esterni). I titoli senza peso esplicito ora sono in semibold. Le email
restano con i font di sistema dei programmi di posta.

**Fase 0, sicurezza delle dipendenze (fatto il 22/11):** Better Auth all'ultima versione stabile
(1.7.27). L'avviso alto su `effect` 3.20.0 (ReDoS, GHSA-7589-6fvf-x4pw), arrivato tramite
`prisma` → `@prisma/config`, è chiuso con un override pnpm a ≥ 3.22.1 (`pnpm-workspace.yaml`);
`pnpm audit --prod` non trova vulnerabilità; `prisma generate`, migrazioni e 329 test verdi. Da
togliere quando Prisma aggiornerà la dipendenza.

**Modello economico, listino e roadmap (23/11, solo documenti, richiesta del founder):** analisi di
ricavi, costi e tasse con il founder; nuovi documenti `docs/BUSINESS_MODEL.md` (listino, costi per
fioreria, scenari, fee, aziende, domande per commercialista e contador) e `docs/ROADMAP.md` (tappe
dopo la V1 con le loro condizioni). Decisioni: listino a tre livelli Esencial / Profesional /
Premium al posto di Basic/Plus (D-23, prezzi proposti), fee sugli ordini (D-24), aziende prima come
intermediario e servizio gestito solo dopo (D-25); nuovi punti aperti O-12 (fase gratuita) e O-13
(ruolo della partner); prezzi dei crediti AI da rivedere (ADR-024, costo vero ~0,11 USD). Effetto sul
codice, nello sprint billing: piani ed entitlements (`packages/domain/src/plans.ts`) sui livelli,
quote AI 15 / 30, utenti inclusi per livello. Nessun codice cambiato in questa sessione.

**Ordini, blocco A1a (fatto il 23/11, ADR-054):** "Convertir en pedido" sul preventivo accettato
(righe, snapshot e immagine del ramo copiati), consegna a domicilio o ritiro con data e fascia,
indirizzo dalla rubrica o nuovo (copiato nell'ordine), destinatario, tarjeta (messaggio, firma o
anonimo), note interne; stati con cronologia e un passo indietro, annullamento con motivo; pagamenti
registrati a mano (acconto, saldo, metodo, riferimento) con storno; pagine Pedidos (filtri Próximos,
Hoy, Mañana, Esta semana, Anteriores, Todos, stato, saldo pendiente), scheda con stampa e messaggio
WhatsApp, collegamento dal preventivo. "Pedidos" nella barra in basso, Catálogo nel menu "Más".
Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test unit 279/279 ✅ · integrazione 269/269 ✅
(14 nuovi sugli ordini, con isolamento A↔B) · build ✅ · E2E 59/59 ✅ (3 nuovi); controllo visivo a
320 px. Prossimi: A1b ordine diretto con le righe, A2 impostazioni di consegna e coordinate, A3 stampa
della tarjeta e link pubblici.

**Ordini, blocco A1b (fatto il 23/11, ADR-054):** "Nuevo pedido" senza preventivo dall'elenco Pedidos,
dalla scheda del cliente (nuova scheda "Pedidos" con gli ultimi ordini) e dal Diseñador ("Crear
pedido"); il borrador si compone con lo stesso editor dei preventivi (catalogo, righe libere, sconto),
poi "Confirmar pedido" con consegna e tarjeta; "Descartar borrador" senza motivo; filtro "Borradores".
Dopo la conferma prodotti e sconto si cambiano fino a "En preparación" ("Cambiar productos o
descuento"); il totale non scende mai sotto il già pagato (vale anche per il costo di consegna, buco
di A1a chiuso); un disegno usato da un ordine non si elimina. Selettore del cliente e formattazione
delle righe condivisi con i preventivi (`components/customers/customer-picker.tsx`, `lib/line-ui.ts`).
Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test unit 283/283 ✅ · integrazione 286/286 ✅
(9 nuovi sui borradores con isolamento A↔B, 1 sul Diseñador) · migrazioni = schema ✅ · build ✅ · E2E
62/62 ✅ (2 nuovi); controllo visivo a 1280 e 320 px. Prossimi: A2 impostazioni di consegna e
coordinate, A3 stampa della tarjeta e link pubblici.

**Consegne, blocco A2 (fatto il 23/11, ADR-055):** in Ajustes la scheda "Entregas" con i giorni in cui
la fioreria non apre, il costo di consegna abituale e le fasce orarie (fino a 8). Nei form degli ordini
le fasce sono scelte rapide ("Durante el día", le fasce, "Otro horario"), il costo abituale si propone
nei nuovi ordini a domicilio e un giorno di chiusura dà un avviso senza bloccare. Costo per distanza e
coordinate aspettano Google Places (O-14). Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test
unit 289/289 ✅ · integrazione 292/292 ✅ (6 nuovi con isolamento A↔B) · migrazioni = schema ✅ · build ✅
· E2E 63/63 ✅ (1 nuovo, nella seconda fioreria demo per non cambiare i form degli altri test, ripetibile);
controllo visivo a 1280, 390 e 320 px. Prossimi: A3 stampa della tarjeta e link pubblici.

**Link per il cliente e tarjeta, blocco A3 (fatto il 23/11, ADR-056):** su preventivo e ordine la
scheda "Enlace para el cliente" / "Seguimiento para el cliente" crea, copia, rinnova o disattiva un
link pubblico, e il messaggio WhatsApp lo include. Il cliente, senza account, vede il preventivo e lo
accetta con un clic, oppure segue l'ordine passo per passo con consegna, tarjeta e saldo. Token firmati
(non salvati), scadenza 60 giorni, uno attivo per documento; nessun costo o nota interna esposti.
"Imprimir tarjeta" stampa il biglietto da 10 × 7 cm. Verifiche locali: lint ✅ · format ✅ · typecheck ✅
· test unit 289/289 ✅ · integrazione 302/302 ✅ (10 nuovi con isolamento A↔B) · migrazioni = schema ✅ ·
build ✅ · E2E 67/67 ✅ (4 nuovi); controllo visivo delle pagine pubbliche a 390 px. Prossimi: B1
calendario delle consegne, "Hoy salen", Producción del día.

**Agenda dei pedidos, blocco B1 (fatto il 23/11, ADR-057):** schede "Lista", "Día" e "Calendario" sotto
Pedidos. "Hoy salen" raggruppa gli ordini del giorno per fascia con il prossimo passo a un tocco (gli
usciti in fondo, chiusi); "Producción del día" somma fiori e materiali dalle distinte, anche da
stampare; il calendario mostra consegne e ritiri per giorno. Verifiche locali: lint ✅ · format ✅ ·
typecheck ✅ · test unit 291/291 ✅ · integrazione 306/306 ✅ (4 nuovi, con isolamento A↔B) · build ✅ ·
E2E 69/69 ✅ (2 nuovi); controllo visivo a 1280 e 390 px. Prossimi: B2 ruta del día, repartidor e prova
di consegna.

**Ruta del día e repartidor, blocco B2 (fatto il 23/11, ADR-058):** nella scheda dell'ordine a domicilio
si sceglie il repartidor fra i membri attivi; la scheda "Ruta" mostra le consegne del giorno in ordine
di fascia con indirizzo, chi riceve, chiamata e WhatsApp, cosa incassare e il prossimo passo; "Mis
entregas" per il repartidor; "Ir" e "Abrir ruta en Google Maps" a tratti da 4 fermate, gratis e senza
chiave. Ordine per vicinanza in attesa di Google Places (O-14). Verifiche locali: lint ✅ · format ✅ ·
typecheck ✅ · test unit 294/294 ✅ · integrazione 311/311 ✅ (5 nuovi con isolamento A↔B) · migrazioni =
schema ✅ · build ✅ · E2E 70/70 ✅ (1 nuovo, proprietaria e repartidor); controllo visivo a 390 px.
Prossimi: prova di consegna (foto e chi riceve), poi il marketplace (C1–C5).

**Prova di consegna (fatto il 23/11, ADR-058):** nella scheda dell'ordine la sezione "Prueba de entrega":
da "pronto" in poi si carica la foto del ramo finito (anche dal telefono del repartidor), dopo la
consegna o il ritiro si indica chi l'ha ricevuto; il cliente vede "Así quedó tu ramo" e il nome nel suo
link. Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test unit 294/294 ✅ · integrazione 316/316 ✅
(5 nuovi con isolamento A↔B) · migrazioni = schema ✅ · build ✅ · E2E 70/70 ✅ (flusso del link esteso
fino alla foto). Prossimi: Google Places (deciso dal founder il 23/11, O-14), poi il marketplace.

**Google Places (fatto il 23/11, ADR-059, deciso dal founder):** nei form degli indirizzi (onboarding,
tienda, clienti, consegna dell'ordine) "Buscar dirección": si scrive, si sceglie un suggerimento e i
campi si compilano (via e numero, colonia, CP, municipio, estado); interno, colonia e CP si correggono
senza perdere il luogo, cambiando via, municipio o stato il luogo si toglie. Si salvano place ID e
coordinate (30 giorni, poi le cancella la manutenzione giornaliera); la Ruta del día ordina per
vicinanza le fermate di ogni fascia e lo dice. Chiave solo sul server (`GOOGLE_MAPS_API_KEY`), rotte
`/api/places/*` con sessione, stessa origine e tetto per persona; senza chiave il campo non c'è.
Guida per la chiave in `docs/DEPLOY_VERCEL.md` §9, riga nella bozza dell'aviso de privacidad.
Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test 670/670 ✅ (27 nuovi: dominio, configurazione,
adattatore, manutenzione, 8 d'integrazione con isolamento A↔B) · migrazioni = schema ✅ · build ✅ ·
E2E 73/73 ✅ (senza chiave, come in CI); controllo visivo a 390 e 1280 px con le risposte di Google
simulate nel browser, e con la chiave finta (Google risponde errore → messaggio, form usabile).
Prossimi: il marketplace (C1–C5); costo di consegna per distanza (servono regole per gli indirizzi
scritti a mano); scarico dell'inventario dagli ordini (`consumeStockTx`).

**Catalogo completo (24/11, ADR-081):** il punto "Catalogo" dei resti della V1, con le tre scelte
del founder (regola del ramo per il sostituto, raggio in km per i servizi, elenco dei fiori curato da
Gardelia con la revisione di un fiorista).

- **"Faltan flores" nel pedido:** se un fiore di un ramo è agotado o non basta in inventario, la scheda
  propone fino a 4 sostituti (stessa specie, poi stesso colore, prezzo vicino, con merce) e cambia
  secondo la regola del ramo: no / con l'ok del cliente (WhatsApp pronto) / subito. Il prezzo non
  cambia; distinta, apartado, scarico e costo sì; "(en lugar de …)" nella distinta e nella comanda.
- **Servizi:** durata e raggio in km, nella riga di cotización, pedido, stampe e link; avviso nel
  pedido a domicilio oltre il raggio.
- **Proveedor habitual** nel prodotto e scheda **"Por pedir"** dell'inventario (per proveedor, con
  WhatsApp e "Registrar compra" già compilata); **tempo di preparazione** stimato nella Producción
  del día.
- **Elenco dei fiori (O-09 risolta):** foglio `docs/LISTA_FLORES_REVISION.md` per il fiorista,
  generato dall'elenco e controllato da un test.

Verifiche: lint ✅ · format ✅ · typecheck ✅ · test 1061/1061 ✅
(dominio: proposte e regola del ramo, campi dei servizi e del proveedor, tempo di preparazione;
integrazione: le tre regole, merce che non basta con l'apartado che segue, Diseñador, dopo "Listo",
proveedor archiviato e di un'altra fioreria, "Por pedir", avviso di zona, isolamento A↔B; il foglio dei
fiori aggiornato) · migrazioni = schema ✅ · build ✅ · E2E 109/109 ✅ su database nuovo (3 nuovi:
proveedor e "Por pedir", servizio nella riga, sostituto con l'ok del cliente) · controllo a 320 e
1280 px.

**Reportes (24/11, ADR-080):** nuova voce "Reportes" nel menu, per owner e manager. Mostra il mese
(frecce avanti e indietro) o l'anno, con il confronto sul periodo prima:

- vendite, pedidos consegnati, ticket medio, cobrado e quanto resta da consegnare;
- grafico per giorno o per mese;
- i 10 prodotti più venduti;
- margine lordo solo sulle righe con il costo, con lo sconto ripartito, dicendo su che quota delle
  vendite è calcolato;
- mermas con il costo;
- ricavi ricorrenti stimati di Floral Care (dal 24/11 i cargos e i pagamenti veri, ADR-082) e i
  prossimi 7 giorni (pedidos e visite).

Verifiche: lint ✅ · format ✅ · typecheck ✅ · test 1032/1032 ✅
(dominio: periodo, vendite, prodotti, margine con la quota coperta; integrazione: permessi, pedidos
consegnati, annullati e da consegnare, confronto, cobrado, sconto ripartito, anno, mermas, isolamento A↔B)
· build ✅ · E2E 106/106 ✅ su database nuovo (2 nuovi: mese, mese prima e anno; staff senza accesso)
· controllo a 320 e 1280 px.

Il test E2E delle lingue ha trovato un difetto vero: con "Reportes" il menu laterale non stava più in
uno schermo da 720 px e il pulsante del conto (lingua, sicurezza, uscita) finiva fuori, senza modo di
arrivarci. Ora il menu scorre da solo e il conto resta sempre in fondo, visibile.

**Esportazione dei dati della fioreria (24/11, ADR-079):** la card "Datos de tu florería" in Ajustes
(solo il titolare) scarica uno ZIP con un LEEME e un CSV per area:

- clienti, indirizzi e date speciali;
- catalogo e ricette;
- cotizaciones e pedidos con i loro concetti e i pagamenti;
- inventario, movimenti e fornitori;
- squadra e Floral Care.

I file si aprono con Excel e gli accenti giusti; i nomi dei clienti non diventano formule. Gli
stati usano le parole dell'app e le date sono nel fuso della fioreria. La pagina "Eliminar florería"
ricorda di scaricarli prima. Verifiche: lint ✅ · format ✅ · typecheck ✅ · test 1019/1019 ✅ (dominio: CSV con virgolette, BOM e
protezione dalle formule; integrazione: solo il titolare, contenuto dei file riletti dallo ZIP, isolamento
A↔B, registro senza PII) · build ✅ · E2E 104/104 ✅ su database nuovo (2 nuovi: il titolare scarica lo
ZIP, lo staff non vede la card e la rotta risponde 404).

**Sicurezza del conto (24/11, ADR-077):** voce 1 della V1 e primi due punti di sicurezza della
roadmap. La pagina "Seguridad de la cuenta" (`/seguridad`) è per tutti e ci si arriva dal menu della
persona e da "Mi cuenta".

- **Verifica in due passaggi:** si attiva con password, QR o chiave, primo codice e 10 codici di
  respaldo da copiare o scaricare. All'accesso con password segue il passo del codice (o un codice
  di respaldo), con "Confiar en este dispositivo" per 30 giorni. Si possono rigenerare i codici o
  disattivarla.
- **Obbligo per i titolari:** chi ha una password ed è titolare di una fioreria vera (scelta del
  founder: dopo 14 giorni) vede un avviso nel pannello con la data. Passata la scadenza la fioreria
  non si apre finché non la attiva. Chi entra solo con Google e le fiorerie demo non hanno obblighi.
- **Dispositivi collegati:** elenco con browser e sistema, chiusura di uno o di tutti gli altri.
- **Registro:** eventi `security.*` con il solo ID.
- **Pulizia nel pannello:** tolta la card "Próximamente en Gardelia", che diceva ancora "in sviluppo"
  ordini, pagamenti e consegne, ormai fatti.

Nuova dipendenza `uqr` (QR, senza dipendenze, versione fissa). Supporto: l'operazione di piattaforma
`reset-two-factor` toglie la verifica a chi ha perso telefono e codici (dopo aver verificato chi è).
Verifiche: lint ✅ · format ✅ · typecheck ✅ · test 957/957 ✅ (dominio: obbligo e scadenza, codice,
dispositivi; integrazione: titolare con password, demo e manager esclusi, sessioni solo della persona,
eventi, reset di piattaforma) · migrazioni = schema ✅ · build ✅ · E2E 100/100 ✅ su database nuovo (2
nuovi: attivazione con QR e primo codice, codici di respaldo, accesso con codice sbagliato e con
codice di respaldo, codice di respaldo già usato, chiusura dell'altro dispositivo; fioreria che non si
apre dopo 14 giorni) · controllo a 320 px di avviso, attivazione e passo del codice.

**Dati della fioreria (24/11, ADR-076):** chiesti dal founder dalla voce 2 della V1. Prima di
cominciare: allineamento a staging, con Floral Care (ADR-075) dell'altra chat.

- **Vigencia de las cotizaciones:** la card "Cotizaciones" in Ajustes, da 1 a 90 giorni. Il valore
  esisteva già nel database ma non si poteva cambiare.
- **Orario di apertura:** quante fasce servono per giorno (scelta del founder), con interruttore
  "Abierto" e "Agregar horario"; un giorno che si apre propone le fasce del giorno prima. Si vede nella
  tienda en línea e nella cotización stampata. Se un giorno chiuso accetta ancora consegne, la pagina
  avvisa.
- **Logo e intestazione:** il logo si carica anche da "Perfil de la florería" (è quello della tienda).
  La cotización stampata e la comanda hanno logo, indirizzo, telefono ed email; la cotización anche
  l'orario. Le pagine dei link pubblici mostrano il logo.
- **IVA:** non fatta. Le domande per il contador sono in ADR-076 (O-06).

Verifiche: lint ✅ · format ✅ · typecheck ✅ · test 948/948 ✅ (dominio: vigencia, fasce, orario in poche
righe; integrazione: permessi, sostituzione, audit, tienda en línea, intestazione, logo dei link solo con
link attivo, isolamento A↔B) · migrazioni = schema ✅ · build ✅ · E2E 98/98 ✅ su database nuovo (1 nuovo:
vigencia, lunes con due fasce, errore di sovrapposizione, logo da Ajustes, cotización stampata con logo,
indirizzo e orario) · controllo a 320 px del form (le due ore su una riga) e della stampa.

**Eliminar florería (24/11, ADR-074):** chiesto dal founder; la cancellazione definitiva dopo 30
giorni è una sua scelta (eccezione voluta alla regola "solo archiviare"). In "Ajustes" il titolare trova
la "Zona de peligro" e la pagina "Eliminar florería", che dice cosa succede e quando; si conferma
scrivendo il nome della fioreria. Gli ordini in corso bloccano, con il link agli ordini.

- **Subito:** la fioreria sparisce per tutti (404 anche per il titolare), la tienda si spegne, i link
  di ordini e preventivi non si aprono più. Chi compra non vede più quegli ordini in "Mis pedidos";
  "Descargar mis datos" li tiene. I titolari ricevono un'email con la data.
- **Per 30 giorni:** in `/app` il titolare vede "Florerías en eliminación" e la recupera con un clic.
- **Dopo:** la manutenzione giornaliera cancella prima i file dall'archivio (se non risponde, riprova
  il giorno dopo), poi la fioreria con tutti i dati in cascata. Resta solo l'evento di piattaforma con
  gli ID.

Migrazioni `20261124140000_tenant_deletion` (campi, vincolo, indice, due funzioni SQL) e
`20261124141000_buyer_orders_shop_active`. La cancellazione in cascata è stata provata su tutte le 2.624
fiorerie del database di test e sulle 7 di quello E2E (ognuna in una transazione annullata): nessun
vincolo la blocca. Da
validare con contador e avvocato cosa va conservato (domanda 18 in `docs/legal/README.md`). Manca
l'esportazione dei dati della fioreria. Verifiche: lint ✅ · format ✅ · typecheck ✅ · test 890/890 ✅ (3 di dominio, 9 d'integrazione:
permessi, ordini in corso, nome, effetti, email, recupero con isolamento A↔B, cancellazione con i file,
archivio che non risponde, recuperata non cancellata, "Mis pedidos" di chi compra; link pubblici di una
fioreria archiviata) · migrazioni = schema ✅ · build ✅ · E2E 95/95 ✅ su database nuovo (3 nuovi:
titolare che elimina e recupera con l'email, staff senza accesso, zona di pericolo nella demo; ora ogni
fiorista dei test si registra da un suo IP di prova, il limite di 5 registrazioni al minuto si
sommava) · controllo a 320 px.

**Dominio gardelia.co (24/11, ADR-073):** comprato dal founder su Cloudflare. Nel repository:

- guida passo passo in `docs/DEPLOY_VERCEL.md` §12 (`staging.gardelia.co`, email in arrivo con
  Cloudflare Email Routing, invio da `no-reply@gardelia.co` con Resend, variabili, controlli);
- bozze legali con `gardelia.co`, `soporte@` e `privacidad@`;
- esempio di `EMAIL_FROM`.

Il codice non cambia: tutto passa da `APP_URL` ed `EMAIL_FROM`. Fatto dal founder lo stesso giorno:
Resend verificato, DMARC attivo, **`https://staging.gardelia.co` online**, con i vecchi indirizzi
`vercel.app` che rimandano lì.

**"Tienda en línea" nell'elenco del catalogo (24/11, chiesto dal founder):** una colonna con
l'interruttore per mostrare o togliere un prodotto dalla tienda senza aprirne la scheda. Su telefono è
una riga sotto ogni scheda. Valgono le stesse regole della scheda: solo ramos, piante, fiori e
accessori attivi, solo per chi modifica il catalogo; lo staff vede il badge. Servizio
`setCatalogItemOnline` con audit; ricarica anche "Mi tienda en línea", che conta i prodotti visibili.
Verifiche: integrazione (accendi/spegni, tipi, archiviati, staff, isolamento A↔B), E2E (elenco → scheda
→ spento, staff senza interruttore), controllo a 320 e 1280 px.

**La tienda sulla mappa (24/11, aggiunta ad ADR-059):** il founder non trovava la sua fioreria cercando
il proprio indirizzo. Le cause erano due:

- la sede era senza posizione di Google: scelta la colonia, la via scritta a mano toglieva il punto;
- un difetto vero: React riscriveva i campi nascosti del punto a ogni nuovo disegno del form, quindi il
  punto scelto poteva sparire prima dell'invio, anche nel pedido del cliente fra un passo e l'altro (costo
  per distanza perso).

Ora:

- il punto sta nello stato del componente;
- la via che Google non ha dato si scrive senza perderlo, e se il suggerimento scelto ha un numero
  civico ("Magnolias 59") la via si riempie da sola;
- il form della sede dice se la tienda è sulla mappa;
- "Mi tienda en línea" avvisa quando non lo è.

Verifiche: test del componente con Google simulato (fallisce con il codice di prima), test d'integrazione
del servizio, prova nel browser con Google simulato fino al database e alla scomparsa dell'avviso.

**Pagina rimasta alla versione precedente (24/11):** il founder, cambiando l'indirizzo della tienda su
staging con la pagina aperta da prima di un rilascio, ha visto "Algo salió mal" (l'azione del form non
esisteva più sul server, `UnrecognizedActionError`) con un "Reintentar" inutile. Ora i confini d'errore
riconoscono il caso (anche i pezzi di JavaScript spariti dopo un rilascio) e mostrano "Hay una versión
nueva de Gardelia" con "Recargar la página"; i form con `useToastActionState` restano com'erano, con un
avviso che offre di ricaricare. Testi nelle tre lingue. Verifiche: lint ✅ · typecheck ✅ · test unitari
nuovi ✅ · E2E nuovo (risposta del server dopo un rilascio simulata, due form) ✅ · controllo a 320 px. In
produzione si aggiunge la Skew Protection di Vercel (piano Pro, `docs/ROADMAP.md`).

**Chiave di Google e ricognizione (24/11):** il founder ha creato la chiave di Google Cloud
(`GOOGLE_MAPS_API_KEY`, solo nelle variabili di Vercel): "Buscar dirección", costo per distanza e ruta per
vicinanza sono attivi dove c'è la chiave. Ricontrollati staging e i rami delle altre chat: nessun lavoro non
rilasciato. `docs/V1_SCOPE.md` riallineato al codice (consegne, etichette e politica di sostituzione del
catalogo, email degli ordini online erano già fatti). In `docs/ROADMAP.md` la nuova sezione "Prima della produzione":
le quattro cose per la sicurezza (verifica in due passaggi, sessioni attive, aggiornamenti e avvisi,
revisione esterna) e la lista di infrastruttura, prodotto e regole per il primo rilascio su `prod`.

**Scarico dell'inventario dagli ordini (fatto il 23/11, ADR-071):** quando un ordine diventa "Listo" per la
prima volta i suoi materiali escono dall'inventario (`consumeStockTx`, stessa transazione): prodotti venduti
come tali, ricetta concordata dei ramos (lo snapshot della riga ora porta l'ID degli ingredienti; per le righe
vecchie la ricetta attuale) e componenti dei disegni. Registro di uso con il numero dell'ordine, legato
all'ordine (`Order.inventoryEntryId`): niente secondo scarico. Se la merce non basta la scheda lo dice e il
pulsante diventa "Marcar listo aunque falte"; da Hoy salen e Ruta il passo si ferma con il messaggio di aprire
l'ordine. Riquadro "Inventario" nella scheda: cosa uscirà e cosa manca, poi quando è uscito, e l'avviso se una
parte è apartada (da liberare se è per l'ordine). Senza il piano nulla cambia. Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test 839/839 ✅ (10 nuovi
d'integrazione: scarico unico, conferma, ricette vecchie, disegni, apartados, anulación, due clic insieme,
piano Basic, isolamento A↔B) · migrazioni = schema ✅ · build ✅ · E2E 88/88 ✅ su database nuovo (1 nuovo: dal fiore
controllato all'ordine "Listo" con la conferma e al movimento); controllo visivo a 320 e 1280 px. Prossimi: apartados creati
dagli ordini confermati; chi compra che annulla da solo un ordine in attesa; esportazione e cancellazione per le
fiorerie.

**Costo di consegna per distanza (fatto il 23/11, ADR-069):** in Ajustes → Entregas fino a 8 fasce "hasta X km
→ $Y", con l'avviso se manca Google o la posizione della tienda. Distanza in linea retta dalla tienda
all'indirizzo (coordinate di Google, mai scadute); regola unica nel dominio (fascia, fuori zona, o costo
abituale). Ordini online: il server applica la fascia e rifiuta il fuori zona a domicilio; il pedido mostra
le fasce e il costo con la distanza. Al banco "Calcular por distancia" propone il costo, sempre modificabile.
La pagina della tienda elenca le fasce. La manutenzione rinnova le coordinate anche delle fiorerie con
fasce. Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test 829/829 (nuovi: 3 di dominio, 6 d'integrazione con
fuori zona, coordinate scadute e isolamento A↔B) ✅ · migrazioni = schema ✅ · build ✅ · E2E 87/87 (1 nuovo: fasce
nelle impostazioni) ✅; controllo visivo con coordinate vere a 320 e 1280 px.

**Documenti legali e diritti di chi compra, blocco C5 (fatto il 23/11, ADR-068):** bozza aggiornata
dell'aviso de privacidad (chi compra, dati degli ordini e di chi riceve, condivisione con la fioreria,
cookie dell'attribuzione) e nuova bozza dei **termini per chi compra**, senza regole di legge inventate
(`[validar]` e domande 12–17 per l'avvocato in `docs/legal/README.md`). Pagine `/privacidad`, `/terminos`,
`/terminos/compradores` con il riquadro "BORRADOR" (testi copiati da `docs/legal` con `legal:sync`, un
test li tiene allineati; markdown reso senza HTML iniettato); link in fondo alle pagine pubbliche, avviso
con i link in registrazione e nel pedido, versione dei testi registrata con ogni ordine online. In "Mi
cuenta": "Descargar mis datos" (JSON) ed "Eliminar mi cuenta" con conferma per email (Better Auth),
bloccata per chi ha una fioreria o ordini in corso; gli ordini restano alle fiorerie senza il
collegamento. Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test 820/820 ✅ (10 nuovi: 2 di
dominio, 4 d'integrazione su scarico, blocchi e cancellazione reale col ruolo dell'app, 4 del web) · build
✅ · E2E 86/86 ✅ (1 nuovo: pagine legali, scarico dei dati e cancellazione confermata per email);
controllo visivo a 320 e 1280 px. **Prima della produzione:** revisione dell'avvocato dei testi. Prossimi:
costo di consegna per distanza; scarico dell'inventario dagli ordini; esportazione e cancellazione per le
fiorerie.

**Ordine del cliente dalla tienda en línea, blocco C4 (fatto il 23/11, ADR-067):** in Tienda en línea
"Pedidos en línea" (interruttore, anticipo minimo 0–14 giorni; servono una forma di pagamento e il telefono).
Con gli ordini accesi la pagina della fioreria e quella del prodotto mostrano "Hacer un pedido" / "Pedir en
línea": modulo a passi `/f/<slug>/pedido` (prodotti, consegna o ritiro con giorno, fascia e indirizzo salvato
o nuovo, tarjeta e commenti, riepilogo e telefono), con l'accesso richiesto e i testi per chi compra. Prezzi,
costo di consegna e totali dal server; giorni di chiusura e anticipo bloccano; massimo 3 ordini in attesa per
persona e fioreria. L'ordine nasce "Por aceptar" con link di tracciamento, cliente collegato al CRM per
email; email a chi compra e a proprietari e gerenti. La fioreria lo accetta (email con totale e come pagare)
o lo rifiuta con un motivo che il cliente legge; avviso e filtro "Por aceptar" in Pedidos. Senza risposta in
3 giorni (o col giorno passato) si annulla nella manutenzione giornaliera. "Mis pedidos" in "Mi cuenta".
Attribuzione dalla ricerca (`/buscar/ir/<slug>`, cookie di 30 giorni): `MARKETPLACE_B2C` solo per chi non
era già cliente della fioreria. Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test 793/793 ✅ (23
nuovi: 6 di dominio, 14 d'integrazione con isolamento A↔B fra fiorerie e fra persone, 3 del web) ·
migrazioni = schema ✅ · build ✅ · E2E 84/84 ✅ (1 nuovo: dalla scheda del prodotto alla registrazione,
all'ordine, all'accettazione e a "Mis pedidos"); controllo visivo a 320 e 1280 px. Dopo l'unione con l'import dei clienti (migrazione rinominata a `20261123232000` per seguire
quelle già su staging): test 810/810 ✅ · E2E 85/85 ✅. Prossimi: C5 (termini per
i consumatori e privacy di chi compra); costo di consegna per distanza; scarico dell'inventario dagli
ordini; chi compra che annulla da solo un ordine in attesa.

**Home per chi compra e ricerca delle fiorerie, blocco C3 (fatto il 23/11, ADR-066):** `/` è ora la home di
chi compra fiori ("¿A dónde enviamos tus flores?", come funziona, rimando per i fioristi); la presentazione
del gestionale è su `/floristas`. Ricerca per città per tutti (nessuna chiamata a Google), per indirizzo con
Google e con gli indirizzi salvati solo con l'accesso. `/buscar` mostra prima le tiendas che arrivano
all'indirizzo (raggio della fioreria, 10 km se non indicato), dalla più vicina, poi quelle della stessa città
senza posizione nota. La manutenzione rinnova le coordinate delle tiendas pubblicate prima dei 30 giorni.
Aggiornate anche due righe vecchie di `docs/V1_SCOPE.md` (logo, Google Places). Verifiche locali: lint ✅ ·
format ✅ · typecheck ✅ · test 752/752 ✅ (10 nuovi: 5 di dominio, 5 d'integrazione, ripetibili sul database
condiviso) · migrazioni = schema ✅ · build ✅ · E2E 81/81 ✅ (2 nuovi; il flusso della tienda parte dalla home);
controllo visivo a 390 e 1280 px. Prossimi: C4, l'ordine del cliente online.

**Logo e copertina della tienda en línea, C2b (fatto il 23/11, ADR-065):** in Tienda en línea "Logo y
portada" con anteprima, caricamento (riduzione nel browser e controllo sul server come le foto del catalogo),
"Cambiar" e "Quitar"; nella pagina pubblica la copertina in alto e il logo accanto al nome (anche
nell'intestazione), e la copertina come immagine dell'anteprima quando si condivide il link. L'ID
dell'immagine è nell'indirizzo, così la cache non mostra mai quella vecchia; si serve solo l'immagine
attuale di una tienda pubblicata. Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test 742/742 ✅ (3
nuovi: caricamento, sostituzione, rimozione, permessi e isolamento A↔B) · migrazioni = schema ✅ · build ✅
· E2E 79/79 ✅ (il flusso della tienda carica logo e copertina e controlla che si vedano davvero); controllo
visivo a 390 e 1280 px. Prossimi: C3 home per chi compra e ricerca per indirizzo.

**"Mi tienda en línea", blocco C2 del marketplace (fatto il 23/11, ADR-065):** Ajustes → Tienda en línea
(presentazione, forme di pagamento con i dati per pagare, cosa manca per pubblicare, pubblica/ritira, link
da copiare o mandare su WhatsApp); nel catalogo "Mostrar en mi tienda en línea" per ramos, piante, fiori e
accessori, con il badge "En línea". Pagina pubblica `/f/<slug>` nella lingua del mercato: prodotti con foto
e prezzo, consegne, forme di pagamento; pagina del prodotto con di cosa è fatto e "Pedir por WhatsApp"
(niente ordini finti fino a C4). Accesso senza sessione con `app_public_store_tenant(slug)` e RLS attiva,
solo campi pubblici. Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test 739/739 ✅ (12 nuovi: 4 di
dominio, 8 d'integrazione con isolamento A↔B e nessun costo nei dati pubblici) · migrazioni = schema ✅ ·
build ✅ · E2E (1 nuovo: dalla scheda del prodotto alla pagina pubblica e ritorno) ✅; controllo visivo a
390 e 1280 px. Prossimi: logo e foto della fioreria; C3 home per chi compra e ricerca per indirizzo.

**Flussi a passi (fatto il 23/11, ADR-044 esteso, richiesta del founder):** "Nuevo pedido" in tre passi
(Cliente → Productos → Entrega y tarjeta, con "Continuar" solo quando c'è almeno un prodotto e il riepilogo
sempre visibile) e creazione della fioreria in due (Tu florería → Dirección de la tienda), con l'aiuto
`lib/form-steps.ts`. Corretto anche l'allineamento di "Desde"/"Hasta" nel modulo di consegna. Restano
senza passi i moduli brevi e "Convertir en pedido". Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test 721/721 ✅ (2 nuovi sull'aiuto dei passi) · build ✅ · E2E 77/77 ✅ (i flussi di ordini e onboarding con i passi; l'onboarding controlla anche che senza nome non si va avanti e che "Atrás" non perde i dati); controllo visivo a 390 e 1280 px.

**Conto del cliente, blocco C1 del marketplace (fatto il 23/11, ADR-064):** "Mi cuenta" (`/cuenta`) per
chi compra: nome ed email dell'accesso, telefono, indirizzi di consegna con "Buscar dirección" (la stessa
rubrica della fioreria, spostata in `components/addresses/address-book.tsx`). Login e registrazione
verso `/cuenta` parlano a chi compra e la destinazione resta fino alla verifica dell'email; da quando la
persona ha aperto "Mi cuenta", un accesso senza fiorerie porta lì invece che all'onboarding (i
fioristi non cambiano strada). Dati per persona (`BuyerProfile`, `BuyerAddress`) con RLS per utente,
servizi in `withUserContext`, contesto solo dalla sessione (`getBuyerContext`, `runBuyerAction`);
coordinate anche qui cancellate dopo 30 giorni. Gli ordini in "Mi cuenta" arrivano con C4. Verifiche
locali: lint ✅ · format ✅ · typecheck ✅ · test 694/694 ✅ (nuovi: 9 d'integrazione con isolamento fra persone
A↔B e salvataggi contemporanei, 1 di RLS per utente, 1 di manutenzione, 1 sui percorsi) · migrazioni = schema ✅ ·
build ✅ · E2E 75/75 ✅ (1 nuovo: registrazione del cliente fino al rientro in "Mi cuenta"; quello delle fasce di consegna ora controlla l'errore sotto il campo, perché con una pagina lenta lo stesso testo compare anche in un toast: correzione proposta a parte); controllo
visivo a 390 e 1280 px. Prossimi: C2 "Mi tienda en línea" e pagina pubblica della fioreria.

**Inventario, blocco 1 (fatto il 23/11, ADR-060, richiesta del founder):** voce "Inventario" nel menu
(su telefono in "Más") con Existencias e Movimientos. "Elegir productos": si scrive quanti ce ne sono
di ogni prodotto fisico del catalogo da controllare e, se si vuole, il minimo ("Avísame con"); la
existencia inicial entra al costo del catalogo. Scheda del prodotto: uso e merma (se la merce non
basta, avviso e "Registrar de todos modos", la giacenza può andare sotto zero), conteggio fisico
(registra la differenza), aviso, "Dejar de controlar", storico con "Anular" (registro opposto, una
volta sola). Avvisi "Por agotarse" e "Agotado" con i filtri; il clic proposto cambia la disponibilità
nel catalogo (mai da sola). Riquadro nella scheda del catalogo, riga nella pagina del piano. Decisioni
del founder: unità del catalogo, avviso con conferma, movimenti solo proprietario e manager (lo staff
vede le quantità senza costi), piano Plus, niente resi né lotti; le organizzazioni per le catene sono
registrate per dopo (D-28). Per gli ordini (altra sessione) sono pronti `checkStock`/`checkStockTx` e
`consumeStockTx`, da usare nella transazione dell'ordine, senza effetti per chi non usa l'inventario.
Registri e movimenti non si modificano né si cancellano (RLS), la giacenza è sempre la somma dei
movimenti. Testi nel namespace `inventory` delle tre lingue. Verifiche locali, dopo l'integrazione di staging (consegne, link pubblici, ruta): lint ✅ · format ✅ · typecheck ✅ · test 638/638 ✅ (33 nuovi: 15 di dominio, 14 d'integrazione con isolamento A↔B, concorrenza e invarianti, 1 sui permessi, 3 del web) · build ✅ · E2E 73/73 ✅ (3 nuovi: proprietario, staff, fioreria Basic); controllo visivo a 1280 e 320 px. Prossimi: blocco 2 compras y proveedores (costo reale),
blocco 3 apartados con vencimiento, blocco 4 avvisi nel pannello e costo dei ramos.

**Inventario, blocco 2 (fatto il 23/11, ADR-061):** scheda "Compras" (solo proprietario e manager).
"Nueva compra" con proveedor esistente, nuovo o nessuno, giorno, nota e righe con quantità ("100" o
"4x25") e totale pagato, con il costo per unità e il totale mentre si scrive. La merce entra e il
costo reale (media ponderata) si aggiorna; "Anular compra" lo riporta com'era. Pagina dei
proveedores (aggiungere, modificare, archiviare). Nella scheda del prodotto il costo reale accanto a
quello del catalogo, con la differenza, e "Usar este costo en el catálogo" (un clic, valore letto dal
server). Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test 650/650 ✅ (12 nuovi: 5 di
dominio, 7 d'integrazione con isolamento A↔B) · build ✅ · E2E 74/74 ✅ (1 nuovo: compra con proveedor nuovo, costo reale, anulación); controllo a 1280 e 320 px. Prossimi: blocco 3
apartados con vencimiento, blocco 4 avvisi nel pannello e costo dei ramos.

**Inventario, blocco 3 (fatto il 23/11, ADR-062):** scheda "Apartados" (tutti la vedono, la usano
proprietario e manager): merce messa da parte per un evento o un cliente fino a una data (proposta
fra 3 giorni, al massimo 90). La giacenza non cambia: cambia il disponibile, che decide avvisi,
stato e controlli degli usi e degli ordini. Il giorno dopo la scadenza l'apartado è vencido e non
tiene più merce (calcolato alla lettura, senza job). "Usar" scarica quanto si è usato davvero (il
resto resta in giacenza), "Extender" cambia la data, "Liberar" restituisce la merce; avviso e
conferma se la merce non basta. Scheda del prodotto con i suoi apartados e "Apartar"; disponibile
nell'elenco e nel riquadro del catalogo; quattro schede dell'inventario, su telefono in due righe.
Per gli ordini: `reserveStockTx`, `consumeReservationTx`, `releaseReservationTx`. Verifiche locali:
lint ✅ · format ✅ · typecheck ✅ · migrazioni allineate allo schema ✅ · test 671/671 ✅ (16 nuovi: 6
di dominio, 10 d'integrazione con isolamento A↔B e due "Usar" nello stesso istante) · build ✅ · E2E
75/75 ✅ (1 nuovo: apartar, extender, usar e liberar; lo staff vede ma non crea); controllo a 320 px.
Prossimo: blocco 4 avvisi nel pannello e costo dei ramos (ADR-063).

**Inventario, blocco 4 (fatto il 23/11, ADR-063):** riquadro "Inventario" nel pannello (agotados,
por agotarse sul disponibile, apartados in scadenza e vencidos). Nella scheda di un ramo con ricetta:
quanti ramos alcanzan con la merce disponibile, ingredienti con disponibile, costo dei materiali
previsto e reale con la differenza (chi vede i costi) e "Registrar ramos hechos" (la ricetta × N
esce con un registro di uso, avviso e conferma se non basta). Riepilogo del mese nei Movimientos
(compras, usato al costo reale e ai costi del catalogo, mermas; senza i registri annullati). Testi
della pagina del piano aggiornati. Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test
707/707 ✅ (9 nuovi: 3 di dominio, 6 d'integrazione con piano, ruoli e isolamento A↔B) · build ✅ ·
E2E 76/76 ✅ (1 nuovo: ramo con ricetta, ramos hechos, pannello e riepilogo); controllo a 320 px.
L'inventario della V1 è completo; restano consumo e apartados dagli ordini (sessione degli ordini).

**Clienti completi, blocco 1 (fatto il 23/11, ADR-070):** sezione "Historial" nella scheda del
cliente con preventivi, ordini (creato, confermato, consegnato o ritirato, annullato col motivo),
pagamenti, promozioni inviate e codici usati, dalla più recente, ognuno col suo link; "Ver más" di
20 in 20. Solo lettura sulle tabelle degli altri moduli. Decisioni del founder per l'import (blocco
3): senza consenso marketing, tutti i piani, proprietario e manager. Verifiche locali: lint ✅ ·
format ✅ · typecheck ✅ · test 728/728 ✅ (4 nuovi d'integrazione con isolamento A↔B) · build ✅ ·
E2E 79/79 ✅ (1 nuovo: il preventivo creato dalla scheda compare nell'Historial); controllo a 320 px.
Prossimi: blocco 2 etichette e filtri, blocco 3 import da CSV con anteprima.

**Clienti completi, blocco 2 (fatto il 23/11, ADR-070):** lista clienti con i filtri per etichetta,
consenso alle promozioni e "Fecha especial en 30 días" (nel database, dai giorni del calendario della
finestra); etichetta aggiunta o tolta a più clienti insieme (caselle, "Seleccionar todos", fino a 100
per volta, solo proprietario e manager), chi ha già 15 etichette viene saltato e contato; una voce di
audit per gruppo senza il testo dell'etichetta. Correzione: i testi di "Actividad reciente" della
dashboard non si trovavano (chiavi col punto) e mostravano sempre il testo generico; ora sono
annidati, con un test che lo controlla. Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · test
770/770 ✅ (15 nuovi: 4 di dominio, 5 d'integrazione con isolamento A↔B, 6 sui testi dell'attività)
· build ✅ · E2E 83/83 ✅ (1 nuovo: etichetta a più clienti e filtri); controllo a 320 px.
Prossimo: blocco 3 import da CSV con anteprima.

**Clienti completi, blocco 3 (fatto il 23/11, ADR-070):** "Importar" nella lista clienti
(proprietario e manager, tutti i piani): modello da scaricare nella lingua di chi lo usa, CSV con
separatore e codifica riconosciuti (anche Excel in spagnolo), colonne riconosciute nelle tre lingue e
correggibili a mano, anteprima con righe pronte, errori campo per campo e duplicati per telefono o
email (clienti già presenti o righe ripetute), poi import nella stessa transazione con origine
IMPORT, compleanni e aniversarios come date speciali e **senza consenso marketing**. La bozza
(`CustomerImport`, RLS) tiene il file solo finché non si importa o si annulla; quelle dimenticate
si chiudono con la manutenzione giornaliera dopo un giorno. Verifiche locali: lint ✅ · format ✅ ·
typecheck ✅ · test 787/787 ✅ (17 nuovi: 9 di dominio, 5 d'integrazione con isolamento A↔B, 3 sulle
intestazioni del modello nelle tre lingue) · build ✅ · E2E 84/84 ✅ (1 nuovo: import con anteprima;
aggiornato quello dei lavori giornalieri per il nuovo conto); controllo a 320 px.
Resta per CRM-01: abbonamenti e interventi nella cronologia (con SUB-01 e CARE-01).

**Fase di prova senza piani (fatto il 24/11, D-29):** su decisione del founder, finché la usano poche
fiorerie tester ogni fioreria ha tutte le funzioni: un solo interruttore nel dominio
(`PLAN_FEATURES_ENFORCED = false`) accende Diseñador, inventario e il resto per tutti; il codice dei
piani resta, spento, per i livelli di D-23. Le anteprime con IA si pagano sempre: quelle incluse
restano del piano assegnato (nessuna in quello predefinito), il resto con i crediti che la
piattaforma assegna dopo il pagamento (GitHub → Actions → "Operazioni di piattaforma" →
`grant-ai-credits`, con l'indirizzo della fioreria e il numero di anteprime). La
pagina del piano dice "Todo incluido" con i crediti rimasti; quando i crediti finiscono, il
Diseñador e la pagina del piano mostrano "Comprar créditos por WhatsApp" verso il numero in
`PLATFORM_WHATSAPP` (variabile dell'hosting, mai nel repo). Verifiche locali: lint ✅ · format ✅ ·
typecheck ✅ · test 844/844 ✅ (5 nuovi: 2 di dominio, 3 sulla configurazione; 13 d'integrazione
riscritti da "senza Plus è bloccato" a "senza abbonamento funziona", isolamento fra fiorerie
invariato) · build ✅ · E2E 88/88 ✅ (4 aggiornati: piano, Diseñador, inventario e Mis ramos senza
abbonamento); controllo a 320 px. In locale i test degli ordini scadevano perché i clienti creati
dai test precedenti spingono "Hotel Casa Fuentes" fuori dalla prima pagina: archiviati, ripassano
(in CI il database è nuovo a ogni giro).

**Resti degli ordini (fatto il 24/11, ADR-072):** tre pezzi chiesti dal founder ("si vai col
punto 1").

- **Chi compra annulla da solo** un ordine online ancora "Por aceptar": pulsante "Cancelar pedido"
  in "Mi cuenta", con conferma. Email a chi compra e alla fioreria; dopo l'accettazione non si può
  più.
- **Conferma per email al cliente degli ordini del banco:** casella "Enviar la confirmación del
  pedido a …" (già spuntata) quando si crea l'ordine dal preventivo o si conferma un borrador.
  L'email ha il riepilogo e il link "Ver mi pedido". Il modulo dice quando il cliente non ha email
  o la fioreria è demo (lì non parte mai nulla).
- **Apartados dagli ordini confermati:** i materiali dell'ordine restano messi da parte e il
  disponibile scende, ma solo negli ultimi 7 giorni prima della consegna (PROPOSTO: un ordine di
  San Valentino preso a gennaio non blocca le rose di oggi). L'apartado segue righe e giorno
  dell'ordine; a "Listo" i materiali escono da lì con un solo movimento; se l'ordine si annulla la
  merce si libera. Fra gli apartados si vede di quale ordine è, senza i pulsanti manuali.

Verifiche locali:

- lint ✅ · format ✅ · typecheck ✅ · build ✅;
- test 866/866 ✅: 22 nuovi, 6 di dominio e 16 d'integrazione, con isolamento fra fiorerie;
- E2E 88/88 ✅: 3 aggiornati (annullamento da "Mi cuenta", avviso demo nel modulo, apartado
  dell'ordine nell'inventario). In locale gli ordini "di oggi" lasciati dai giri precedenti spingono
  quello nuovo alla seconda pagina, come i clienti: spostati indietro, ripassano.

Resta: il preventivo per email al cliente (V1_SCOPE riga 13).

**Floral Care, blocco 1 (fatto il 24/11, ADR-075):** la visione del founder ("l'offerta floral
care deve essere configurabile… pensala bene nel profondo") è diventata un piano in sette blocchi,
approvato e salvato in `docs/FLORAL_CARE_PLAN.md`. Il blocco 1:

- **Ajustes → Floral Care:**
  - tariffa per visita, cura per pianta secondo la misura, frequenze offerte, zona di servizio,
    aviso minimo, regole (cliente che non apre, pianta morta) e i termini scritti dalla fioreria;
  - un simulatore del canone con le tariffe salvate;
  - orari di visita per giorno con i posti; servizi, con la nostra lista più quelli del fiorista;
  - cargo per distanza.
- **Contratti (Floral Care nel menu):**
  - si crea dalla scheda del cliente: sede, frequenza e orari, primo giorno, servizi, dati
    pratici della sede;
  - si aggiungono le piante della diagnosi, anche a gruppi;
  - "Confirmar": il server calcola e salva il prezzo, poi agenda le visite dei prossimi 60 giorni;
  - dopo: cambio di calendario, servizi e dati, prezzo aggiornato, fine.
- **Agenda (nuova voce):** il giorno con le visite per orario (posti occupati) e i pedidos, il
  mese, le visite da riprogrammare, la pagina della visita ("Hecha", "No se pudo", sposta,
  cancella, assegna).
- **"Sí, avisé al cliente":** il server lo chiede su ogni cambio che tocca visite già fissate.
- **Capienza:** un solo percorso per prenotare. Con l'orario pieno la visita va in un altro
  orario della stessa settimana e mese, altrimenti resta "Por reprogramar". Due conferme insieme
  non superano mai la capienza (test).
- **Manutenzione:** allunga le visite e chiude i contratti finiti come lavoro senza utente
  (`JobScope`, registro con attore nullo e nome del lavoro). Un test vieta i `TenantContext` finti.

Verifiche locali:

- lint ✅ · format ✅ · typecheck ✅ · build ✅;
- test 933/933 ✅ (con l'eliminazione delle fiorerie dell'altra sessione): 43 nuovi, 18 di dominio,
  24 d'integrazione (isolamento fra fiorerie, due conferme insieme sulla capienza, lavori senza
  utente, cancellazione definitiva di una fioreria con contratti e visite) e 1 di convenzioni;
- E2E 97/97 ✅, con i 2 nuovi di Floral Care (offerta, orario, contratto con piante, conferma,
  visita nell'Agenda, spostamento con la casella; il banco vede ma non cambia); controllo a 320 px
  di tutte le pagine nuove (Ajustes → Floral Care sbordava di 3 px: corretto).

**Floral Care, blocco 2a (fatto il 24/11, ADR-078):** "ok vai col blocco 2" del founder, diviso in
due rilasci. Il founder ha deciso l'Agenda nella barra in basso al posto di Clientes e la visita
extra in un orario o a un'ora libera (per il 2b). Il 2a:

- **La visita dal telefono** (anche lo staff): "Empezar visita", poi servizi della checklist
  ("Hecho" / "No se hizo"), stato di ogni pianta con "Todas bien", foto una alla volta dalla
  fotocamera o dalla galleria (al massimo 20, un nuovo tentativo non crea doppioni), materiali che
  escono dall'inventario solo a "Terminar", nota per il cliente, avvisi per chi gestisce. "Terminar"
  chiede lo stato di ogni pianta e la conferma se manca giacenza; "No se pudo" con la nota.
- **Resoconto:** nella pagina della visita, per email al cliente (tabella d'uscita, "Reintentar" e
  nuovi tentativi della manutenzione; mai dalla fioreria demo) e con il link `/visita/<token>`
  (60 giorni, stampabile, con il logo), senza prezzi né materiali.
- **Avvisi del equipo:** reposición (anche automatica per una pianta morta), extra, altro; chi
  gestisce li segna "Atendido". L'Agenda li conta.
- **Foto cancellate** 30 giorni dopo la fine del contratto (la manutenzione, prima i file poi la
  riga; errore nel log dopo 7 giorni di ritardo), subito se tolte; anche con l'eliminazione di una
  fioreria.
- **Ruta del día con le visite:** scheda "Ruta" dell'Agenda con consegne e visite in un solo giro,
  per fascia e vicinanza (la stessa regola, ora nel dominio, ordina la ruta dei Pedidos).
- **Barra in basso:** Inicio, Pedidos, Cotizaciones, Agenda, Más (Clientes in "Más").
- **Cronologia del cliente:** le visite hechas e no realizadas.

Verifiche locali, dopo l'unione con staging (verifica in due passaggi, dati della fioreria):

- lint ✅ · format ✅ · typecheck ✅ · migrazioni = schema ✅ · build ✅;
- test 995/995 ✅: 38 nuovi del 2a, 16 di dominio (checklist, conteggio delle piante, data di
  cancellazione delle foto anche a cavallo di mese e anno, `careEmailsAllowed`, ordine della ruta,
  schemi) e 22 d'integrazione (avvio e passi, foto con doppioni e limite, due "Terminar" insieme =
  un registro d'inventario e un'email, email fallita e nuovi tentativi, link pubblico, permessi,
  isolamento A↔B, cancellazione delle foto con storage che fallisce, eliminazione di una fioreria);
- E2E 101/101 ✅, con il nuovo "la visita dal telefono" (staff su un telefono 360×740: Empezar,
  servizi, Todas bien e un Problema, foto, nota, Terminar; il link pubblico senza sessione con la
  foto; la proprietaria vede l'avviso e la visita nella Ruta). In locale il test dei 14 giorni
  della verifica in due passaggi vuole `DATABASE_URL` nell'ambiente, come in CI: da solo con la
  variabile è verde;
- controllo a 320 px delle pagine nuove (visita in tutti gli stati, ruta, avvisi, resoconto
  pubblico).

**Floral Care, blocco 2b (fatto il 24/11, ADR-078):** il resto del blocco 2.

- **Visita extra** dal contratto (chi gestisce): lavoro extra, reposición, installazione o ritiro di
  stagione, in un orario di visita (conta i posti) o a un'ora libera (scelta del founder: niente
  posti, i clienti non la scelgono). Costo dal server: tariffa per visita del contratto con il
  viaggio, "Sin costo" o "En la cotización". Si sposta anche a un'ora libera; il nuovo calendario
  la lascia, la fine del contratto la cancella; nell'Agenda ha l'etichetta "Extra".
- **Piante morte e altri avvisi:** si risolvono una volta sola. Una pianta morta: "Reposición sin
  costo" (apre il modulo della visita extra nel contratto), "En la próxima visita", "Cotizar", "No
  se repone"; gli altri: "Atendido" o "Cotizar". La regola della fioreria mette in evidenza la
  scelta suggerita.
- **Cotización dal contratto:** "Cotizar" crea la bozza legata al contratto, con il titolo nella
  lingua del mercato, e apre l'editor. Lo staff no.
- **Cambio di stagione:** piante "De temporada" fuori dal prezzo; la scheda del contratto guida
  cotización, piante, installazione e ritiro, e mostra le cotizaciones del contratto; alla fine del
  ritiro le piante di temporada si archiviano (casella attiva).
- I due dialoghi lunghi (visita extra, piante) ora scorrono dentro lo schermo (poi esteso a tutti
  nel blocco 3a).

Verifiche locali:

- lint ✅ · format ✅ · typecheck ✅ · migrazioni = schema ✅ · build ✅;
- test 1014/1014 ✅: 19 nuovi del 2b, 11 di dominio (moduli della visita extra e dello spostamento
  a un'ora libera, costo per tipo, scelte e suggerimento degli avvisi, casella di temporada) e 8
  d'integrazione (posti in un orario e no a un'ora libera, Agenda per ora, calendario nuovo e fine
  del contratto, cotización del contratto e permessi, piante morte risolte una volta sola, piante di
  temporada fuori dal prezzo e archiviate al ritiro, isolamento A↔B);
- E2E 102 ✅: il nuovo "visite extra e cambio di stagione" (visita extra a un'ora libera nella
  Agenda, pianta di temporada, cotización dal contratto con il titolo, ritiro "en la cotización").
  Nel giro completo 101/102: il test del 2a non trovava posto per l'orario casuale (uno uguale
  rimasto da un'esecuzione interrotta); l'aiutante ora salta gli orari esistenti e lo spec di
  Floral Care passa due volte di fila;
- controllo a 320 px di contratto, dialogo della visita extra, avvisi e Agenda (la riga di una
  visita extra nel contratto sbordava di 6 px: corretta).

**Floral Care, blocco 3a (fatto il 24/11, ADR-082):** "ok vai col blocco 3" del founder, con le
sue quattro decisioni del 24/11 ("Días para pagar" della fioreria, 10 di default; il cliente che
non apre paga la visita e il recupero è gratis; un solo pagamento sull'estado de cuenta per tutte
le sedi; lo staff segna gli incassi "por registrar"). Diviso in 3a (questo) e 3b.

- **Cargo del mese** (`CAR-0001`): nasce alla conferma per il mese in corso, con le visite che
  restano, e poi ogni mese dal lavoro giornaliero (prima degli altri lavori di Floral Care, con il
  suo tetto di tempo; un contratto rimasto indietro recupera un mese alla volta). Non cambia più:
  crediti (visite tolte dalla fioreria, "No pudimos ir", visite cobrate che diventano "Por
  reprogramar"), debiti (visite dovute mai cobrate), visite extra fatte e servizi "una sola vez"
  fatti vanno sul cargo del mese dopo. Prezzo copiato in ogni cargo: un cambio di prezzo emette
  prima il mese in corso al prezzo vecchio. Con il contratto attivo un cargo non va sotto zero (il
  saldo a favore passa al cargo dopo); il cargo dopo la fine può restare a favore del cliente e si
  chiude con "Registrar devolución".
- **Pagamenti:** su un cargo o sull'estado de cuenta (distribuito sui cargos più vecchi), "Anular"
  con lo storno (una volta sola), devolución; chiave del modulo contro il doppio invio; il cliente
  nelle chiavi esterne delle distribuzioni.
- **Pagine:** Floral Care → Cobros (por cobrar, vencidos, pagados, a favor; mese, ricerca, totali);
  pagina del cargo con le righe, i pagamenti e la stampa (intestazione e lingua del mercato,
  "Precios finales, sin impuestos"); estado de cuenta del cliente (tutte le sedi, stampabile); card
  "Cargos" e "Reglas del contrato" nel contratto; "Vencido" negli elenchi; riquadro nel pannello;
  cargos e pagamenti nella cronologia del cliente; "Días para pagar" nelle impostazioni; la causa in
  "No se pudo". I soldi li vede solo chi ha `subscriptions:payments` (PROPOSTO).
- **Regole copiate nel contratto** alla conferma (cliente che non apre, piante morte); i contratti
  già confermati hanno preso quelle di oggi con la migrazione.
- Il dialogo condiviso ora scorre da solo negli schermi bassi (chiusa la nota del 2b).
- **Unione con staging:** nel frattempo l'altra linea di lavoro ha portato su staging l'esportazione
  dei dati (ADR-079), i Reportes (ADR-080) e il catalogo completo (ADR-081), quindi l'ADR dei
  cargos è diventato ADR-082. Lo ZIP dell'esportazione ora contiene anche cargos, loro righe e
  pagamenti di Floral Care.

Verifiche locali:

- lint ✅ · format ✅ · typecheck ✅ · migrazioni = schema ✅ · build ✅;
- test 1056/1056 ✅: 23 nuovi di dominio (visita dovuta, mesi da emettere, righe del mese con
  proporzione, spostamenti, "Por reprogramar", crediti e debiti, extra e "una sola vez", cargo
  finale, scadenza, stati, distribuzione, moduli) e 18 d'integrazione (cargo alla conferma, lavoro
  idempotente e senza utente, mesi saltati, crediti del mese dopo, extra e servizi una volta, cambio
  di calendario, cargo finale e devolución, cambio di prezzo, pagamenti parziali e oltre il saldo,
  storno una volta anche in parallelo, due pagamenti insieme, chiave del modulo, estado de cuenta
  su due sedi, permessi, isolamento A↔B con evento, FK sul cliente, emissione insieme a
  "Terminar", spostamento e cambio di fascia, vencidos nel pannello e negli elenchi);
- E2E: esecuzione completa 94/103. I 9 falliti (ordini, cotizaciones, link pubblici) cercavano
  "Hotel Casa Fuentes" fra i primi 20 clienti dell'elenco, ma il DB locale, dopo molte esecuzioni,
  ne aveva 186. Ora quei test cercano il cliente per nome (`e2e/support/customers.ts`). Gli 8 file
  rilanciati: 28/28 ✅; cotizaciones e link pubblici ripetuti 3 volte: 24/24 ✅. Floral Care 5/5 ✅,
  compreso il nuovo "cargos y pagos";
- dopo l'unione con staging (reports ed esportazione): lint ✅ · format ✅ · typecheck ✅ · test
  1074/1074 ✅ (nello ZIP anche cargos, righe e pagamenti) · build ✅ · E2E 107/107 ✅; dopo quella
  del catalogo completo: lint ✅ · format ✅ · typecheck ✅ · test 1103/1103 ✅, E2E nella CI;
- controllo a 320 px di pannello, Cobros, cargo, dialogo del pagamento, estado de cuenta, contratto,
  elenco e impostazioni: nessuno sbordo.

**Floral Care, blocco 3b (fatto il 24/11, ADR-082):** "vai col 3b" del founder, con le sue
decisioni del 24/11 (il cliente che non apre paga la visita e il recupero è gratis; lo staff segna
gli incassi "por registrar").

- **"Cobré en la visita":** chi fa la visita (in corso o fatta) segna importo, forma e nota. Resta
  "Por registrar": uno alla volta per visita, senza toccare i cargos, visibile in Cobros, nel
  pannello e nell'estado de cuenta (fuori dal saldo). Chi gestisce lo conferma, anche per meno
  (sui cargos più vecchi del cliente), o lo rifiuta con il motivo, che lo staff vede nella visita.
- **"Por recuperar":** la visita "No se pudo" per il cliente, con «Se agenda otra visita», resta
  cobrada e si recupera con una visita extra "Sin costo" legata ("Agendar recuperación" nella
  visita; "Recuperada el …" e "Recuperación de la visita del …"); l'Agenda le conta e le elenca.
- **"Ajuste para el próximo cargo":** a favore o a carico del cliente, con il motivo; entra una volta
  nel cargo dopo come "Ajuste: motivo"; prima si può togliere.
- Migrazione M5; i test E2E del catalogo cercano il cliente del seed per nome.

Verifiche locali:

- lint ✅ · format ✅ · typecheck ✅ · migrazioni = schema ✅;
- test 1116/1116 ✅: 4 nuovi di dominio (ajustes nel cargo e saldo che passa avanti, regola "Por
  recuperar", moduli) e 9 d'integrazione (incasso alla visita una volta per visita e per modulo,
  conferma per meno sui cargos più vecchi e mai di più, due conferme insieme, rifiuto con il motivo,
  isolamento A↔B con evento, ajustes nel cargo dopo e tolti prima, permessi e contratto chiuso,
  recupero gratis una volta e mai cobrato, niente recupero con «Cuenta como hecha» o se la fioreria
  non è andata);
- build ✅ · E2E: esecuzione completa 110/111. Il fallito (blocco 1) cercava il messaggio «Tarifas
  guardadas», che è anche nella descrizione del simulatore («…con tus tarifas guardadas»): ora lo
  cerca esatto. Floral Care rilanciato 6/6 ✅, compreso il nuovo «cobro en la visita y ajustes»
  (lo staff segna dal telefono, la proprietaria conferma per meno, un ajuste si aggiunge e si
  toglie);
- controllo a 320 px di visita (staff, prima e dopo la conferma), dialoghi dell'incasso, della
  conferma e dell'ajuste, Cobros con "Por registrar", contratto con gli ajustes e "Visitas por
  recuperar": nessuno sbordo.

**Floral Care, le risposte del founder dopo il 3b (fatto il 24/11, ADR-082):** i soldi li vedono
solo proprietario e gerente; un incasso confermato senza cargos resta "por registrar"; e due modifiche.

- **Cancelación del cliente con orario limite:** in Ajustes → Floral Care "Si el cliente cancela
  con menos de [12] horas" (0 = mai), copiato nel contratto alla conferma e mostrato fra le regole
  del contratto. Cancellando "La pidió el cliente" la finestra dice se si paga ("no se cobra si
  avisa antes del …" oppure "se cobra") e, se è tardi, offre "No cobrar esta vez" (PROPOSTO). In
  tempo: credito "el cliente avisó a tiempo" nel cargo dopo. La visita ricorda "se cobra" o "no se
  cobra". Migrazione con il nuovo motivo di credito e i contratti già confermati a 12 ore.
- **Reportes con i soldi veri:** la card "Floral Care" del periodo (cargos, cobrado, quanto manca,
  vencido di oggi con il link a Cobros) al posto della stima; solo per chi gestisce i soldi.

Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · migrazioni = schema ✅ · test 1124/1124 ✅
(nuovi: regola dell'orario limite nel fuso della fioreria, 0 ore e visita senza ora, credito con il
suo motivo, campo delle impostazioni; integrazione: cancellazione tardiva pagata, in tempo con il
credito, "No cobrar esta vez" con il registro, Reportes con cargos, cobrado, vencido e una
fioreria vuota) · build ✅ · E2E Floral Care e Reportes 11/11 ✅ (nuovi controlli: regola nel
contratto, cancellazione in tempo "no se cobra", card dei Reportes) · controllo a 320 px di
Reportes, impostazioni, contratto e finestra della cancellazione: nessuno sbordo.

**Floral Care, blocco 4 (fatto il 24/11, ADR-083):** "passa al blocco 4" del founder.

- **Agenda → Bloqueos:** "Bloquear días" (dal–al, tutto il giorno o un orario, un nome) con la
  scelta per le visite già fissate: «Moverlas a otro día» (il giorno libero più vicino dello
  stesso mese, da domani; senza posto "Por reprogramar") o «Cancelarlas sin cobrar» (come tolte
  dalla fioreria: credito nel cargo dopo se erano già cobrate).
- **Anteprima:** "Ver visitas afectadas" elenca i clienti toccati, contratto per contratto, con la
  data nuova e chi non ha l'email. "Guardar bloqueo" vuole "Sí, avisé al cliente" e rifà lo stesso
  piano: se nel frattempo è cambiato qualcosa chiede di rivedere.
- **Email facoltativa:** una per contratto, nella lingua del mercato, dalla coda delle email di
  Floral Care (il lavoro giornaliero riprova); "Enviar aviso" e "Reintentar" nella pagina del blocco.
- **Nessuna prenotazione nei giorni bloccati** (generazione, spostamenti, visite extra); le visite
  che nascono dopo seguono la scelta del blocco. "Quitar bloqueo" libera i giorni.
- **Giorni di punta proposti** (Messico: 14 feb, 10 mayo, 1–2 nov, 12 dic) con "Bloquear";
  "Alguien no puede ir" passa le visite di una persona a un'altra senza avviso.
- **Agenda:** riquadro del giorno bloccato, orario segnato, giorni bloccati nel mese. Esportazione:
  `floral_care_bloqueos.csv`. Migrazione `care_blocks`.

Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · migrazioni = schema ✅ · test 1149/1149 ✅
(nuovi: 13 di dominio su modulo, giorni toccati, posto nel mese, impronta e giorni di punta; 12
d'integrazione su «Mover» con l'avviso e l'email, giorni chiusi a spostamenti e visite extra,
"Quitar", «Cancelar» con il credito, visite generate dopo, impronta cambiata, date, permessi,
isolamento A↔B con evento, blocco e spostamento insieme, "Enviar aviso", cambio di persona) · build
✅ · E2E Floral Care 10/10 ✅ con il nuovo «días bloqueados» · controllo a 320 px di Bloqueos,
anteprima, pagina del blocco e mese: nessuno sbordo (la barra delle schede dell'Agenda scorre).
Il test di concorrenza nella suite completa ha trovato uno stallo possibile (le righe nuove puntano
ai contratti): ora il blocco tiene prima i contratti toccati, poi le fasce, poi le visite.
E2E completo in locale 111/112: l'unico fallito era il test dei sostituti del catalogo (ADR-081),
solo sul database locale già usato. A parità di specie e prezzo i sostituti si ordinano per nome, e
le rose di prova delle esecuzioni precedenti (stesso prezzo) riempivano i 4 posti proposti. Ora il
test usa un prezzo diverso a ogni esecuzione: 6/6 due volte di seguito sullo stesso database. CI
verde su `59f8701` (run 218, E2E compreso) e rilascio su staging.

**Floral Care, blocco 5a (fatto il 25/11, ADR-084):** "ok vai col blocco 5" del founder, con le
sue risposte del 24/11: il contratto finito resta visibile 30 giorni in sola lettura, la fioreria
sceglie in ogni invito se la persona vede prezzi e cobros, i messaggi (5b) li legge tutta la
squadra, al cliente al massimo un'email al giorno (5b).

- **Invito:** card «Acceso del cliente» nella pagina del contratto (proprietario e gerente): email,
  «Solo este contrato» o «Todos sus contratos», «Puede ver precios y cobros». Link firmato di 7
  giorni sempre da copiare o mandare per WhatsApp; l'email solo da una fioreria LIVE. «Reenviar»,
  «Revocar», «Quitar acceso»; la riga «Mi Floral Care» nella scheda del cliente.
- **Accettazione:** `/cuenta/floral-care/invitacion/[token]`, anche senza sessione (login,
  registrazione e Google tornano al link); solo con la stessa email; apre il conto cliente.
- **Mi Floral Care** (`/cuenta/floral-care`): i contratti fra tutte le fiorerie, la pagina del
  contratto (cosa comprende, regole, visite, resoconti con foto, piante, contatti e termini),
  cargos con le righe solo se la fioreria lo sceglie. Contratto finito: sola lettura fino alla
  cancellazione delle foto.
- **«Cambiar fecha»:** nello stesso mese, fra le fasce libere, dopo il preavviso del contratto
  (`minNoticeHours`, ora copiato alla conferma). La fioreria riceve un'email e vede «Cambiada por
  el cliente» nell'Agenda e nella visita.
- **Sicurezza:** modalità portale nel database, chiusa di default (`withPortalContext`,
  `app_portal_enter`, policy `portal_read` su 13 tabelle, `portal_write_guard`); dal portale
  sempre 404. Revoche a mano, con il cliente archiviato e dal lavoro giornaliero 30 giorni dopo la
  fine.
- **Dati:** migrazione `care_portal`; `floral_care_accesos.csv` nell'export della fioreria; gli
  accessi in «Descargar mis datos»; eliminando il conto l'accesso sparisce. Bozza dell'aviso de
  privacidad e domanda 19 per l'avvocato in `docs/legal/`.

Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · migrazioni = schema ✅ · `pnpm audit` ✅ ·
test 1180/1180 ✅ (nuovi: 10 di dominio su invito, stato, confine dei 30 giorni nell'ora della
fioreria, termine per cambiare anche con l'ora legale, stesso mese; 5 RLS su inventario delle
policy del portale, nessun accesso, solo le righe ammesse, nessuna scrittura né GUC che passa,
fioreria del contesto di scrittura; 15 d'integrazione su inviti, accettazione, visibilità e
isolamento A↔B, soldi nascosti anche nel database, resoconto e foto, regole di «Cambiar fecha»,
concorrenza, revoche, sola lettura e chiusura dal lavoro, fioreria cancellata, dati della persona),
poi il portale 16/16 ✅ con l'export della fioreria e il blocco creato mentre il cliente sceglie la
fascia · build ✅ · E2E del portale ✅ (invito, registrazione dal link con la verifica dell'email,
accettazione, «Cambiar fecha», segno nell'Agenda, «Quitar acceso» → 404, link scaduto, conto
sbagliato) · controllo a 320 px di invito, contratto, «Cambiar fecha» e card della fioreria: nessuno
sbordo.
E2E completo in locale 113/113. La CI 223 su `bbb753e` era rossa solo per `legal-content.test.ts`:
la bozza dell'aviso con Mi Floral Care non era stata copiata nella pagina `/privacidad`
(`legal:sync`). Corretto in `5391ba4`; test 1181/1181 in locale; CI verde su `5391ba4` (run 224,
E2E compreso) e rilascio su staging (merge `61764cb`).

**Floral Care, blocco 5b (fatto il 25/11, ADR-084):** "ok vai col 5b" del founder dopo il rilascio
del 5a. Messaggi fra cliente e fioreria, con le decisioni del 24/11 (li legge e risponde tutta la
squadra; al cliente al massimo un'email al giorno per contratto).

- **Fioreria:** card «Mensajes» nella pagina del contratto (gli ultimi 30, «Ver mensajes
  anteriores», il modulo con una foto, l'avviso se nessuno del cliente ha accesso, «Quitar foto»
  per chi gestisce); scheda «Mensajes (N)» accanto a Contratos e Cobros, per tutti i ruoli
  (permesso nuovo `care:messages`), con i fili e prima quelli da leggere; riquadro «Mensajes sin
  leer» in cima al pannello. Aprire il filo lo segna letto per tutta la squadra.
- **Cliente:** sezione «Mensajes con …» nella pagina del contratto di Mi Floral Care, dopo le
  prossime visite; «Nuevos» dopo l'ultima lettura; i nuovi nell'elenco e nella card di «Mi
  cuenta»; a contratto finito si legge e basta. Massimo 30 messaggi al giorno per persona e
  contratto.
- **Avvisi:** al cliente un'email al giorno per contratto quando la fioreria scrive (solo LIVE,
  solo a chi ha accesso, senza il testo); a proprietari e gerenti un riassunto giornaliero dei non
  letti, solo con novità, fino a 3 tentativi, una volta al giorno anche con più giri della
  manutenzione.
- **Database:** due migrazioni (`care_messages_enum`, `care_messages`): `CareMessage`,
  `CarePortalRead`, `CareMessageDigest` con RLS; la foto del messaggio in `CarePhoto`; dal portale
  le policy `portal_insert` (solo i propri messaggi e le loro foto, sul contratto aperto) e la
  DEFINER `app_portal_mark_read()`; nessun UPDATE né DELETE dal portale.
- **Dati:** `floral_care_mensajes.csv` nell'export della fioreria; i messaggi in «Descargar mis
  datos»; eliminando il conto i messaggi restano alla fioreria con «Cuenta eliminada»; le foto dei
  messaggi si cancellano con quelle delle visite. Bozza dell'aviso de privacidad e domanda 19
  aggiornate (`legal:sync` fatto).

Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · migrazioni = schema ✅ · `pnpm audit` ✅ ·
test 1200/1200 ✅ (nuovi: 5 di dominio su schema, limiti, pagine del filo, codici e il permesso per
tutti i ruoli; 2 RLS: dal portale solo i propri messaggi CUSTOMER con la loro foto sul contratto
aperto, mai SHOP, a nome di un altro o su un altro contratto, nessun UPDATE né DELETE, il segno di
lettura solo per sé, niente più messaggi a contratto finito, più l'inventario delle policy; 10
d'integrazione: tutti e due scrivono (staff compreso), letti e nuovi dai due lati, doppio invio,
tetto al giorno, foto vista e tolta, isolamento A↔B con la sonda, contratto finito, avviso al
cliente uno al giorno e solo con accesso e LIVE, nuovo tentativo dal lavoro, riassunto una volta
al giorno solo con novità e ritentato, CSV, dati della persona, conto eliminato, cancellazione
delle foto a fine contratto; 1 dei percorsi) · build ✅ · E2E dei messaggi e del portale ✅ (la
persona scrive con una foto, la proprietaria vede il non letto nel pannello e in «Mensajes (1)»,
risponde, la foto solo dalla route privata e 404 per chi non è della fioreria, lo staff vede il
filo letto senza «Cobros» né «Quitar foto», la persona vede la risposta come nuova e poi letta,
«Quitar foto» lascia il testo) · controllo a 320 px del filo nel portale, dell'elenco «Mensajes» e
della card della fioreria: nessuno sbordo.
E2E completo in locale 114/114. CI verde su `ad9b1d0` (run 230, E2E compreso) e rilascio su
staging (merge `4b0c3d6`).

**Floral Care, blocco 6a (25/11, ADR-085):** "ok vai col blocco 6"
del founder, con le decisioni del 25/11 (solo foto libere per la prova; Opus 5.5, Sonnet 5.5 e Haiku
5.5 con un tetto di 15 USD; consultas del fiorista pagate da Gardelia, al massimo 20 al giorno per
fioreria dentro un budget mensile; per i clienti 0–10 incluse al mese per contratto, poi a
pagamento).

- **Dati:** 19 piante d'interno nuove (91 specie, 36 in vaso); `CanonicalFlower.care` con luce,
  acqua, umidità e tossicità per cani e gatti dall'ASPCA (`reviewed: false`); colonne di cura nel
  foglio di revisione. DA VALIDARE da un fiorista.
- **Database:** migrazioni `plant_assistant` e `plant_assistant_purge`: `AssistantCase`,
  `AssistantAnswer`, `AssistantCall` (solo inserimenti, RLS, FK composite, CHECK), la DEFINER
  `app_assistant_spend_since` per il budget e i casi nella cancellazione delle foto.
- **Motore:** `ClaudePlantAssistant` (`@anthropic-ai/sdk` 1.14.0 fissato: output strutturato,
  effort basso, sistema in cache, fallback lato server, costo dai token veri) e
  `SimulatedPlantAssistant` (solo locale); configurazione `ASSISTANT_PROVIDER`,
  `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL`, `ASSISTANT_MONTHLY_BUDGET_USD` (Opus 5.5 e 20 USD finché
  il founder non sceglie).
- **Servizi:** permesso `care:assistant` per tutti i ruoli; tetto del giorno (20 risposte e 40 foto
  per fioreria) e budget del mese controllati prima della chiamata, fatta fuori dalle transazioni;
  errori e rifiuti registrati col costo ma non contati; registro `care.assistant_answered` senza
  testi.
- **Interfaccia:** pagina `subscriptions/[id]/assistant` (foto ridotta nel browser → specie
  candidate con la scheda per prima, «Otra», «No sé» → domanda → risposta con i passi, cura e
  avviso per cani e gatti dai nostri dati, avviso dell'IA; «Otra pregunta» fino a 3 per foto;
  contatore del giorno); card nel contratto, icona su ogni pianta, «Preguntar al asistente» sulle
  piante con un problema nella visita; niente link senza assistente configurato.
- **Legale:** Anthropic fra i fornitori dell'aviso de privacidad e la clausola dell'assistente nei
  termini (bozze, `legal:sync` fatto).
- **Prova pagata:** script `packages/core/scripts/assistant-benchmark.ts` pronto (tetto 15 USD con
  riserva per il giudice, piante fuori dalla lista, domande per foto). Le foto arrivano da Commons
  con `thumb.php` a 960 px (le miniature di `upload.wikimedia.org` rispondono 400/429 se non sono
  in cache, `thumb.wikimedia.org` non è raggiungibile), lentamente per i 429 dell'IP condiviso.
  **Manca la chiave di Anthropic:** il modulo sicuro non accetta gli host di Anthropic; serve la
  variabile `ANTHROPIC_API_KEY` dell'environment (letta da una sessione nuova o dopo un riavvio).

Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · migrazioni = schema ✅ · test 1229/1229 ✅
(dominio: schemi, costi con e senza cache e con il fallback, prompt, pulizia delle risposte,
permesso; DB: dati di cura validi; adattatore con l'SDK finto: forma della richiesta, costo,
rifiuti ed errori; integrazione: caso e risposta, specie fuori dalle candidate, cura e tossicità
nostre, tetto del giorno, budget finito, errore non contato, staff ammesso, isolamento A↔B con la
sonda, foto del contratto del percorso, cancellazione a fine contratto + 30 giorni) · build ✅ ·
E2E dell'assistente ✅ (dalla pianta del contratto: foto → candidate → «Otra» → risposta con la
tossicità ASPCA → «Otra pregunta», contatore, card del contratto) · controllo a 320 px del caso e
del contratto: nessuno sbordo.

E2E completo in locale 115/115. CI verde su `0acc4cd` (run 239, E2E compreso) e rilascio su
staging con il via libera del founder (merge `cbdfa5c`): l'assistente resta spento finché su Vercel
non ci sono `ASSISTANT_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` e `ASSISTANT_MODEL`.

Prova pagata: la lancia il founder sul suo computer (25/11), con 6,56 USD di credito: script
`assistant:photos` per le foto (Commons, `thumb.php` a 960 px) e `assistant:benchmark` con tetto
predefinito 5 USD, giudice a effort medio e stop subito se la chiave o il credito non vanno.

Prova fatta dal founder (3,94 USD, `docs/AI_BENCHMARK.md`) e sue decisioni del 25/11 pomeriggio:
l'assistente è per i clienti della fioreria, con crediti che la fioreria compra da Gardelia; mix
dei modelli (foto e problemi Opus 5.5, cura Haiku 5.5); budget di piattaforma 2 USD fino a
dicembre, poi 10; niente 6c.

**Floral Care, blocco 6b (25/11, ADR-085): l'Asistente de plantas per i clienti, con i crediti
della fioreria.**

- **Dominio:** regole dei crediti (saldi calcolati, 1–500 per volta, riserva di 2 minuti), tipo di
  domanda «Cómo cuidarla» / «Tiene un problema» che sceglie il modello (`assistantAnswerModel`),
  proposta dalla foto (`assistantDefaultKind`), tetto di 10 foto e 10 risposte al giorno per
  contratto, prompt v2 (luce bassa corretta, «tú», ~70 parole e 4 passi, piante in terra, la riga
  del tipo); `care:assistant` solo a proprietario e gerente.
- **Database:** migrazioni `assistant_credits_enum` e `assistant_credits`:
  `AssistantCreditAllocation` (dati e resi, solo inserimenti) e `AssistantCreditHold` con RLS;
  `portal_read`/`portal_insert` sui propri casi, risposte e chiamate; DEFINER
  `app_portal_assistant_credits(since)`, `_reserve` (sotto lock del contratto, mai sotto zero),
  `_release`; `app_buyer_assistant_answers()` per «Descargar mis datos».
- **Core:** crediti della fioreria (`getAssistantCreditsPanel`, `getContractAssistantCredits`,
  `giveAssistantCredits` in fila con un lock per fioreria); servizi del portale
  (`my-plant-assistant.ts`: foto, risposta con riserva e resa, caso e foto della persona,
  «Enviar a la florería» e «Pedir (más) consultas» con `postMyCareMessage` e una chiave d'invio
  calcolata); ritorno dei crediti non usati a fine contratto (a mano e dal lavoro giornaliero);
  operazione di piattaforma `grant-ai-credits --feature plant-assistant` (workflow:
  `grant-assistant-credits`); due modelli dalla configurazione (`ASSISTANT_CARE_MODEL`).
- **Interfaccia:** card «Asistente de plantas» nel contratto (dati, usati, rimasti, «Dar
  créditos», avviso senza accesso al portale) e in Ajustes → Floral Care (comprati, dati,
  disponibili, «Comprar créditos por WhatsApp», nessun prezzo nel codice); in Mi Floral Care la
  sezione del contratto e la pagina `/cuenta/floral-care/[id]/asistente`; tolta la consulta del
  fiorista del 6a. Testi nelle tre lingue; crediti di prova nel seed della fioreria demo.
- **Legale (bozze):** aviso (foto e domande dei clienti, chi vede cosa), termini della fioreria
  (crediti, rivendita a suo carico, ritorno a fine servizio), termini per chi compra (risposte
  orientative), domande per l'avvocato; `legal:sync` fatto.

Verifiche locali: lint ✅ · format ✅ · typecheck ✅ · migrazioni = schema ✅ · test 1236/1236 ✅
(dominio: crediti, tipo e modello, prompt v2; RLS: solo i propri casi e risposte, crediti solo con
le funzioni, due riserve insieme sull'ultimo credito; integrazione: «Dar créditos» fino al saldo e
in fila, staff escluso, isolamento A↔B con la sonda, foto → risposta con il modello giusto, 1
credito solo se riesce, gara sull'ultimo credito, solo i propri casi, tetto del giorno per
contratto, rifiuti e budget senza crediti usati, «Enviar a la florería» una volta, «Pedir más
consultas» una volta al giorno, dati della persona, crediti resi a fine contratto a mano e dal
lavoro, foto cancellate dopo 30 giorni) · build ✅ · E2E completo 115/115 ✅ (dall'Ajustes ai
crediti dati, alla consulta del cliente, a «Enviar a la florería» e alla card della fioreria) ·
controllo a 320 px di Ajustes, del caso, del contratto del cliente e della card: nessuno sbordo.

CI verde su `a169c06` (run 245, E2E compreso) e rilascio su staging con il via libera del founder
(merge `5142e81`, CI run 246 verde): l'assistente resta spento finché su Vercel non ci sono le sue
variabili.

Prossimo: da parte del founder le variabili su Vercel (`ASSISTANT_PROVIDER=anthropic`, una chiave solo per staging,
`ASSISTANT_MODEL=claude-opus-5-5`, `ASSISTANT_CARE_MODEL=claude-haiku-5-5`,
`ASSISTANT_MONTHLY_BUDGET_USD=2`, 10 a dicembre), i crediti alla sua fioreria di prova con
l'operazione `grant-assistant-credits` e una consulta vera da un conto cliente invitato. Serve
ancora `~/gardelia-prova/manifest.json` per le fonti delle foto in `docs/AI_BENCHMARK.md`.

Ordine verso la V1 (dettagli e stato per area in `docs/V1_SCOPE.md`):

1. Resto della fase 0: **ambiente online di prova** (configurazione pronta, ADR-038: appena ci
   sono gli account); con gli account, deploy dalla CI e staging, Sentry e monitor, backup con
   prova di ripristino; scansione dei segreti e aggiornamenti automatici delle dipendenze;
   divisione dei file grandi insieme alle funzionalità che li toccano; immagini con URL firmati e
   caricamento diretto su R2 quando serviranno (Studio, immagini 2K).
2. Ordini, pagamenti registrati e consegne con calendario; link pubblici di preventivo (approvato)
   e ordine; aggiungere un disegno del Diseñador a un preventivo in bozza. Poi il marketplace per i
   clienti (D-26, deciso il 23/11: registrazione obbligatoria, pagamento diretto alla fioreria) e la
   ruta del día gratuita (D-27). Blocchi A1–C5 in `docs/ORDERS_MARKETPLACE_PLAN.md`; si parte da A1.
3. Inventario: fatto (blocchi 1–4, ADR-060…063), con lo scarico (ADR-071) e gli apartados
   (ADR-072) dagli ordini.
4. Clienti completi (ADR-070): fatto (cronologia, etichette e filtri, import da CSV).
5. Abbonamenti dei clienti e Floral Care: blocchi 1 (ADR-075), 2 (ADR-078), 3 (ADR-082), 4
   (ADR-083) e 5 (ADR-084) fatti; 6a e 6b (ADR-085) fatti e su staging; il 6c non si fa; il 7
   (consegne periodiche) in `docs/FLORAL_CARE_PLAN.md`.
6. Report: fatti (ADR-080); restano i P1 dello spec (funnel, retention, profitto per ramo).
   Catalogo completo (ADR-081): fatto; manca la revisione dell'elenco dei fiori da un fiorista.
7. Impostazioni della fioreria complete (logo, orari, consegne) ed email ai clienti e al team.
8. Abbonamento a pagamento sui livelli Esencial e Profesional (D-23; Stripe in modalità di prova) e
   pannello della piattaforma.
9. Privacy nell'app: pagine e diritti di chi compra fatti (ADR-068), eliminazione (ADR-074) ed
   esportazione dei dati della fioreria (ADR-079) fatte; mancano consensi se l'avvocato li chiede e testi definitivi.
10. Rifinitura generale; Diseñador con foto vere (contenitori, dimensione del ramo, copertina,
    "usa l'originale"); prova da ~100 immagini → prezzi dei pacchetti (ADR-024); prova con i tester.
    Contador: IVA e fatturazione (O-06, O-02). Poi il lancio.

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
