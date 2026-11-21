# Piano di piattaforma — ambienti, stack, architettura del codice

**Stato: PROPOSTO (21/11/2026), da approvare dal founder.** Nessuna voce di questo documento è
una decisione finché non è confermata e riportata in `docs/DECISIONS.md`.

Obiettivo: passare da "funziona sul nostro computer" a un software che una fioreria vera può
usare ogni giorno, con ambienti separati, rilasci controllati, errori visibili e dati protetti.
Molte cose si fanno subito (le fondamenta); altre vanno in roadmap (notifiche push, Sentry,
pagamenti…), ma l'architettura le prevede già.

---

## 0. In breve

| Tema               | Proposta                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Ambienti           | **locale** (sviluppo) → **staging** (prova con dati finti) → **produzione** (fiorerie vere); anteprime per PR facoltative |
| App e worker       | **Render**: servizio web (Next.js) + **worker separato** (AI e scontorni) + **cron** (lavori programmati), stessa regione |
| Database           | **Neon** (Postgres gestito): RLS come oggi, backup con ripristino a un istante (7 giorni), database separati per ambiente |
| File               | **Cloudflare R2** (già pronto nel codice): un bucket privato per ambiente                                       |
| Email              | **Resend** con dominio verificato (SPF/DKIM/DMARC)                                                             |
| Login              | **Better Auth** (già nel codice, dati nel nostro DB): 2FA per i proprietari nella fase 1                        |
| AI                 | **fal.ai** (già nel codice), con tetto di spesa per ambiente                                                   |
| Errori e log       | log JSON (già), raccolta log e monitor di disponibilità subito; **Sentry** nella fase 1                         |
| Costo stimato      | **≈ 60–120 USD/mese** per staging + produzione all'inizio, più l'AI a consumo                                  |
| Regione            | Stati Uniti est (Virginia/Ohio), vicina al Messico; Messico (Google Cloud Querétaro) solo se un giorno servirà   |

Il codice parte già da una base solida (dominio → database → servizi → web, RLS, test a tre
livelli). Il lavoro vero è: **separare il worker**, **mettere in piedi staging e produzione con
rilasci automatici**, **uniformare gestione errori e componenti**, **monitorare**.

---

## 1. Principi

1. **Pochi servizi, gestiti da altri.** Siamo un team piccolo: niente server da amministrare,
   niente Kubernetes. Piattaforme gestite, con backup e aggiornamenti inclusi.
2. **Niente lock-in pesante.** App in container standard, Postgres standard, storage S3: si può
   cambiare fornitore senza riscrivere il codice.
3. **Staging uguale alla produzione**, ma con dati finti: ogni rilascio passa prima da lì.
4. **Sicurezza di default:** RLS nel database, segreti solo nelle variabili della piattaforma,
   ruoli minimi, 2FA su tutti gli account dei fornitori.
5. **Tutto ciò che si ripete si automatizza** (test, rilasci, migrazioni); **tutto ciò che si
   rompe si vede** (log, allarmi, errori con codice di riferimento).
6. **Scrivere le decisioni** (ADR) e tenere il piano aggiornato, come già facciamo.

---

## 2. Ambienti

| Ambiente           | Scopo                                         | Dati                                  | AI                         | Email                                      | Deploy                                   |
| ------------------ | --------------------------------------------- | ------------------------------------- | -------------------------- | ------------------------------------------ | ---------------------------------------- |
| **Locale**         | sviluppo e test                               | Postgres in Docker, seed demo         | simulata (o fal con chiave) | Mailpit (nessuna email esce)              | a mano                                   |
| **Anteprima PR**   | provare una modifica prima di unirla (facoltativo) | branch Neon da staging, seed demo     | simulata                   | catturata, nessun invio reale              | automatico a ogni PR                     |
| **Staging**        | prova completa prima della produzione; demo   | **solo dati finti** (seed demo)       | fal con tetto basso (es. 10 USD/mese) | solo verso indirizzi del team (allowlist) | automatico a ogni merge su `main`        |
| **Produzione**     | fiorerie vere                                 | reali, con backup e ripristino        | fal con tetto mensile       | reale, dominio verificato                  | manuale (rilascio approvato)             |

Regole:

