# Ambiente online di prova su Vercel — guida passo passo

Per il founder. Risultato: Gardelia online su un indirizzo `https://gardelia-staging.vercel.app`, da
provare dal telefono, con il Diseñador e l'AI vera. Costo: **0 USD al mese** di piattaforma con i
piani gratuiti, più l'AI a consumo (pochi dollari di prove). Decisioni: `docs/DECISIONS.md`
(P-03, O-04), piano: `docs/PLATFORM_PLAN.md`.

> **Regola d'oro:** chiavi, password e indirizzi di connessione al database **non vanno mai in
> chat, in email o nel repository**. Si incollano solo nelle impostazioni dei servizi (Vercel,
> GitHub). Se una chiave finisce per sbaglio in un messaggio, si rigenera.

Tempo: circa un'ora la prima volta.

Nomi dei servizi in inglese (decisione del founder, 22/11/2026): questo ambiente si chiama
`gardelia-staging` ovunque (progetto Neon, bucket R2, progetto Vercel). Al lancio la produzione
avrà nomi propri (`gardelia-production`).

## 1. Account da creare (tutti gratuiti, a tuo nome)

| Servizio   | A cosa serve                          | Piano                                            |
| ---------- | ------------------------------------- | ------------------------------------------------ |
| Vercel     | ospita l'app                          | Hobby, accesso con GitHub                        |
| Neon       | database                              | Free                                             |
| Cloudflare | archivio delle foto (R2)              | gratuito (serve una carta, ma 10 GB sono gratis) |
| Resend     | email (conferma dell'account, inviti) | Free                                             |
| fal.ai     | immagini AI                           | credito prepagato (es. 10 USD)                   |

## 2. Database (Neon)

1. **Crea il progetto:** nome `gardelia-staging`, Postgres **16**, regione **AWS US East
   (N. Virginia)**.
2. **Copia l'URL del proprietario:** nella pagina del progetto apri **Connect**, scegli il ruolo
   `neondb_owner` e **disattiva** "Connection pooling". Copia l'indirizzo: è
   **`DATABASE_MIGRATION_URL`** (lo userà Vercel per aggiornare il database a ogni rilascio).
3. **Genera una password lunga** per il ruolo dell'app (sezione 6, "Come generare un segreto").
4. **Crea il ruolo dell'app:**
   - apri **SQL Editor**;
   - incolla il contenuto di `packages/db/scripts/setup-hosted-db.sql`;
   - sostituisci `SOSTITUISCI-CON-LA-PASSWORD-GENERATA` con la password del punto 3;
   - esegui. La password non salvarla in nessun file.
5. **Componi `DATABASE_URL`:**
   - torna in **Connect** e **attiva** "Connection pooling";
   - copia l'indirizzo;
   - sostituisci utente e password con `gardelia_app` e la password del punto 3:
     `postgresql://gardelia_app:<password>@<host-con-pooler>/neondb?sslmode=require`
   - è **`DATABASE_URL`**. Se per sbaglio usi l'URL del proprietario, l'app si rifiuta di
     partire: protegge la separazione fra fiorerie.

## 3. Archivio delle foto (Cloudflare R2)

1. **Attiva R2:** menu a sinistra → **R2 Object Storage**. La prima volta Cloudflare chiede una
   carta o PayPal: è una verifica, il piano gratuito (10 GB, solo classe "Standard") per le prove
   non costa nulla. Se all'iscrizione chiede di aggiungere un dominio, salta: non serve.
2. **Crea il bucket:** **Create bucket**, nome `gardelia-staging`:
   - **Location:** "Automatic" e poi **Provide a location hint** → "Eastern North America
     (ENAM)". Senza suggerimento Cloudflare mette il bucket vicino a chi lo crea (dall'Italia: in
     Europa), lontano dall'app (Vercel `iad1`, Washington) e dal database (Neon, Virginia). La
     posizione non si cambia più;
   - **niente "Specify jurisdiction"** (né EU né US): l'app usa l'indirizzo standard di R2
     (`<account-id>.r2.cloudflarestorage.com`) e la giurisdizione non si cambia più;
   - **Default storage class:** "Standard" (il piano gratuito vale solo per questa);
   - accesso pubblico spento: le foto le consegna l'app, solo a chi ha i permessi.
