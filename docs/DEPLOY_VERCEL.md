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

| Servizio     | A cosa serve                          | Piano                                             |
| ------------ | ------------------------------------- | ------------------------------------------------- |
| Vercel       | ospita l'app                          | Hobby, accesso con GitHub                         |
| Neon         | database                              | Free                                              |
| Cloudflare   | archivio delle foto (R2)              | gratuito (serve una carta, ma 10 GB sono gratis)  |
| Resend       | email (conferma dell'account, inviti) | Free                                              |
| fal.ai       | immagini AI                           | credito prepagato (es. 10 USD)                    |
| Google Cloud | ricerca degli indirizzi (facoltativa) | a consumo, con quota gratuita mensile (sezione 9) |

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
4. **Dominio verificato (per scrivere a tutti, anche ai clienti delle fiorerie: ADR-047):** con
   l'indirizzo di prova le email arrivano solo al titolare dell'account Resend. Quando hai il
   dominio:
   - su Resend, **Domains** → **Add domain** (il dominio o un sottodominio, es. `mail.` più il
     tuo dominio);
   - copia i record DNS che Resend mostra (SPF, DKIM e, consigliato, DMARC) nel pannello DNS di
     chi ti ha venduto il dominio, poi aspetta che Resend lo dia per verificato;
   - su Vercel cambia `EMAIL_FROM` in `Gardelia <no-reply@il-tuo-dominio>` e rifai il deploy.
     La chiave e `SMTP_URL` restano le stesse.

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
   | `GOOGLE_MAPS_API_KEY`                                                    | facoltativa, sezione 9 (si può aggiungere anche dopo)        |
   | `PLATFORM_WHATSAPP`                                                      | facoltativa: il tuo WhatsApp col prefisso, es. `+39 3…`      |

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
   tutti i controlli verdi; `prod` si muove solo con il via libera del founder (ADR-041). I rami
   di lavoro (`claude/…`) non creano deploy (`apps/web/vercel.json`).
   **Sul piano Hobby** Vercel pubblica solo i commit fatti dal titolare dell'account: quelli di
   Claude vengono ignorati senza avvisi, e da quest'anno anche i Deploy Hook. Per questo ogni
   rilascio su `staging` è un commit di rilascio (merge del ramo di lavoro già verificato dalla
   CI) firmato con l'account GitHub del founder, che ha dato il consenso il 22/11/2026 (ADR-041).
   Un deploy si può sempre avviare anche a mano: **Deployments → ⋯ → Create Deployment** →
   `staging`.

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
6. **Dati di prova (facoltativo):** per provare con un negozio pieno: 23 clienti con le loro date
   nel calendario, 13 fiori, 2 verdi, 2 carte e 1 nastro, con la foto di ogni fiore (ADR-049).
   - Per le foto salva su GitHub (come al punto 2) altri cinque segreti: `FAL_KEY`,
     `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. I valori sono gli
     stessi di Vercel (nella tua nota privata). Se non li hai più, crea chiavi nuove solo per
     GitHub: su fal una chiave `gardelia-github` (scope API); su R2 un token "Object Read & Write"
     solo per `gardelia-staging` (account e bucket restano gli stessi). Così si revocano senza toccare Vercel. Senza questi segreti
     l'operazione aggiunge tutto tranne le foto.
   - Lo stesso workflow, operazione `test-data`, la tua email, l'indirizzo della fioreria, con
     "Genera le foto" spuntato. Sono 15 foto, circa 1,20 USD di fal; lo scontorno parte subito.
   - Si può rilanciare: aggiunge solo quello che manca e non rifà le foto. Clienti e prodotti di
     prova hanno l'etichetta `prueba` e i codici `PRB-…`, e si archiviano come gli altri.
   - Fra i clienti c'è "Cliente de prueba (tú)", con la tua email e il compleanno fra 3 giorni: se
     attivi la promo, la mattina dopo ti arriva l'email vera con il codice. Gli altri clienti hanno
     email inventate (`@example.com`) e nessun consenso, quindi la promo non scrive a loro.
   - Funziona solo su una fioreria di cui sei proprietario o manager.
7. **Far entrare un tester senza dominio email (ADR-050):** finché il dominio non è verificato, le
   email di conferma arrivano solo a te.
   - La persona si registra sul sito con la sua email e la sua password (l'email non le arriverà:
     va bene così).
   - Lo stesso workflow, operazione `confirm-user`, la tua email e in "Email della persona" la sua.
     Lascia vuoto l'indirizzo della fioreria se deve crearne una sua: al primo accesso l'app gliela
     fa creare. Se invece deve entrare nella tua, scrivi l'indirizzo e scegli il ruolo (manager o
     staff).
   - Poi entra con la sua password. Conferma solo persone che conosci.

## 9. Ricerca degli indirizzi (Google Places, facoltativa)

Con la chiave, nei form degli indirizzi (clienti, pedidos, tienda) compare **"Buscar dirección"**:
si scrive l'inizio dell'indirizzo, si sceglie un suggerimento e i campi si compilano da soli. Le
coordinate servono a ordinare la **Ruta del día** per vicinanza (ADR-059). Senza chiave tutto
funziona lo stesso, a mano.

1. **Progetto su Google Cloud:** su [console.cloud.google.com](https://console.cloud.google.com),
   in alto **Select a project → New project**, nome `gardelia-staging`. Serve un account di
   fatturazione con una carta (**Billing**): Google lo chiede anche se si resta nella quota
   gratuita.
2. **Attiva solo l'API giusta:** **APIs & Services → Library**, cerca **Places API (New)** →
   **Enable**. Non serve nient'altro (niente Maps JavaScript API: la mappa la apre Google Maps).
3. **Crea la chiave:** **APIs & Services → Credentials → Create credentials → API key**. Poi
   **Edit API key**:
   - **API restrictions → Restrict key** → spunta solo **Places API (New)** → **Save**;
   - **Application restrictions:** lascia **None**. La chiave la usa solo il server dell'app
     (mai il browser) e i server di Vercel non hanno un indirizzo fisso da indicare.
4. **Metti un tetto alle richieste:** dal menu **Google Maps Platform → Quotas**, scegli
   **Places API (New)**, spunta i limiti **al giorno** ("per day") dell'autocompletamento e dei
   dettagli e con **Edit quotas** mettili bassi (es. 300 ciascuno per lo staging). Oltre il limite la ricerca si ferma per quel giorno e gli indirizzi si scrivono a
   mano: nessun costo a sorpresa.
5. **Avviso di spesa:** **Billing → Budgets & alerts → Create budget**, 10 USD con l'email
   d'avviso. È solo un avviso (il tetto vero è il punto 4).
6. **Su Vercel:** **Settings → Environment Variables**, aggiungi `GOOGLE_MAPS_API_KEY` con la
   chiave (ambiente "Production"), poi **Deployments → ⋯ → Redeploy**. In locale va nel tuo file
   `.env`, mai nel repository.

**Costi (listino di Google dal 1° marzo 2025, da ricontrollare sul loro sito):** ogni ricerca
completata costa una "Place Details Essentials", con circa 10.000 gratuite al mese per tutta la
piattaforma; i suggerimenti mostrati mentre si scrive non si pagano quando la ricerca finisce con
un indirizzo scelto. Con i volumi di una fioreria si resta di solito nella quota gratuita.

**Regole di Google già rispettate dal codice:** sotto i suggerimenti c'è la scritta "Google Maps";
le coordinate si tengono al massimo 30 giorni e poi si cancellano ogni notte (il place ID si può
tenere); la chiave non arriva mai al browser.

## 10. Se qualcosa non va

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

## 11. Più avanti

- **Entrano i tester:** Vercel Pro (20 USD/mese, regole d'uso commerciale) e una whitelist delle
  email che possono registrarsi.
- **Prima del lancio:**
  - piano Neon a pagamento (backup e ripristino più lunghi);
  - dominio Gardelia verificato su Resend, così le email partono a tutti;
  - progetto `gardelia-production` (database e chiavi propri) che pubblica il ramo `prod`;
  - Sentry;
  - client OAuth di Google (ADR-036).
