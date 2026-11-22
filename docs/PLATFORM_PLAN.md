# Piano di piattaforma — ambienti, stack, architettura del codice

**Stato: PROPOSTO (21/11/2026), da approvare dal founder.** Nessuna voce di questo documento è
una decisione finché non è confermata e riportata in `docs/DECISIONS.md`.

**Revisione del 21/11/2026 (sera).** Il founder chiede di non risparmiare sull'infrastruttura:
avremo molte fiorerie e un uso intenso di AI (Bouquet Builder e Flora Studio). Rivalutato
l'hosting con questo criterio: la raccomandazione passa da Render a **Vercel + Neon**
(sezione 3). Il costo cambia di poco. Con molte fiorerie la spesa che cresce davvero è quella
dell'AI, già controllata da crediti e tetti.

Obiettivo: passare da "funziona sul nostro computer" a un software che una fioreria vera può
usare ogni giorno, con ambienti separati, rilasci controllati, errori visibili e dati protetti.
Molte cose si fanno subito (le fondamenta); altre vanno in roadmap (notifiche push, Sentry,
pagamenti…), ma l'architettura le prevede già.

---

## 0. In breve

| Tema          | Proposta                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Ambienti      | **locale** (sviluppo) → **anteprima per ogni PR** (con il suo database) → **staging** (dati finti) → **produzione**       |
| App e job AI  | **Vercel (Pro)**: app Next.js + job AI in una funzione dedicata (coda Postgres, avvio immediato + controllo ogni minuto)  |
| Database      | **Neon** (Postgres gestito): RLS come oggi, ripristino a un istante (7 giorni), un branch del database per ogni anteprima |
| File          | **Cloudflare R2** (già pronto nel codice): un bucket privato per ambiente                                                 |
| Email         | **Resend** con dominio verificato (SPF/DKIM/DMARC)                                                                        |
| Login         | **Better Auth** (già nel codice, dati nel nostro DB): 2FA per i proprietari nella fase 1                                  |
| AI            | **fal.ai** (già nel codice), con tetto di spesa per ambiente                                                              |
| Errori e log  | log JSON (già), raccolta log e monitor di disponibilità subito; **Sentry** nella fase 1                                   |
| Costo stimato | **≈ 60–170 USD/mese** per staging + produzione all'inizio, più l'AI a consumo                                             |
| Regione       | Stati Uniti est: Vercel `iad1` (Washington) + Neon `us-east-1` (Virginia), vicini fra loro; nessuno dei due è in Messico  |

Il codice parte già da una base solida (dominio → database → servizi → web, RLS, test a tre
livelli). Il lavoro vero è: **portare i job AI su funzioni** (la coda resta in Postgres),
**mettere in piedi anteprime, staging e produzione con rilasci automatici**, **uniformare
gestione errori e componenti**, **monitorare**.

---

## 1. Principi

1. **Pochi servizi, gestiti da altri.** Siamo un team piccolo: niente server da amministrare,
   niente Kubernetes. Piattaforme gestite, con backup e aggiornamenti inclusi.
2. **Niente lock-in pesante.** Next.js standard (si costruisce anche come container), Postgres
   standard, storage S3, coda dei job AI nel nostro database: si può cambiare fornitore senza
   riscrivere il codice. Le funzioni proprie di una piattaforma restano in adattatori sottili.
3. **Staging uguale alla produzione**, ma con dati finti: ogni rilascio passa prima da lì.
4. **Sicurezza di default:** RLS nel database, segreti solo nelle variabili della piattaforma,
   ruoli minimi, 2FA su tutti gli account dei fornitori.
5. **Tutto ciò che si ripete si automatizza** (test, rilasci, migrazioni); **tutto ciò che si
   rompe si vede** (log, allarmi, errori con codice di riferimento).
6. **Scrivere le decisioni** (ADR) e tenere il piano aggiornato, come già facciamo.

---

## 2. Ambienti

| Ambiente         | Scopo                                       | Dati                            | AI                                    | Email                                     | Deploy                            |
| ---------------- | ------------------------------------------- | ------------------------------- | ------------------------------------- | ----------------------------------------- | --------------------------------- |
| **Locale**       | sviluppo e test                             | Postgres in Docker, seed demo   | simulata (o fal con chiave)           | Mailpit (nessuna email esce)              | a mano                            |
| **Anteprima PR** | provare una modifica prima di unirla        | branch Neon proprio, seed demo  | simulata                              | catturata, nessun invio reale             | automatico a ogni PR (Vercel)     |
| **Staging**      | prova completa prima della produzione; demo | **solo dati finti** (seed demo) | fal con tetto basso (es. 10 USD/mese) | solo verso indirizzi del team (allowlist) | automatico a ogni merge su `main` |
| **Produzione**   | fiorerie vere                               | reali, con backup e ripristino  | fal con tetto mensile                 | reale, dominio verificato                 | manuale (rilascio approvato)      |