3. **Crea il token:** nella pagina di R2 → **Manage API tokens** → **Create Account API token**:
   - nome `gardelia-staging`, permesso **Object Read & Write**;
   - **Apply to specific buckets only** → `gardelia-staging`;
   - TTL "Forever", nessun filtro IP (Vercel non ha indirizzi fissi).
4. **Annota quattro valori:**
   - `R2_ACCESS_KEY_ID` (Access Key ID) e `R2_SECRET_ACCESS_KEY` (Secret Access Key): si vedono
     **una volta sola**. Se chiudi la pagina prima di copiarli, cancella il token e creane un
     altro. Il "Token value" non serve;
   - `R2_ACCOUNT_ID`: l'Account ID, nella pagina di R2 (è anche la parte fra `https://` e
     `.r2.cloudflarestorage.com` nell'indirizzo mostrato insieme alle chiavi);
   - `R2_BUCKET`: `gardelia-staging`.

## 4. Email (Resend)

1. **Account:** registrati con l'email che userai anche per entrare nell'app. Finché non
   verifichiamo il dominio, Resend consegna **solo a quell'indirizzo** (per le prove basta). Se
   chiede di aggiungere un dominio, salta.
2. **Crea una chiave:** **API Keys** → **Create API Key**, nome `gardelia-staging`, permesso
   "Sending access", dominio "All domains". La chiave (inizia con `re_`) si vede una volta sola.
3. **Prepara le due variabili:**
   - `SMTP_URL` = `smtps://resend:<la-chiave>@smtp.resend.com:465` (la chiave intera, `re_`
     compreso);
   - `EMAIL_FROM` = `Gardelia <onboarding@resend.dev>` (indirizzo di prova di Resend: con il
     dominio Gardelia verificato useremo il nostro).

## 5. Immagini AI (fal.ai)

1. **Crea una chiave solo per questo ambiente:** **Keys** → **Add key**, nome `gardelia-staging`,
   scope **API** (non "ADMIN"). Si vede una volta sola: copiala **intera**, sono due pezzi separati
   da `:`. È `FAL_KEY`. Separata dalle chiavi delle prove, si revoca senza toccare il resto.
2. **Ricarica il credito:** **Billing**, ricarica pochi dollari (es. 10 USD), senza ricarica
   automatica. Ogni foto realistica costa circa 0,08–0,10 USD. Il tetto mensile dell'app
   (`AI_MONTHLY_BUDGET_USD`) protegge comunque la spesa.

## 6. Tre segreti da generare

Servono tre stringhe casuali, tutte diverse: la password del database (sezione 2),
`BETTER_AUTH_SECRET` e `CRON_SECRET`.

**Come generare un segreto** (64 caratteri fra `0-9` e `a-f`: vanno bene anche dentro l'indirizzo
del database, senza caratteri da "tradurre"):

- **Su Mac**, nel Terminale: `openssl rand -hex 32`
- **In qualsiasi browser:** apri la console degli strumenti per sviluppatori e scrivi
  `Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')`

Ogni esecuzione dà un segreto nuovo: generane uno per ogni uso.

