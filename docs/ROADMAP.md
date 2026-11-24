# Roadmap di Gardelia

**Stato: PROPOSTO (23/11/2026).** Dice in che ordine arrivano le funzioni e i ricavi, e quale
condizione apre ogni tappa. Non ci sono date: ogni tappa parte quando la precedente ha raggiunto il
suo traguardo. Dettagli della V1 in `docs/V1_SCOPE.md`, prezzi e conti in `docs/BUSINESS_MODEL.md`,
decisioni in `docs/DECISIONS.md`, lavoro tecnico in `IMPLEMENTATION_PLAN.md`.

## Principi

- **Ai clienti veri arriva solo il prodotto finito** (D-22): prima della V1 lo usano founder e tester.
- **Nessun canone per una funzione che non porta ancora valore** (spec §8.2): la priorità sugli
  ordini o il Premium si vendono solo quando esistono davvero.
- **Ricavi in quest'ordine:** abbonamenti dei fioristi → fee sugli ordini portati da Gardelia →
  aziende come intermediario → servizio gestito per le aziende, solo dopo che l'intermediario ha
  portato ricavi (D-25).

## Tappa 0 — V1 completa (adesso)

Prodotto, nell'ordine di `docs/V1_SCOPE.md` §5:

1. Ambiente online di prova (fatto: i rilasci su staging sono attivi).
2. Ordini, pagamenti registrati e consegne; link pubblici di preventivo e ordine; **marketplace per
   i clienti** (D-26, deciso dal founder il 23/11/2026): pagine pubbliche, ricerca per indirizzo,
   pagina di ogni fioreria, ordine del cliente registrato, pagamento diretto alla fioreria. Blocchi
   A1–C5 in `docs/ORDERS_MARKETPLACE_PLAN.md` (fatti; restano piccoli resti in `docs/V1_SCOPE.md`).
3. Inventario (fatto: ADR-060…063, scarico dagli ordini ADR-071).
4. Clienti completi: cronologia, etichette, import CSV (fatto, ADR-070).
5. Abbonamenti dei clienti e Floral Care.
6. Report.
7. Impostazioni della fioreria ed email ai clienti e al team.
8. Abbonamento a pagamento **sui livelli Esencial e Profesional** (D-23) e pannello della piattaforma.
9. Privacy nell'app.
10. Rifinitura, prova con i tester, Diseñador con foto vere.

Fuori dal codice, prima del lancio:

- interviste a 15–20 fioristi di Aguascalientes su prezzi e livelli (spec §15.4);
- prova da ~100 immagini AI: costo vero → prezzi dei crediti;
- commercialista e contador: chi fattura (O-02), IVA (O-06), domande di `docs/BUSINESS_MODEL.md` §6;
- revisione legale di termini e aviso de privacidad (O-07), compresi i termini per i consumatori del
  marketplace (PROFECO) e la privacy di chi compra; marchio all'IMPI (O-03);
- ✅ chiave di Google Places per gli indirizzi (O-14, creata il 24/11/2026);
- fase gratuita: se, quando e come (O-12).

**Traguardo:** V1 completa secondo `docs/V1_SCOPE.md` §3.

## Prima della produzione (passaggio a `prod`)

Il ramo `prod` si aggiorna solo con il via libera del founder (ADR-041). Prima del primo rilascio
in produzione servono le due liste qui sotto, oltre alla V1 completa. I dettagli tecnici sono in
`docs/PLATFORM_PLAN.md` e `docs/DEPLOY_VERCEL.md`.

### Sicurezza: "a prova di bomba" (PROPOSTO, 24/11/2026)

Le basi ci sono già. Il login è gestito da Better Auth 1.7.27 senza vulnerabilità note:

- email confermata e password di almeno 10 caratteri;
- limiti ai tentativi;
- sessioni con cookie sicuri;
- Google con PKCE e collegamento solo fra email verificate.

Ci sono anche isolamento fra fiorerie nel database, intestazioni di sicurezza e controllo delle
dipendenze nella CI. Mancano quattro cose:

1. **Verifica in due passaggi** (codice da un'app di autenticazione, con codici di recupero),
   obbligatoria per i proprietari e consigliata ai manager (P-09).
2. **Sessioni attive:** elenco dei dispositivi collegati e "Cerrar sesión en todos los
   dispositivos", anche per chi perde il telefono del negozio.
3. **Aggiornamenti e avvisi:**
   - aggiornamenti automatici delle dipendenze, provati dalla CI prima dell'unione;
   - scansione dei segreti nel repository;
   - Sentry con avvisi sugli accessi sospetti (tanti tentativi falliti, nuovo dispositivo del
     proprietario).
4. **Revisione di sicurezza esterna** (prova di intrusione) sull'ambiente di prova, con le
   correzioni fatte prima del lancio.

### Cose da preparare per la produzione

**Infrastruttura:**

- **Progetto Vercel `gardelia-production`:**
  - dominio definitivo (O-03);
  - variabili e segreti propri, mai copiati da staging (`BETTER_AUTH_SECRET` nuovo);
  - piano Pro per l'uso commerciale;
  - pubblica il ramo `prod`.
- **Database di produzione** (Neon a pagamento):
  - backup e ripristino a un momento preciso, con **una prova di ripristino fatta e scritta**;
  - ruoli separati per le migrazioni e per l'app, che non aggira la RLS (l'app si rifiuta di
    partire se può);
  - mai i dati demo.