Su Vercel lo staging è un **ambiente personalizzato** (uno è incluso nel piano Pro per progetto),
con dominio, variabili e database propri. Le anteprime sono automatiche: ogni PR ha un URL e,
tramite l'integrazione Neon, un branch del database creato all'apertura e cancellato alla chiusura.

Regole:

- **Mai dati reali fuori dalla produzione.** Staging non è una copia della produzione: ha il suo
  database con il seed demo (il seed rifiuta già di girare con `NODE_ENV=production`).
- Ogni ambiente ha **il proprio** database, bucket R2, chiavi, dominio
  (es. `staging.<dominio>` e `app.<dominio>`), mittente email e tetto di spesa AI.
- Il provider AI simulato è ammesso solo in locale/anteprima (l'app già rifiuta di avviarsi
  con il simulato su un URL pubblico).

---

## 3. Stack e hosting

### Opzione consigliata (A): Vercel + Neon + Cloudflare R2 + Resend

Rivalutata il 21/11/2026 su richiesta del founder ("non risparmiamo: avremo molte fiorerie e
molto uso di AI"). Il criterio non è più il costo minimo ma la piattaforma migliore per il
nostro codice. Vercel è la piattaforma di chi sviluppa Next.js; rispetto a Render guadagniamo:

- **Anteprima per ogni PR** con il suo URL e, tramite l'integrazione Neon, **il suo database**
  (branch copia-su-scrittura con migrazioni e seed demo, cancellato con la PR).
- **Rollback istantaneo** al deploy precedente, senza ricostruire nulla.
- **Skew Protection** (Pro, attiva di default sui progetti nuovi): durante un rilascio chi ha la
  pagina aperta continua a parlare con la versione vecchia. Conta molto con le nostre 38 server
  action, che altrimenti fallirebbero per qualche minuto dopo ogni rilascio.
- **Scala da solo** nei picchi delle fiorerie (14 febbraio, 10 maggio, 2 novembre, 12 dicembre)
  senza dimensionare server in anticipo.
- Firewall, protezione DDoS e regole di rate limit inclusi; CDN per i file statici.
- Staging come ambiente personalizzato, con dominio e variabili propri.

Il resto dello stack non cambia: **Neon** (attenzione già verificata: i ruoli creati dalla
console hanno `BYPASSRLS`, il ruolo dell'app va creato **in SQL** senza quel privilegio),
**Cloudflare R2** (nessun costo di uscita dati, 10 GB al mese gratis), **Resend** (3.000 email al
mese gratis, 20 USD/mese per 50.000), **Better Auth**, **Sentry** nella fase 1 (5.000 errori al
mese gratis).

**Cosa cambia nel nostro codice** (lavori della fase 0, utili anche fuori da Vercel):

1. **Job AI.** Su Vercel non c'è un processo sempre acceso. La coda resta in Postgres: stati,
   crediti, tentativi e lease sono già scritti e testati, e restano la fonte di verità. A
   svuotarla è una **funzione dedicata** (es. `/api/internal/ai/drain`, protetta da un segreto,
   fino a 800 secondi per invocazione), avviata subito dopo l'accodamento e ogni minuto da un cron
   di sicurezza che riprende i job rimasti a metà. Un **limite globale di job in parallelo** nel
   claim SQL rispetta il limite di fal (10 richieste contemporanee). La funzione è separata dalle
   pagine, quindi un picco di AI non rallenta il sito. In locale (e in un eventuale container) resta
   il worker nel processo: un'opzione di configurazione sceglie il "motore".
2. **Limite di 4,5 MB per richiesta e per risposta delle funzioni.** Oggi siamo ben sotto
   (misurato il 22/11): foto caricate 0,3–1,5 MB (ridotte nel browser a ≤ 2048 px, una per
   richiesta), immagine AI ~0,1 MB (JPEG 1K), foto senza fondo ~0,4–0,5 MB, boceto ~0,9 MB (la più
   grande). Rischi: (a) se il browser non riesce a ridurre una foto invia l'originale, fino a 8 MB
   accettati dal server → oltre 4,5 MB Vercel la rifiuta con un errore poco chiaro; (b) in futuro
   Flora Studio (foto di ambienti), immagini AI 2K/4K e video superano il limite. Soluzione, da fare
   nel blocco Vercel: le immagini si servono con URL firmati di R2 a breve scadenza, dopo il
   controllo di permessi e fioreria (i byte non passano dalla funzione: più veloce e meno costoso);
   caricamento diretto su R2 con permesso temporaneo per i file grandi; limite del server a 4 MB con
   un messaggio chiaro. Su Render il limite non c'è, ma gli URL firmati restano il modo corretto di
   servire file grandi.
3. **Database.** L'app usa l'URL con pool di Neon (PgBouncer), le migrazioni l'URL diretto. Il
   contesto RLS usa già `set_config(..., true)` dentro la transazione, compatibile con il pool. I
   limiti di tentativi del login sono già salvati nel database, quindi valgono anche con molte
   istanze. L'integrazione Neon inserisce in automatico l'URL del ruolo proprietario: si usa solo
   per le migrazioni, e il controllo all'avvio già blocca un ruolo che aggira la RLS.
4. **Log.** Il piano Pro conserva i log per 1 giorno, quindi servono un drain verso un servizio di
   log oppure Observability Plus (30 giorni).
5. **Cron.** I cron classici di Vercel girano solo in produzione. Per lo staging si usano le
   nuove Schedules per ambiente, più l'avvio immediato dopo l'accodamento.

**Job lunghi in futuro** (Flora Studio, video P2): le richieste a fal vanno in coda con webhook.
Se servirà, si aggiunge **Vercel Workflows** (disponibile da aprile 2026) o **Vercel Daemons**
(processi sempre accesi; oggi in beta, solo in produzione e senza autoscaling). Il core resta
indipendente dalla piattaforma: cambia solo chi chiama "svuota la coda".

### Alternative valutate

- **(B) Render + Neon** (prima raccomandazione): web, worker e cron come processi sempre accesi
  su una sola piattaforma, prezzo fisso per istanza, nessun limite di durata dei job. Per Next.js
  è meno adatto: niente Skew Protection, cache da condividere a mano fra più istanze, rollback
  più lenti, capacità da pianificare prima dei picchi. Resta il **piano di riserva**: l'app si
  costruisce anche come container.
- **(C) Google Cloud in Messico (Querétaro, `northamerica-south1`):** Cloud Run è disponibile nella
  regione; dati in Messico e latenza minima. Molto più lavoro di gestione (permessi, rete,
  Terraform). Da considerare **dopo**, se clienti grandi o la normativa chiederanno i dati in
  Messico: grazie a Postgres e storage standard la migrazione resta possibile.
- **Railway:** simile a Render (ambienti, anteprime per PR), piano Pro da 20 USD/mese a consumo.

### Database: perché Neon e non Supabase (21/11/2026)

Supabase è un'ottima piattaforma "tutto in uno": Postgres più login, file, API automatica sul
database e aggiornamenti in tempo reale. Noi queste parti le abbiamo già, scelte e testate:
login con Better Auth, file su R2, sicurezza fra fiorerie con la nostra RLS e accesso al
database solo dal server. Da Supabase useremmo solo Postgres, quindi il confronto è fra due
Postgres gestiti:

| Criterio                                                       | Neon                                                       | Supabase                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Database per ogni anteprima                                    | branch istantaneo copia-su-scrittura, integrato con Vercel | un'istanza separata per branch, creata dalle migrazioni, a ore     |
| Ripristino a un minuto qualsiasi (PITR)                        | incluso (7 giorni Launch, 30 giorni Scale)                 | componente aggiuntivo: 100 USD/mese per 7 giorni, oltre al compute |
| Staging e anteprime quando nessuno li usa                      | si spengono da soli (si paga solo l'uso)                   | istanze accese, pagate a ore                                       |
| Superficie esposta                                             | solo Postgres                                              | anche un'API automatica sul database, da disattivare o sorvegliare |
| Costo del nostro assetto (prod con PITR + staging + anteprime) | ≈ 25–50 USD/mese                                           | ≈ 140–160 USD/mese                                                 |

Rischio fornitore: Neon fa parte di Databricks dal 2025. Neon dichiara che il prodotto resta
autonomo, con fatturazione separata, e il motore è open source (Apache 2.0); lo stesso motore è
alla base di Databricks Lakebase. Rischio basso: usiamo Postgres standard (RLS, funzioni SQL,
Prisma), quindi spostarsi resta un'esportazione e un'importazione.

Sceglieremmo Supabase se partissimo da zero e volessimo login, file e tempo reale in un solo
servizio. Non è il nostro caso. Per quanto verificato, nessuno dei due ha oggi una regione in
Messico.

### Costo stimato all'inizio (da verificare sui listini al momento dell'acquisto)

| Voce                                                        | Al mese, staging + produzione                  |
| ----------------------------------------------------------- | ---------------------------------------------- |
| Vercel Pro (1 sviluppatore; staging e anteprime incluse)    | 20 USD, con 20 USD di consumo inclusi          |
| Funzioni Vercel oltre il credito incluso (pagine + job AI)  | 0–40 USD all'inizio                            |
| Sviluppatori in più su Vercel                               | 20 USD ciascuno (chi guarda soltanto non paga) |
| Neon Postgres (produzione sempre accesa + staging e branch) | 25–50 USD                                      |
| Cloudflare R2                                               | gratis all'inizio                              |
| Resend                                                      | gratis → 20 USD                                |
| Log, monitor di disponibilità (drain o Observability Plus)  | 10–40 USD                                      |
| **Totale indicativo**                                       | **≈ 60–170 USD**                               |

Più: dominio (≈ 15–40 USD/anno) e AI a consumo. **La voce che cresce con le fiorerie è l'AI, non
l'hosting**: una foto realistica costa circa 0,08–0,10 USD a fal (controlli inclusi). Il piano
Plus include 25 anteprime al mese, cioè circa 2–2,5 USD per fioreria, dentro i ~7 € di
differenza di prezzo. Il resto passa dai pacchetti di crediti, e i tetti mensili per ambiente
sono già nel codice. Esempio: 300 fiorerie con 30.000 job AI al mese costano a Vercel una
quindicina di dollari di funzioni, a fal circa 2.400–3.000 USD, coperti da quote e crediti.

### Dati personali

La legge messicana sui dati personali (LFPDPPP) prevede aviso de privacidad e diritti ARCO;
ospitare i dati negli Stati Uniti va dichiarato nell'aviso. **Da validare con un legale messicano**
prima del pilota (insieme a O-07 sul consenso per le foto). Il piano non fa assunzioni legali.

---

## 4. Flusso di sviluppo e rilascio

1. **Branch per ogni lavoro → Pull Request → `main`.** Commit piccoli (convenzionali, come oggi).
2. **CI su ogni PR** (GitHub Actions): lint, format, typecheck, test unit + integrazione su
   Postgres reale con RLS, build, E2E Playwright. Una PR non si unisce se qualcosa è rosso.
3. **Anteprima automatica su ogni PR** (Vercel): branch Neon proprio con le migrazioni della PR e
   il seed demo, AI simulata, link nella PR per provarla dal telefono.
4. **Merge su `main` → deploy automatico su staging**, con le migrazioni applicate **prima** del
   deploy (ruolo proprietario) e un **test di fumo** automatico (salute, login, una pagina per
   area).
5. **Rilascio in produzione approvato** (GitHub Action manuale o tag `vX.Y.Z`): migrazioni prima,
   poi deploy dello stesso build già provato (`vercel deploy --prebuilt --prod`), note di
   rilascio generate dai commit.
6. **Migrazioni "espandi e contrai":** mai rompere la versione che sta girando (prima si aggiunge
   la colonna nuova, si rilascia, poi si toglie la vecchia). Così pagine e job AI di versioni
   vicine convivono e il rollback dell'app resta sicuro.
7. **Rollback:** Instant Rollback di Vercel (secondi) per l'app; per i dati, ripristino a un
   istante (Neon), con una prova di ripristino ogni trimestre.
8. **Feature flag per fioreria** quando serve rilasciare a pochi (oggi abbiamo già gli
   entitlements per piano; si aggiungono flag per singola fioreria pilota).

---

## 5. Architettura del codice

### Cosa c'è già (e resta)

- **Strati con dipendenze a senso unico:** `domain` (regole pure, Zod) → `db` (Prisma, RLS,
  migrazioni) → `core` (servizi, autorizzazione, audit, AI) → `apps/web` (pagine, azioni, UI).
  La logica di business non sta nelle pagine.
- **Multi-tenant con RLS** e contesto obbligatorio, permessi e piano controllati nel servizio.
- **Test a tre livelli** (dominio, servizi su DB reale con isolamento fra fiorerie, E2E).

### Cosa cambiamo (dall'analisi del codice del 21/11/2026)

**Moduli per area.** In `apps/web`: `components/ui` resta per i mattoni (stile shadcn); nasce
`components/common` per i pezzi usati da più aree (elenchi, filtri, paginazione, stati vuoti,
dialoghi di conferma, pulsanti-azione, immagini private, campi indirizzo e fiscali) e
`features/<area>/` per i componenti condivisi dentro un'area (catalogo, clienti, preventivi,
Builder, foto, team). Nel `core`: i file oltre ~500 righe si dividono per responsabilità
(preventivi, anteprime, Builder, clienti, adattatori fal, worker); storage e immagini passano da
`ai/` a `media/`; i finti per i test escono dall'export principale (`@floral/core/testing`). Una
regola di lint impedisce dipendenze non previste fra pacchetti (es. il web non usa il DB a
runtime, salvo eccezioni elencate).

**Fine delle copie.** Ciò che oggi è ripetuto diventa un pezzo unico:

| Ripetuto oggi                                                           | Quante volte                  | Diventa                                                  |
| ----------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| Scheletro delle server action (contesto, errori, revalidate, messaggio) | 38 azioni in 7 file           | `defineTenantAction`                                     |
| Pagine elenco: filtri, ricerca, paginazione, vuoto, conteggio           | 4 pagine (+ ricerca clienti)  | `components/common/list/*` + `listHref`                  |
| ✅ Immagini private: route, lettura del file, `<img>`, URL              | 5 route, 4 servizi, 7 `<img>` | `privateImageRoute`, `readStoredImage`, `<PrivateImage>` |
| Percorsi `/app/${slug}/…` scritti a mano                                | 75 in 32 file                 | `routes.ts` (link, redirect, revalidate, immagini)       |
| Dialoghi di conferma                                                    | 3                             | `ConfirmActionDialog`                                    |
| Pulsanti-azione e form di quantità                                      | 7 + 2                         | `ActionButton`, `QuantityForm`                           |
| Campi indirizzo / dati fiscali / profilo                                | 3 + 3 + 2                     | `AddressFields`, `LegalFields`, `ProfileFields`          |
| Stati vuoti scritti a mano                                              | 7                             | `EmptyState` con varianti                                |
| Badge di stato e campioni colore                                        | 3–4 ciascuno                  | `StatusBadge`, `ColorSwatch`                             |
| Nel core: controllo ID + "non trovato", validazione Zod, paginazione    | 45, 19, 4                     | `assertId`, `parseInput`, `paginate`                     |
| Date e fusi orari                                                       | 3 pacchetti, 3 convenzioni    | un modulo date unico + formattazione per fioreria        |

**Configurazione unica.** ✅ (22/11) Le variabili si leggevano in più punti e si controllavano
solo al primo login: ora ogni regola è scritta una volta (schema del web e schema della
piattaforma diviso in AI, archivio ed email), tutto si controlla **all'avvio** e gli adattatori
ricevono valori già validati. Se manca qualcosa l'app non parte e dice cosa manca
(`docs/CONFIGURATION.md`).

**Falle di gestione errori trovate (da chiudere nella fase 0):**

1. ✅ (22/11) Solo confini d'errore alla radice: un errore in una pagina della fioreria faceva
   sparire menu e navigazione → confine d'errore e 404 dentro il menu della fioreria, errore
   globale; durante la navigazione la voce del menu toccata mostra una rotella. Niente
   `loading.tsx` a livello di fioreria: con lo streaming un `notFound()` risponderebbe 200 invece
   di 404 (regola del progetto: 404 per le risorse di altre fiorerie). I caricamenti lenti avranno
   un `Suspense` nella singola pagina, DOPO il controllo che la risorsa esista.
2. ✅ (22/11) Gli errori di pagine e route non passavano dal nostro logger → `onRequestError`
   scrive una riga JSON con ID della richiesta, `digest` (il "Referencia" che vede l'utente) e il
   percorso della route (mai quello reale né la query, che possono contenere token). Anche le API
   hanno ora l'ID della richiesta.
3. ✅ (22/11) Alcuni errori di validazione non si vedevano (il campo non è nel form, es. il
   cliente scelto con un pulsante) → dopo il disegno della pagina, ogni errore per campo che non
   compare diventa un toast: nessun errore di validazione resta silenzioso, in nessun form.
4. ✅ (22/11) Se all'avvio il database non rispondeva, il worker AI non ripartiva fino al riavvio
   → nuovi tentativi in background (2 s, 4 s, 8 s… fino a 60 s); appena il database torna,
   controllo della RLS e avvio del worker, senza riavviare l'app (provato spegnendo il database).
   Arresto: un job interrotto torna in coda alla scadenza del lease (300 s); niente gestori di
   segnali dentro `next start` (rischierebbero di bloccare l'uscita). Con i job su funzioni
   (Vercel) il worker nel processo non gira in produzione.
5. ✅ (22/11) Il caricamento delle foto salvava i file con la transazione aperta (blocchi tenuti
   durante l'invio in rete, file orfani se la transazione falliva dopo) → file salvati prima,
   transazione breve, file cancellati se la registrazione fallisce o l'articolo non c'è.
6. Le letture modificano dati (scadenza di preventivi e inviti) → lavoro programmato (cron).
7. ✅ (22/11) Le route delle immagini traducevano in modo diverso permessi e piano (alcuni casi
   finivano in errore 500) → `privateImageRoute`: 404 uguale per tutti i casi.

**Test e CI.** Si aggiungono test per le utilità del web (form, azioni, immagini); in CI: gli E2E
dopo l'integrazione, cache, controllo che le migrazioni corrispondano allo schema, scansione di
dipendenze e segreti, `Dockerfile` con build `standalone`, job di deploy.

**Ordine consigliato** (ogni blocco si rilascia da solo, senza fermare il resto): errori e log →
configurazione → errori silenziosi → immagini private → azioni e percorsi → pagine elenco → altri
componenti condivisi → divisione dei file grandi insieme alle funzionalità che li toccano.

---

## 6. Gestione degli errori (da cima a fondo)

1. **Tipi di errore unici** nel core (oggi: validazione, non trovato, conflitto, permesso, piano):
   ogni errore previsto ha un **codice** (es. `quote_not_editable`) tradotto in es-MX; gli errori
   imprevisti sono "interni".
2. **Dove si catturano:** i servizi lanciano; azioni e route li traducono **in un solo punto**
   (stato del form, toast, 404, 403); le pagine hanno confini d'errore (`error.tsx`) per sezione
   e uno globale.
3. **Ogni richiesta ha un ID** (già mostrato all'utente come "código de referencia"): passa dal
   web al core e ai log tramite un contesto di richiesta, e arriva anche nei job del worker.
4. **Servizi esterni** (AI, email, storage): timeout sempre, nuovi tentativi con attesa
   crescente dove ha senso (le code AI lo fanno già), errori tradotti in codici nostri; mai un
   errore del fornitore mostrato tale e quale all'utente.
5. **Log strutturati** (pino, già): livello, ID richiesta, ID fioreria, mai email, token o dati
   fiscali.
6. **Sentry (fase 1):** gli errori imprevisti di web e worker arrivano con ID richiesta, versione
   e ambiente; avvisi per errori nuovi o in aumento. Il codice avrà già un adattatore (P-05), quindi
   attivarlo sarà solo una chiave.
7. **Mai fallire in silenzio:** niente `catch` vuoti; un'operazione non riuscita lascia uno stato
   visibile (job FAILED con codice, foto "no se pudo", ecc.), come già facciamo nelle code AI.

---

## 7. Sicurezza

- **Account dei fornitori** (GitHub, Vercel, Neon, Cloudflare, Resend, fal) intestati all'azienda,
  con 2FA obbligatoria; accesso alla produzione solo a chi serve.
- **Segreti** solo nelle variabili della piattaforma, separati per ambiente; rotazione documentata.
- **Database:** ruolo dell'app senza `BYPASSRLS`, ruolo delle migrazioni separato (già così);
  connessioni cifrate.
- **Login (Better Auth):** email verificata, limiti di tentativi (già), sessioni con scadenza;
  **2FA per i proprietari** e chiusura delle sessioni dalle impostazioni (fase 1); login con Google
  già fatto (ADR-036: collegamento solo con email verificate, un client OAuth per ambiente, spento
  nelle anteprime per PR).
- **Intestazioni di sicurezza** (CSP, HSTS, frame) e controllo delle origini.
- **Dipendenze aggiornate** in automatico (Renovate o Dependabot) e scansione dei segreti su GitHub.
- **Backup con prova di ripristino** trimestrale; registro di audit (già) per le azioni sensibili.
- **Runbook** degli incidenti: chi avvisare, come fare rollback, come comunicare alle fiorerie.

---

## 8. Osservabilità e operatività

- **Salute:** `/api/health` (già) controllato ogni minuto da un monitor esterno; la funzione dei
  job AI scrive un "battito" e la lunghezza della coda, con avviso se si ferma.
- **Log** raccolti e cercabili (drain dei log di Vercel verso un servizio di log, perché il piano
  Pro li conserva 1 giorno), con avvisi su errori ripetuti.
- **Metriche di business** semplici: anteprime generate e scartate, costo AI del mese per
  fioreria, preventivi creati e accettati.
- **Avvisi** (email/WhatsApp del team): sito giù, job AI fermi, coda lunga, spesa AI oltre l'80%
  del tetto, migrazione fallita.

---

## 9. Lavori in background e integrazioni

- **Job AI su Vercel:** la coda resta in Postgres (stati, crediti, tentativi). Una funzione
  dedicata la svuota: parte subito dopo l'accodamento e ogni minuto con un cron di sicurezza, con
  un limite globale di job in parallelo (limite di fal). È separata dalle pagine, quindi un picco
  di AI non rallenta il sito e un rilascio non perde lavoro: un job interrotto torna in coda alla
  scadenza del lease.
- **Lo stesso codice gira altrove:** il core espone "svuota la coda" e non sa chi lo chiama. In
  locale lo chiama il worker nel processo (come oggi); su un altro hosting lo chiamerebbe un
  processo sempre acceso.
- **Job lunghi (Flora Studio, video P2):** fal in coda con webhook; Vercel Workflows o Daemons
  solo quando serviranno.
- **Cron:** scadenza dei preventivi, promemoria delle fechas especiales, pulizia dei file non più
  usati, riepilogo giornaliero dei costi AI (Vercel Cron in produzione, Schedules per lo
  staging).
- **Email transazionali** (Resend) dietro l'adattatore che già esiste (`mailer`).
- **Roadmap integrazioni:** WhatsApp Business API, notifiche push (PWA), pagamenti (Stripe per
  l'abbonamento, Mercado Pago per gli incassi, P-04), CFDI solo con il contador.

---

## 10. Roadmap

### Fase 0 — Fondamenta (prima del pilota)

1. **Founder:** dominio e nome definitivo (O-03); account aziendali dei fornitori con 2FA;
   carta di pagamento.
2. ✅ Configurazione per ambiente validata all'avvio (pagine e job AI), tabella delle variabili
   (`docs/CONFIGURATION.md`).
3. **Job AI su funzioni**: svuotamento della coda, cron di sicurezza, limite di parallelismo;
   immagini grandi in streaming o con URL firmati; limite di caricamento a 4 MB.
4. Progetto Vercel con anteprime e staging, integrazione Neon (branch per anteprima), ruoli del
   database corretti per ambiente, bucket R2, dominio email verificato; configurazione della
   piattaforma versionata nel repository.
5. CI/CD: anteprima per PR, deploy automatico su staging, test di fumo, rilascio in produzione
   approvato, migrazioni prima del deploy.
6. Gestione errori uniforme e refactor dei componenti ripetuti, nell'ordine della sezione 5.
7. Monitor di disponibilità, drain dei log, avvisi base; backup con primo test di ripristino.
8. Intestazioni di sicurezza, aggiornamento automatico delle dipendenze, runbook.

### Fase 1 — Pilota ad Aguascalientes

- Sentry su pagine e job AI; 2FA per i proprietari; gestione sessioni.
- **Link pubblico del preventivo** per il cliente (token, scadenza, revoca): approvato dal founder il
  21/11/2026; testi di privacy da validare (O-07).
- Notifiche email (preventivo inviato/accettato); foto vere dei fiori e prova da ~100 immagini AI.
- Aviso de privacidad e consenso foto validati (O-07).

### Fase 2 — Crescita

- Abbonamenti con Stripe (P-04) e pannello di amministrazione della piattaforma.
- Ordini e consegne (Sprint 3), WhatsApp Business API, **notifiche push** (PWA).
- Builder pubblico per i clienti della fioreria (AI-BQ-10). (Il login con Google è già fatto:
  ADR-036, anticipato su richiesta del founder il 21/11/2026.)

### Fase 3 — Scala

- Più sedi per fioreria, rete di fiorerie (Floral Network), analisi.
- Dati in Messico (Google Cloud Querétaro) se richiesto; repliche di lettura; audit esterni di
  sicurezza.

---

## 11. Decisioni che servono dal founder

1. **Hosting:** A (Vercel + Neon, consigliato dopo la revisione del 21/11), B (Render + Neon,
   riserva) o C (Google Cloud Messico).
2. **Nome e dominio** definitivi (O-03): servono per email, URL e account.
3. **Intestatario degli account e dei pagamenti** (entità legale, O-02).
4. **Budget mensile** di infrastruttura (≈ 60–170 USD + AI) e tetto AI per staging/produzione.
5. **Regione:** Stati Uniti est adesso, Messico più avanti se servirà.

---

## Fonti (verificate il 21/11/2026)

Le pagine di Vercel non si aprono da questo ambiente di sviluppo: le cifre di Vercel vengono dai
risultati di ricerca su quelle pagine e vanno ricontrollate sul sito prima dell'acquisto.

- Vercel: [piano Pro](https://vercel.com/docs/plans/pro-plan), [prezzi](https://vercel.com/pricing),
  [durata delle funzioni](https://vercel.com/docs/functions/configuring-functions/duration),
  [limiti con Fluid compute](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute),
  [prezzi Fluid compute](https://vercel.com/docs/fluid-compute/pricing), [regioni](https://vercel.com/docs/regions),
  [limite di 4,5 MB](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions),
  [ambienti personalizzati](https://vercel.com/docs/deployments/custom-environments),
  [Skew Protection](https://vercel.com/docs/skew-protection),
  [cron: limiti](https://vercel.com/docs/cron-jobs/usage-and-pricing), [cron: gestione](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
  [Schedules](https://vercel.com/docs/schedules/concepts),
  [lavori in background](https://vercel.com/kb/guide/background-workers-on-vercel),
  [Workflows](https://vercel.com/blog/a-new-programming-model-for-durable-execution),
  [Queues (beta)](https://vercel.com/docs/queues), [Daemons (beta)](https://vercel.com/docs/daemons),
  [log e Observability Plus](https://vercel.com/docs/observability/limits-and-pricing),
  [Drains](https://vercel.com/blog/introducing-vercel-drains).
- Neon con Vercel: [anteprime con l'integrazione nativa](https://neon.com/docs/guides/vercel-native-integration-previews),
  [integrazione gestita da Neon](https://neon.com/docs/guides/neon-managed-vercel-integration).

- Render: [prezzi](https://render.com/pricing.md), [Postgres](https://render.com/docs/postgresql),
  [rete privata e regioni](https://render.com/docs/private-network),
  [Next.js, Postgres e job in background](https://render.com/articles/nextjs-background-jobs-postgresql-production),
  [changelog](https://render.com/changelog?).
- Neon: [prezzi](https://neon.com/pricing), [limiti dei piani](https://neon.com/docs/introduction/limits),
  [Launch vs Supabase Pro](https://neon.com/guides/neon-launch-plan-vs-supabase-pro-plan),
  [Neon e Databricks (FAQ)](https://neon.tech/databricks-faq), [Neon e Lakebase](https://neon.com/blog/were-building-backends),
  [ruoli](https://neon.com/docs/manage/roles/), [RLS nei branch](https://neon.com/guides/test-rls-on-neon-branches),
  [changelog BYPASSRLS](https://neon.com/docs/changelog/2023-08-15).
- Railway: [piani](https://docs.railway.com/pricing/plans), [FAQ prezzi](https://docs.railway.com/pricing/faqs).
- Supabase: [prezzi](https://supabase.com/pricing), [costo del PITR](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery),
  [costo dei branch](https://supabase.com/docs/guides/platform/manage-your-usage/branching), [regioni](https://supabase.com/docs/guides/platform/regions).
- Google Cloud: [regione Messico](https://cloud.google.com/blog/products/infrastructure/google-cloud-announces-41st-cloud-region-in-mexico),
  [località e prodotti](https://cloud.google.com/about/locations/index.html).
- Cloudflare R2: [prezzi](https://developers.cloudflare.com/r2/pricing/index.md).
- Resend: [prezzi](https://resend.com/pricing), [free tier](https://resend.com/blog/new-free-tier).
- Sentry: [prezzi](https://sentry.io/pricing).
- Better Auth: [2FA](https://better-auth.com/docs/plugins/2fa), [passkey](https://better-auth.com/docs/plugins/passkey).