Niente password con simboli (`?`, `@`, `#`, `/`, `:`…) per il database: dentro l'indirizzo lo
rompono ("Invalid URL", l'app non si collega e la build si ferma). Per cambiare la password del
ruolo dell'app: **SQL Editor** di Neon, `ALTER ROLE gardelia_app WITH PASSWORD '<nuova>';`, poi
ricomponi `DATABASE_URL`.

## 7. Progetto su Vercel

1. **Prima, su GitHub:** l'ambiente di prova pubblica il ramo **`staging`** (ADR-041). Nel
   repository **Settings → General → Default branch** → `staging` → **Update**: così Vercel lo
   prende da solo all'import. I rami di lavoro (`claude/…`) e `prod` qui non vanno online.
2. **Importa il repository:** accedi con GitHub, **Add New → Project**, importa
   `leviuzz/gardelia` e chiama il progetto `gardelia-staging` (Vercel propone `gardelia`:
   cambialo; l'indirizzo diventa `https://gardelia-staging.vercel.app`). L'indirizzo senza
   suffisso resta per la produzione. Se il repository non compare, dai a Vercel l'accesso
   solo a `leviuzz/gardelia` dalle impostazioni della GitHub App che propone.
3. **Root Directory:** **Edit** → `apps/web` (la cartella dell'app nel repository, non un ramo);
   il Framework Preset diventa Next.js da solo. Framework, build, cron, regione e versione di Node
   (22) li decide il repository (`apps/web/vercel.json` e `apps/web/package.json`): non cambiarli.
4. **Environment Variables:** il modo più rapido è preparare nella nota privata un blocco
   `NOME=valore`, una riga per variabile della tabella, e incollarlo tutto nel primo campo
   **Key**: Vercel crea una riga per variabile. Regole del blocco:
   - niente spazi attorno a `=` e niente virgolette (anche `EMAIL_FROM` si scrive così com'è);
   - se un indirizzo del database finisce con `&channel_binding=require`, togli quel pezzo;
   - servono almeno in "Production": se l'import le mette anche in "Preview" e "Development" va
     bene, le anteprime per ramo non le usiamo ancora.

   | Variabile                                                                | Valore                                                       |
   | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
   | `APP_URL`                                                                | `https://gardelia-staging.vercel.app` (vedi il punto 6)      |
   | `BETTER_AUTH_URL`                                                        | uguale ad `APP_URL`                                          |
   | `BETTER_AUTH_SECRET`                                                     | segreto generato (sezione 6)                                 |
   | `DATABASE_URL`                                                           | sezione 2, punto 5                                           |
   | `DATABASE_MIGRATION_URL`                                                 | sezione 2, punto 2                                           |
   | `SMTP_URL`, `EMAIL_FROM`                                                 | sezione 4                                                    |
   | `STORAGE_DRIVER`                                                         | `r2`                                                         |
   | `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | sezione 3                                                    |
   | `AI_PROVIDER`                                                            | `fal`                                                        |
   | `FAL_KEY`                                                                | sezione 5                                                    |
   | `AI_MONTHLY_BUDGET_USD`                                                  | per esempio `10`                                             |
   | `CRON_SECRET`                                                            | segreto generato (sezione 6), diverso dagli altri            |
   | `ENABLE_EXPERIMENTAL_COREPACK`                                           | `1` (la build usa la stessa versione di pnpm del repository) |

   Elenco completo e regole: `docs/CONFIGURATION.md`.

5. **Deploy.** La prima build prepara il database (migrazioni e dati di riferimento, come la
   tassonomia dei fiori), poi compila l'app.
6. **Controlla:**
   - in **Settings → Domains** c'è l'indirizzo vero. Se è diverso da `APP_URL`, correggi
     `APP_URL` e `BETTER_AUTH_URL` e ridistribuisci (**Deployments → ⋯ → Redeploy**). Se il
     progetto è nato come `gardelia` (indirizzo `gardelia.vercel.app`): rinominalo in
     `gardelia-staging` (**Settings → General**), aggiungi il dominio
     `gardelia-staging.vercel.app` e su `gardelia.vercel.app` metti un rimando **307
     (temporaneo)** verso di esso: l'indirizzo resta nostro per la produzione (un 308 i browser lo
     ricorderebbero per sempre);
   - il deploy deve venire dal ramo `staging`. Se viene da un altro (progetto importato prima di
     cambiare il ramo predefinito): **Settings → Environments → Production** → ramo `staging`, poi
     ridistribuisci;
   - apri `<indirizzo>/api/health`: deve rispondere `{"status":"ok"}`.
7. **Aggiornamenti:** ogni push su `staging` va online da solo. Ci arriva un blocco finito con
   tutti i controlli verdi; `prod` si muove solo con il via libera del founder (ADR-041). Vercel
   costruisce solo il ramo di produzione del progetto: i push sugli altri rami non creano deploy.
   **Sul piano Hobby** Vercel avvia da solo solo i deploy dei commit fatti dal titolare
   dell'account: quelli di Claude vengono ignorati senza avvisi. Per questo serve un **Deploy
   Hook**, creato una volta dal titolare:
   - Vercel → **Settings → Git → Deploy Hooks**: nome `staging`, ramo `staging` → **Create
     Hook**; copia l'indirizzo (è una chiave: mai in chat);
   - GitHub → **Settings → Secrets and variables → Actions → New repository secret**:
     `VERCEL_DEPLOY_HOOK_STAGING` = quell'indirizzo.

   Da lì il workflow "Deploy staging" (`.github/workflows/deploy-staging.yml`) avvia il deploy a
   ogni push su `staging`. Senza segreto il workflow avvisa e non fa nulla; un deploy si può
   sempre avviare a mano: **Deployments → ⋯ → Create Deployment** → `staging`.

Se qualcosa manca o è sbagliato, l'app non parte e i log di Vercel (**Logs**) elencano le
variabili da sistemare.

## 8. Il tuo account e il piano Plus

1. **Registrati e crea la fioreria:** apri l'app, registrati con **la stessa email del tuo account
   Resend**, conferma l'email e crea la tua fioreria. L'indirizzo diventa
   `/app/<indirizzo-della-fioreria>`: annota la parte dopo `/app/`.
2. **Salva il segreto su GitHub:** nel repository, **Settings → Secrets and variables → Actions
   → New repository secret**, nome `PLATFORM_DATABASE_URL`, valore uguale a `DATABASE_URL`.
3. **Diventa amministratore della piattaforma:** su GitHub **Actions → Operazioni di
   piattaforma → Run workflow**, operazione `bootstrap-admin`, la tua email. Funziona una volta
   sola.
4. **Attiva il piano Plus:** lo stesso workflow, operazione `assign-plan`, la tua email,
   l'indirizzo della fioreria, piano `PLUS`, stato `PILOT`.
5. **Prova il Diseñador:** aggiungi le foto dei fiori (scontorno automatico), crea un ramo e genera
   la foto realistica.

## 9. Se qualcosa non va

- **"Internal Server Error" su ogni pagina:** l'app non è partita. In **Logs** cerca
  "Configurazione non valida": elenca le variabili da sistemare (nome e regola, mai il valore).
  Correggile in **Settings → Environment Variables** e ridistribuisci. Un segreto troppo corto si
  rigenera con il metodo della sezione 6 (solo `0-9` e `a-f`).
- **Registrazione o login: "No pudimos completar la operación"** e nella rete del browser
  `Invalid origin`: `APP_URL` e `BETTER_AUTH_URL` non sono l'indirizzo da cui apri l'app.
  Mettili uguali all'indirizzo vero (`https://…`, senza `/` finale) e ridistribuisci: le
  variabili nuove valgono solo dal deploy successivo.
- **Errore nell'app:** la pagina mostra un "Referencia". Su Vercel, in **Logs**, cerca quel codice:
  trovi la riga con l'errore. Mandami il codice, mai le chiavi.
- **Le immagini AI non arrivano:** controlla `FAL_KEY`, il credito su fal e `CRON_SECRET`. Si
  sbloccano anche riaprendo la pagina del ramo.
- **Le email non arrivano:** con `onboarding@resend.dev` arrivano solo al tuo indirizzo di Resend;
  guarda anche lo spam.
- **La prima apertura dopo una pausa è più lenta** (circa un secondo): il database gratuito si
  spegne quando nessuno lo usa e si riaccende da solo. È normale.

## 10. Più avanti

- **Entrano i tester:** Vercel Pro (20 USD/mese, regole d'uso commerciale) e una whitelist delle
  email che possono registrarsi.
- **Prima del lancio:**
  - piano Neon a pagamento (backup e ripristino più lunghi);
  - dominio Gardelia verificato su Resend, così le email partono a tutti;
  - progetto `gardelia-production` (database e chiavi propri) che pubblica il ramo `prod`;
  - Sentry;
  - client OAuth di Google (ADR-036).
