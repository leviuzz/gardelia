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

**Pulsanti attivi solo quando funzionano (fatto il 22/11):** "Continuar con Google", uscita e i
moduli di accesso restano disattivati finché la pagina non ha caricato il JavaScript; i moduli
gestiti solo in JavaScript inviano in POST (prima, un invio anticipato metteva email e password
nell'indirizzo). Un test delle convenzioni lo impone ai moduli nuovi.

**Test E2E instabile da chiarire:** in CI, 2 esecuzioni su circa 10, il ritorno dal Google simulato
(`google-login.spec.ts`) a volte non risponde entro 10 s, senza errori nel log; in locale non si
riproduce (4 esecuzioni complete, anche con un solo thread di servizio). Il server dei test ora
registra i tempi del ritorno, i blocchi dell'event loop e i thread di servizio occupati
(`e2e/support/google-oauth-mock.mjs`): al prossimo fallimento il log dirà dove si ferma.

**Fase 0, sicurezza delle dipendenze (fatto il 22/11):** Better Auth all'ultima versione stabile
(1.7.27). L'avviso alto su `effect` 3.20.0 (ReDoS, GHSA-7589-6fvf-x4pw), arrivato tramite
`prisma` → `@prisma/config`, è chiuso con un override pnpm a ≥ 3.22.1 (`pnpm-workspace.yaml`);
`pnpm audit --prod` non trova vulnerabilità; `prisma generate`, migrazioni e 329 test verdi. Da
togliere quando Prisma aggiornerà la dipendenza.

Ordine verso la V1 (dettagli e stato per area in `docs/V1_SCOPE.md`):

1. Resto della fase 0: **ambiente online di prova** (configurazione pronta, ADR-038: appena ci
   sono gli account); con gli account, deploy dalla CI e staging, Sentry e monitor, backup con
   prova di ripristino; scansione dei segreti e aggiornamenti automatici delle dipendenze;
   divisione dei file grandi insieme alle funzionalità che li toccano; immagini con URL firmati e
   caricamento diretto su R2 quando serviranno (Studio, immagini 2K).
2. Ordini, pagamenti registrati e consegne con calendario; link pubblici di preventivo (approvato)
   e ordine; aggiungere un disegno del Diseñador a un preventivo in bozza.
3. Inventario.
4. Clienti completi: cronologia, etichette, import CSV.
5. Abbonamenti dei clienti e Floral Care.
6. Report.
7. Impostazioni della fioreria complete (logo, orari, consegne) ed email ai clienti e al team.
8. Abbonamento a pagamento (Stripe in modalità di prova) e pannello della piattaforma.
9. Privacy nell'app: pagine, consensi, esportazione e cancellazione dei dati.
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