- **Archivio delle immagini** (R2) e **chiave di fal.ai** propri della produzione, con un tetto
  mensile di spesa.
- **Email:** dominio verificato su Resend (SPF, DKIM, DMARC), così le email arrivano a tutti e non
  nello spam.
- **Google:**
  - chiave di Places della produzione, limitata alle API usate, con quote e avviso di spesa;
  - client OAuth del login con Google per il dominio vero, con la verifica del marchio (ADR-036).
- **Rilascio approvato:**
  - migrazioni prima del deploy, e il deploy usa lo stesso build provato su staging;
  - test di fumo dopo il deploy;
  - rollback in pochi secondi;
  - lavori giornalieri con Vercel Cron.
- **Monitoraggio:**
  - controllo che il sito risponda, con un avviso se è giù;
  - log conservati;
  - una guida su cosa fare in caso di incidente.

**Prodotto e regole:**

- **Piani:** livelli Esencial e Profesional riaccesi (`PLAN_FEATURES_ENFORCED`, D-23 e D-29) e
  pagamento con carta in modalità reale, dopo aver deciso chi incassa (O-02).
- **Testi legali** definitivi dopo l'avvocato (O-07):
  - via il riquadro "BORRADOR";
  - nuova versione registrata con ogni ordine;
  - caselle di consenso se l'avvocato le chiede;
  - dati della società.
- **Decisioni del founder sul marketplace:**
  - giorni per accettare un ordine;
  - ordini in attesa per cliente;
  - durata del cookie di attribuzione;
  - tienda en línea in tutti i livelli o no;
  - raggio predefinito.
- Contatto WhatsApp della piattaforma per l'acquisto dei crediti (`PLATFORM_WHATSAPP`) e
  fatturazione dei crediti con il contador (O-06).

**Traguardo:** le due liste sono complete e il founder dà il via libera al primo rilascio su `prod`.

## Tappa 1 — Lancio ad Aguascalientes

- Livelli **Esencial** e **Profesional**, crediti AI, utenti extra.
- Precio de fundador per i primi 20 fioristi (PROPOSTO).
- Si misura: quanti provano e restano, quale livello scelgono, quanto usano l'AI.

**Traguardo:** 30–60 fioristi paganti. Il pareggio è intorno ai 7 fioristi.

## Tappa 2 — Primi add-on

- **Studio** (foto degli ambienti): con lui apre il livello **Premium**.
- **Diseñador pubblico**: il cliente compone il ramo sul sito del fiorista.
- **Pagamenti online** dei clienti delle fiorerie, con fee dell'1–2% (D-24).
- **WhatsApp automatico** a consumo, **più sedi**, notifiche sul telefono.

**Traguardo:** il Premium ha funzioni vere e qualcuno lo compra.

## Tappa 3 — Marketplace: crescita

La base del marketplace è nella V1 (D-26). Qui arriva quello che serve quando ci sono clienti:

- pubblicità verso i privati e fee del 10–15% sugli ordini portati da Gardelia, incassata con il
  billing (D-24);
- ordini dei privati inviati a più fiorerie in zona, con la priorità a pagamento solo quando c'è
  volume;
- mappa nella ricerca, recensioni verificate.

**Traguardo:** ordini regolari, soprattutto nei picchi (14 febbraio, 10 maggio, 2 novembre,
12 dicembre).

## Tappa 4 — Aziende come intermediario

- Hotel indipendenti, ristoranti, uffici e cliniche di Aguascalientes, partendo da Floral Care.
- Fiorista titolare più riserve, ricetta standard del cliente, pagamento per consegna confermata,
  fee del 10% (D-25).
- Chi vende alle imprese è pagato a percentuale (O-13).

**Traguardo:** 10–20 imprese clienti e ricavi dalle fee, abbastanza da finanziare la tappa 5
(la soglia la fissa il founder).

## Tappa 5 — Aziende con servizio gestito (solo se la tappa 4 ha portato ricavi)

- Società messicana, fattura unica (CFDI), referente e report per sede, margine sul servizio.
- Poi le catene, con copertura in più città.

## Più avanti

- Più città in Messico; marketplace degli accessori; video in Studio; mercato italiano.
- **Organizzazioni per le catene** (D-28): un account crea organizzazioni e sotto ognuna più
  fiorerie; trasferimenti di merce e report insieme.

## Soglie da tenere d'occhio

| Soglia                                  | Cosa fare                                                          |
| --------------------------------------- | ------------------------------------------------------------------ |
| Primo incasso                           | partita IVA aperta e decisione O-02 presa                          |
| ~120 fioristi o 85.000 € l'anno         | società pronta prima, o si perde il forfettario e si guadagna meno |
| Prima catena o primo cliente multi-sede | società messicana e capitale per i pagamenti a 30–90 giorni        |