- **Mai dati reali fuori dalla produzione.** Staging non è una copia della produzione: ha il suo
  database con il seed demo (il seed rifiuta già di girare con `NODE_ENV=production`).
- Ogni ambiente ha **il proprio** database, bucket R2, chiavi, dominio
  (es. `staging.<dominio>` e `app.<dominio>`), mittente email e tetto di spesa AI.
- Il provider AI simulato è ammesso solo in locale/anteprima (l'app già rifiuta di avviarsi
  con il simulato su un URL pubblico).

---

## 3. Stack e hosting

### Opzione consigliata (A): Render + Neon + Cloudflare R2 + Resend

- **Render** esegue servizi web, **worker in background** e **cron job**, con ambienti e
  anteprime per PR sui piani a pagamento, in cinque regioni (Oregon, Ohio, Virginia, Francoforte,
  Singapore). Web, worker e cron nella stessa regione comunicano sulla rete privata.
- **Neon** (Postgres gestito): branch del database per staging e per le anteprime, ripristino a un
  istante fino a 7 giorni sul piano Launch, prezzo a consumo. Attenzione verificata: i ruoli creati
  dalla console Neon hanno `BYPASSRLS`; il ruolo dell'app va creato **in SQL** senza quel
  privilegio (l'app già si rifiuta di partire in produzione con un ruolo che aggira la RLS).
- **Cloudflare R2** per foto e immagini: nessun costo di uscita dati, 10 GB al mese gratis.
- **Resend** per le email: 3.000 email al mese gratis (100 al giorno), 20 USD/mese per 50.000.
- **Sentry** (fase 1): piano gratuito con 5.000 errori al mese.

Perché: è la combinazione più semplice che copre tutto ciò che il nostro codice richiede (Next.js
+ un processo sempre acceso per il worker + Postgres con RLS + cron), con backup e ambienti già
pronti, a costo basso.

### Alternative valutate

- **(B) Vercel per il web + Render/Railway per il worker + Neon.** Vercel è ottimo per Next.js, ma
  esegue funzioni legate alle richieste: il worker sempre acceso (code AI, scontorni) richiede
  comunque un secondo fornitore. Due piattaforme da gestire invece di una.
- **(C) Google Cloud in Messico (Querétaro, `northamerica-south1`):** Cloud Run è disponibile nella
  regione; dati in Messico e latenza minima. Molto più lavoro di gestione (permessi, rete,
  Terraform). Da considerare **dopo**, se clienti grandi o la normativa chiederanno i dati in
  Messico: grazie ai container e a Postgres standard la migrazione resta possibile.
- **Railway:** simile a Render (ambienti, anteprime per PR), piano Pro da 20 USD/mese a consumo.
  Valida alternativa; Render ha regione Virginia/Ohio e worker/cron già pensati per questo uso.

### Costo stimato all'inizio (da verificare sui listini al momento dell'acquisto)

| Voce                                   | Staging          | Produzione         |
| -------------------------------------- | ---------------- | ------------------ |
| Render web (Next.js)                   | istanza piccola  | istanza 2 GB RAM   |
| Render worker                          | istanza piccola  | istanza piccola    |
| Render cron                            | centesimi        | centesimi          |
| Neon Postgres                          | pochi USD        | 20–40 USD          |
| Cloudflare R2                          | gratis           | gratis all'inizio  |
| Resend                                 | gratis           | gratis → 20 USD    |
| Monitor di disponibilità, log          | gratis           | gratis → 10–30 USD |
| **Totale indicativo**                  | **≈ 15–35 USD**  | **≈ 45–90 USD**    |

Più: dominio (≈ 15–40 USD/anno), AI a consumo (tetto già nel codice), eventuale piano di workspace
Render per le anteprime per PR.

### Dati personali

La legge messicana sui dati personali (LFPDPPP) prevede aviso de privacidad e diritti ARCO;
ospitare i dati negli Stati Uniti va dichiarato nell'aviso. **Da validare con un legale messicano**
prima del pilota (insieme a O-07 sul consenso per le foto). Il piano non fa assunzioni legali.

---

## 4. Flusso di sviluppo e rilascio

1. **Branch per ogni lavoro → Pull Request → `main`.** Commit piccoli (convenzionali, come oggi).
2. **CI su ogni PR** (GitHub Actions): lint, format, typecheck, test unit + integrazione su
   Postgres reale con RLS, build, E2E Playwright. Una PR non si unisce se qualcosa è rosso.
3. **Merge su `main` → deploy automatico su staging**: migrazioni (`prisma migrate deploy`,
   ruolo proprietario) come passo **prima** dell'avvio, poi web, worker e cron; quindi un **test
   di fumo** automatico (salute, login, una pagina per area).
4. **Rilascio in produzione approvato** (tag di versione `vX.Y.Z` o promozione manuale), con
   note di rilascio generate dai commit.
5. **Migrazioni "espandi e contrai":** mai rompere la versione che sta girando (prima si aggiunge
   la colonna nuova, si rilascia, poi si toglie la vecchia). Così web e worker possono aggiornarsi
   in momenti diversi e il rollback dell'app resta sicuro.
6. **Rollback:** si torna al deploy precedente con un clic; per i dati, ripristino a un istante
   (Neon) — con una prova di ripristino ogni trimestre.
7. **Feature flag per fioreria** quando serve rilasciare a pochi (oggi abbiamo già gli
   entitlements per piano; si aggiungono flag per singola fioreria pilota).

---

## 5. Architettura del codice

### Cosa c'è già (e resta)

- **Strati con dipendenze a senso unico:** `domain` (regole pure, Zod) → `db` (Prisma, RLS,
  migrazioni) → `core` (servizi, autorizzazione, audit, AI) → `apps/web` (pagine, azioni, UI).
  La logica di business non sta nelle pagine.
- **Multi-tenant con RLS** e contesto obbligatorio, permessi e piano controllati nel servizio.
- **Test a tre livelli** (dominio, servizi su DB reale con isolamento fra fiorerie, E2E).

### Cosa cambiamo

<!-- SEZIONE DA COMPLETARE CON L'ANALISI DEL CODICE -->

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

- **Account dei fornitori** (GitHub, Render, Neon, Cloudflare, Resend, fal) intestati all'azienda,
  con 2FA obbligatoria; accesso alla produzione solo a chi serve.
- **Segreti** solo nelle variabili della piattaforma, separati per ambiente; rotazione documentata.
- **Database:** ruolo dell'app senza `BYPASSRLS`, ruolo delle migrazioni separato (già così);
  connessioni cifrate.
- **Login (Better Auth):** email verificata, limiti di tentativi (già), sessioni con scadenza;
  **2FA per i proprietari** e chiusura delle sessioni dalle impostazioni (fase 1); login con Google
  (fase 2).
- **Intestazioni di sicurezza** (CSP, HSTS, frame) e controllo delle origini.
- **Dipendenze aggiornate** in automatico (Renovate o Dependabot) e scansione dei segreti su GitHub.
- **Backup con prova di ripristino** trimestrale; registro di audit (già) per le azioni sensibili.
- **Runbook** degli incidenti: chi avvisare, come fare rollback, come comunicare alle fiorerie.

---

## 8. Osservabilità e operatività

- **Salute:** `/api/health` (già) controllato ogni minuto da un monitor esterno; il worker scrive
  un "battito" e la lunghezza della coda, con avviso se si ferma.
- **Log** raccolti e cercabili (inoltro dei log di Render a un servizio di log), con avvisi su
  errori ripetuti.
- **Metriche di business** semplici: anteprime generate e scartate, costo AI del mese per
  fioreria, preventivi creati e accettati.
- **Avvisi** (email/WhatsApp del team): sito giù, worker fermo, coda lunga, spesa AI oltre l'80%
  del tetto, migrazione fallita.

---

## 9. Lavori in background e integrazioni

- **Worker separato** (stesso codice, processo proprio): oggi gira dentro il server web; in
  produzione va separato, così un picco di AI non rallenta le pagine e il web si può riavviare
  senza perdere lavoro.
- **Risveglio fra processi:** l'avviso "c'è un job nuovo" oggi è interno al processo; con il
  worker separato passa a Postgres `LISTEN/NOTIFY` (più un controllo periodico di sicurezza).
- **Cron:** scadenza dei preventivi, promemoria delle fechas especiales, pulizia dei file non più
  usati, riepilogo giornaliero dei costi AI.
- **Email transazionali** (Resend) dietro l'adattatore che già esiste (`mailer`).
- **Roadmap integrazioni:** WhatsApp Business API, notifiche push (PWA), pagamenti (Stripe per
  l'abbonamento, Mercado Pago per gli incassi, P-04), CFDI solo con il contador.

---

## 10. Roadmap

### Fase 0 — Fondamenta (prima del pilota)

1. **Founder:** dominio e nome definitivo (O-03); account aziendali dei fornitori con 2FA;
   carta di pagamento.
2. Configurazione per ambiente validata all'avvio (web e worker), tabella delle variabili.
3. **Worker in un processo separato** + `LISTEN/NOTIFY` + cron di base.
4. Infrastruttura come codice (blueprint Render) per staging e produzione; database Neon per
   ambiente con ruoli corretti; bucket R2; dominio email verificato.
5. CI/CD: deploy automatico su staging, test di fumo, rilascio in produzione approvato,
   migrazioni prima dell'avvio.
6. Gestione errori uniforme e refactor dei componenti ripetuti (sezione 5).
7. Monitor di disponibilità, raccolta log, avvisi base; backup con primo test di ripristino.
8. Intestazioni di sicurezza, aggiornamento automatico delle dipendenze, runbook.

### Fase 1 — Pilota ad Aguascalientes

- Sentry su web e worker; 2FA per i proprietari; gestione sessioni.
- **Link pubblico del preventivo** per il cliente (token, scadenza, revoca; approvato dal founder).
- Notifiche email (preventivo inviato/accettato); foto vere dei fiori e prova da ~100 immagini AI.
- Aviso de privacidad e consenso foto validati (O-07).

### Fase 2 — Crescita

- Abbonamenti con Stripe (P-04) e pannello di amministrazione della piattaforma.
- Ordini e consegne (Sprint 3), WhatsApp Business API, **notifiche push** (PWA).
- Login con Google; Builder pubblico per i clienti della fioreria (AI-BQ-10).

### Fase 3 — Scala

- Più sedi per fioreria, rete di fiorerie (Floral Network), analisi.
- Dati in Messico (Google Cloud Querétaro) se richiesto; repliche di lettura; audit esterni di
  sicurezza.

---

## 11. Decisioni che servono dal founder

1. **Hosting:** A (Render + Neon, consigliato), B (Vercel + worker esterno) o C (Google Cloud
   Messico).
2. **Nome e dominio** definitivi (O-03): servono per email, URL e account.
3. **Intestatario degli account e dei pagamenti** (entità legale, O-02).
4. **Budget mensile** di infrastruttura (≈ 60–120 USD + AI) e tetto AI per staging/produzione.
5. **Regione:** Stati Uniti est adesso, Messico più avanti se servirà.

---

## Fonti (verificate il 21/11/2026)

- Render: [prezzi](https://render.com/pricing.md), [Postgres](https://render.com/docs/postgresql),
  [rete privata e regioni](https://render.com/docs/private-network),
  [Next.js, Postgres e job in background](https://render.com/articles/nextjs-background-jobs-postgresql-production),
  [changelog](https://render.com/changelog?).
- Neon: [prezzi](https://neon.com/pricing), [limiti dei piani](https://neon.com/docs/introduction/limits),
  [Launch vs Supabase Pro](https://neon.com/guides/neon-launch-plan-vs-supabase-pro-plan),
  [ruoli](https://neon.com/docs/manage/roles/), [RLS nei branch](https://neon.com/guides/test-rls-on-neon-branches),
  [changelog BYPASSRLS](https://neon.com/docs/changelog/2023-08-15).
- Railway: [piani](https://docs.railway.com/pricing/plans), [FAQ prezzi](https://docs.railway.com/pricing/faqs).
- Google Cloud: [regione Messico](https://cloud.google.com/blog/products/infrastructure/google-cloud-announces-41st-cloud-region-in-mexico),
  [località e prodotti](https://cloud.google.com/about/locations/index.html).
- Cloudflare R2: [prezzi](https://developers.cloudflare.com/r2/pricing/index.md).
- Resend: [prezzi](https://resend.com/pricing), [free tier](https://resend.com/blog/new-free-tier).
- Sentry: [prezzi](https://sentry.io/pricing).
- Better Auth: [2FA](https://better-auth.com/docs/plugins/2fa), [passkey](https://better-auth.com/docs/plugins/passkey).
