# Il giro completo del marketplace: chi compra e chi vende

**Stato: studio del 25/11/2026, approvato dal founder come piano dei blocchi M0–M9 (D-30, ADR-086).**
Ogni blocco ha poi il suo piano di dettaglio da approvare.

## Perché

Il founder, provando staging (25/11/2026): «manca tutta la parte del cliente». Sulla pagina della
fioreria il cliente deve poter scegliere un ramo o un fiore, creare il suo ramo con il Diseñador,
oppure chiedere uno dei servizi della fioreria (Floral Care è uno); quando compra un ramo gli si
propone Floral Care; ordini e prenotazioni arrivano nell'app del fiorista, che approva. **Tutto
nell'app, senza WhatsApp né email avanti e indietro.** «Mettiti nei panni del cliente e del
fiorista, sii minuzioso, ogni flusso nel minimo dettaglio.»

Questo documento è lo studio fatto leggendo pagina per pagina il codice di chi compra, del
fiorista, del Diseñador, della disponibilità di Floral Care e degli ordini online. Per ogni passo:
**oggi** (cosa c'è), **manca**, **proposta** con il blocco. I nomi delle pagine sono quelli
dell'app in italiano; il cliente vede la fioreria in spagnolo (lingua del mercato, ADR-042).

## Decisioni del founder (25/11/2026)

- **Floral Care chiesto dal cliente:** il prezzo arriva **subito dalle piante dichiarate** (quante e
  di che misura); il cliente prenota fra le fasce libere; alla prima visita il fiorista corregge se
  le piante sono diverse.
- **Pagamenti:** resta il **pagamento diretto alla fioreria** (D-26); online dopo, quando ci sono la
  società che incassa e il parere fiscale (O-02).
- **Servizi predefiniti** per ogni fioreria: **Floral Care, Eventi e matrimoni, Decorazione di
  locali, Fiori ogni settimana**, più **i servizi scritti dal fiorista**.
- **«Disegna il tuo ramo»** per il cliente: **dopo** Floral Care e i servizi.
- **Assistente delle piante:** prezzo al mese deciso dal fiorista, che lo compra da Gardelia e ci
  mette il suo ricarico; domande comprese ogni mese, pacchetti chiesti dal cliente e approvati dal
  fiorista, domande comprate non rimborsate a fine contratto (ADR-085).

Già fatto prima di questo studio (blocchi C1–C5 di `docs/ORDERS_MARKETPLACE_PLAN.md`): conto del
cliente, home e ricerca delle fiorerie, vetrina con i prodotti, ordine online con accettazione del
fiorista, pagamento diretto, stato ed email, scadenza, bozze legali. L'ordine online si vede solo con
«Ordini online» acceso in Impostazioni → Negozio online.

## 1. Chi compra, passo per passo

### C1. Trovare la fioreria (`/`, `/buscar`)

- **Oggi:** ricerca per città (anche senza conto) o per indirizzo (solo con il conto: Google Places
  non accetta chiamate anonime); risultati per distanza, con km e numero di prodotti.
- **Manca:** occasioni (cumpleaños, aniversario, 10 de mayo); sulle schede costo di consegna, primo
  giorno libero e se la fioreria prende ordini online; il passo «Pide por WhatsApp» della home è
  vecchio; il raggio della ricerca e il controllo dell'ordine possono non coincidere (ADR-069);
  città con lo stesso nome in stati diversi si uniscono.
- **Proposta:** M0 il testo della home; M1 schede con «ordina online», costo e primo giorno,
  occasioni come scorciatoie; M4 un raggio solo per ricerca e ordine.

### C2. La vetrina della fioreria (`/f/[slug]`)

- **Oggi:** copertina, logo, presentazione, «Hacer un pedido», griglia di prodotti per nome (al
  massimo 120, il resto sparisce senza dirlo), poi orari, consegne e pagamenti.
- **Manca:** categorie (Ramos, Flores, Plantas, Accesorios) e occasioni; ricerca; prodotti in
  evidenza e ordinamento; sezione **Servizi**; in alto le cose utili (primo giorno di consegna,
  anticipo, costo); politiche della fioreria (cambi, cancellazioni, sostituzioni); link a «Mi
  cuenta» e ai miei ordini; Google non la indicizza (`robots: noindex` nel layout) e non c'è la
  sitemap.
- **Proposta:** M1 testata con ordine online, primo giorno e costo; schede per categoria; evidenza
  scelta dal fiorista; ricerca; pagine da 24; politiche (testo della fioreria); indicizzazione
  delle pagine pubbliche solo in produzione, sitemap e anteprime per WhatsApp; M5 sezione Servizi.

### C3. Il prodotto (`/f/[slug]/p/[id]`)

- **Oggi:** una foto grande e miniature che non si aprono; prezzo; «Incluye» per i ramos; colori e
  misura solo come testo; «Pedir en línea» e «Pedir por WhatsApp».
- **Manca:** galleria con zoom; **opzioni** (misura chica, mediana, grande con il suo prezzo; colore
  di carta e nastro); **extra** (vaso, globo, chocolates); quantità e «aggiungi» dalla pagina; primo
  giorno di consegna; per le piante cura e avviso per cani e gatti (i dati ci sono già in
  `CanonicalFlower.care`); simili e «avvisami» quando torna; foto nell'anteprima di WhatsApp
  (nessuna immagine Open Graph); un prodotto tolto dice «Esta tienda no está disponible».
- **Proposta:** M0 prodotto tolto; M1 galleria, quantità e aggiungi, anteprima WhatsApp, cura delle
  piante; M2 opzioni ed extra, «Armalo en ramo» per i fiori a stelo; upsell di Floral Care sulle
  piante (M6).

### C4. L'ordine (`/f/[slug]/pedido`)

- **Oggi:** conto obbligatorio prima del modulo (D-26); 4 passi (Prodotti, Consegna, Tarjeta,
  Conferma); fino a 20 prodotti; consegna o ritiro; giorno, fascia, indirizzo con Google, chi
  riceve, tarjeta, commenti; «Enviar pedido»; al massimo 3 ordini in attesa per fioreria.
- **Manca:** il carrello non resta fra le pagine; il prodotto di partenza non è in cima; il
  calendario non mostra giorni chiusi né pieni; oggi si possono scegliere fasce già passate;
  nessuna capienza; nel riepilogo mancano chi riceve e la tarjeta; il totale può essere «senza
  consegna»; niente codice promo, consenso alle promo, fattura; solo telefoni messicani; più
  destinatari insieme (10 de mayo) scomodo; l'errore «no se puede cotizar» è quello dei preventivi.
- **Proposta:** M0 errore giusto; M1 carrello che resta, prodotto in cima, riepilogo completo; M2
  opzioni ed extra; M4 calendario con chiusi e pieni, ora limite, capienza; M8 codice promo,
  consenso, telefoni di altri paesi.

### C5. Dopo l'ordine (`/pedido/[token]`, email, «Mis pedidos»)

- **Oggi:** pagina di stato con le tappe; email per ricevuto, accettato (con come pagare),
  rifiutato, scaduto, cancellato; «Cancelar» solo in attesa; per parlare con la fioreria solo
  WhatsApp.
- **Manca:** **messaggi con la fioreria dentro l'ordine**; avvisi per «En preparación», «En camino»,
  «Entregado» con la foto; i cambi del fiorista (prodotto, data, costo) che il cliente **accetta o
  rifiuta nell'app**; prova di pagamento e ricevuta; chiedere un cambio dopo l'accettazione;
  dettaglio in «Mis pedidos» e «ordina di nuovo»; recensione; il link scade 60 giorni dopo
  l'ordine, anche se la consegna è più avanti.
- **Proposta:** M0 durata del link; M3 tutto il resto tranne le recensioni (M8).

### C6. Il conto (`/cuenta`)

- **Oggi:** ordini online, Mi Floral Care, dati, indirizzi, sicurezza, privacy.
- **Manca:** **le mie date speciali** con promemoria; le richieste di servizio e le prenotazioni;
  preferiti; gli ordini fatti al banco non compaiono.
- **Proposta:** M3 dettaglio e riordino; M5 e M6 richieste e prenotazioni; M8 date speciali.

### C7. I servizi della fioreria (nuovo, M5)

- Sezione «Servicios» nella vetrina con i servizi pubblicati: i predefiniti **Floral Care, Eventi e
  matrimoni, Decorazione di locali, Fiori ogni settimana** (ognuno acceso o spento) e quelli del
  fiorista (nome nelle tre lingue, descrizione, foto, prezzo «da»). Ognuno ha la sua pagina e
  «Richiedi», con un modulo adatto:
  - Eventi e matrimoni: data, luogo, tipo di evento, invitati, budget, foto di ispirazione;
  - Decorazione di locali: indirizzo, tipo di locale, una volta o periodica, foto, budget;
  - Fiori ogni settimana: indirizzo, giorno e fascia, budget a consegna, per quanto;
  - servizio del fiorista: data e indirizzo facoltativi, foto, messaggio.
- Il cliente segue la richiesta in «Mi cuenta» (stato e messaggi). Il fiorista risponde con una
  **cotización** (esiste già, con link e «Aceptar») che il cliente accetta nell'app; accettata
  diventa un ordine (eventi, decorazioni) o un abbonamento (Fiori ogni settimana, M7).

### C8. Floral Care prenotato dal cliente (nuovo, M6)

1. Dalla vetrina, «Floral Care»: cosa si fa a ogni visita, frequenze, prezzo «da $X a visita».
2. «Prenota»: indirizzo, piante dichiarate (quante chicas, medianas, grandes; foto facoltative),
   frequenza; **il prezzo arriva subito** dalle tariffe del fiorista, distanza compresa, a visita e
   al mese.
3. Sceglie la fascia fra quelle con posto, o le date una per una con «Date scelte a mano», e il
   primo giorno; poi gli extra e l'**Assistente delle piante** con il prezzo al mese del fiorista e
   le domande comprese.
4. Legge i termini della fioreria e invia. La richiesta resta «In attesa» e non tiene posti.
5. Il fiorista accetta e il contratto parte da solo: cliente e indirizzo creati o collegati,
   visite in agenda, Mi Floral Care aperto. Oppure propone un'altra fascia, o rifiuta con un motivo.
6. Alla prima visita, se le piante sono diverse, il fiorista le corregge: il nuovo prezzo arriva al
   cliente, che lo accetta in Mi Floral Care e vale dal mese dopo.

Fatti dal codice: oggi nessuna richiesta esiste; una bozza non ha visite, non tiene posti e il
cliente non la vede; la disponibilità si calcola con `openSlotBook(…, { lock: false })` e verso il
pubblico va detta solo come «libero / non libero» con i posti fissati dal server (altrimenti si
indovina l'occupazione); il collegamento conto ↔ cliente oggi passa solo dall'invito
(`CarePortalAccess`); l'ordine online già trova il cliente per email o lo crea
(`marketplace-orders.ts`).

### C9. Upsell (M2, M6, M8)

- Dopo un ordine (pagina «¡Listo!», email di accettazione) e sulle piante: «¿Tienes plantas? Te las
  cuidamos: Floral Care desde $X». Nell'ordine, gli extra (M2).

### C10. Disegna il tuo ramo (M9, dopo servizi e Floral Care)

- Il cliente sceglie fiori con foto, verde, carta e nastro con i colori; vede prezzo e schizzo
  subito; l'anteprima con l'IA usa i crediti del fiorista, con un limite al giorno per persona e
  per fioreria e un budget suo, separato da quello di tutte le fiorerie (oggi 50 USD al mese in
  comune); l'ordine arriva «Da accettare» con immagine e ricetta.
- Serve aprire al pubblico anche verde, carta e vasi (oggi non si possono mettere online:
  `ONLINE_ITEM_TYPES` e un CHECK) con un consenso del fiorista per ogni articolo; il flag «usabile
  nel Diseñador» non vale come consenso. Le regole di composizione e prezzo
  (`domain/src/builder.ts`) si riusano così come sono.

## 2. Chi vende, passo per passo

### F1. Preparare il negozio (Impostazioni → Negozio online)

- **Oggi:** pubblica o ritira, presentazione, logo e copertina, forme e dati di pagamento, ordini
  online, anticipo minimo; il link si condivide solo dopo aver pubblicato.
- **Manca:** anteprima prima di pubblicare; categorie ed evidenza; politiche; social; QR; il link
  `/f/…` ben visibile (Impostazioni mostra quello del gestionale); tempo per accettare regolabile
  (oggi 3 giorni fissi); solo consegna o solo ritiro.
- **Proposta:** M1 anteprima, evidenza, politiche, QR e link; M4 consegna o ritiro, tempo per
  accettare.

### F2. I prodotti in vendita (Catalogo)

- **Oggi:** interruttore «Tienda en línea» per riga e nel modulo; fino a 12 foto, la copertina è
  sempre la prima; nessuna opzione.
- **Manca:** filtro «Online» e accensione per più prodotti insieme; scegliere la copertina e
  l'ordine delle foto; opzioni ed extra; avviso se manca la foto; «Incluye» mostra sempre tutte le
  righe della ricetta, carta compresa.
- **Proposta:** M1 filtro, accensione insieme, copertina e ordine delle foto, avviso; M2 opzioni ed
  extra, cosa mostrare in «Incluye».

### F3. Consegne e capienza (Impostazioni → Consegne)

- **Oggi:** fasce uguali tutti i giorni, giorni chiusi per giorno della settimana, costo fisso o per
  distanza, raggio mostrato ma non applicato all'ordine; un indirizzo scritto a mano salta il
  controllo della zona.
- **Manca:** capienza per fascia e giorno; ora limite per il giorno stesso; date chiuse (festivi,
  vacanze, come i blocchi di Floral Care); fasce diverse per giorno; raggio applicato; giorni di
  punta.
- **Proposta:** M4.

### F4. Arriva un ordine o una richiesta

- **Oggi:** email ai proprietari e gerenti, senza prodotti né indirizzo; avviso e filtro «Por
  aceptar» negli ordini. Nessun numero nel menu, niente nel pannello, nessun promemoria prima della
  cancellazione dopo 3 giorni, nessuna email al fiorista quando scade.
- **Proposta (M3):** «Da gestire» nel pannello (ordini da accettare, richieste, prenotazioni,
  messaggi non letti) e numeri nel menu; email completa con «Accetta»; promemoria 24 ore prima
  della scadenza e avviso quando scade; scadenza visibile; segno «Online» nelle liste e in «Escono
  oggi».

### F5. Accettare, proporre cambi, rifiutare

- **Oggi:** accetta o rifiuta con motivo; prima di accettare cambia data e consegna ma non i
  prodotti (il testo del pannello dice il contrario); dopo cambia tutto **senza avvisare il
  cliente**; accetta anche con consegna a 0 senza nessun avviso.
- **Proposta:** M0 avviso con consegna a 0 e testo coerente; M3 **«Proponi un cambio»** (prodotto,
  data, fascia, costo) che il cliente accetta o rifiuta nell'app, motivi di rifiuto pronti,
  «proponi un'altra data».

### F6. Preparare e consegnare

- **Oggi:** Confermato → In preparazione → Pronto → In consegna → Consegnato o Ritirato; foto e chi
  riceve; ruta, comanda e tarjeta. Il cliente vede tutto solo nella pagina di stato.
- **Proposta (M3):** ogni passo avvisa il cliente, e «Consegnato» manda la foto; avviso al
  fattorino assegnato; stampa insieme di comande e tarjetas del giorno.

### F7. Soldi (pagamento diretto, D-26)

- **Oggi:** «Registra pagamento» a mano (proprietario e gerente); nessuna prova dal cliente, nessuna
  ricevuta, nessun rimborso; il fattorino non registra il contante; i dati di pagamento sono
  pubblici anche prima dell'accettazione.
- **Proposta (M3):** il cliente carica la prova di pagamento nell'ordine e il fiorista la conferma
  con un tocco (diventa un pagamento); ricevuta per email; anticipo richiesto (es. per gli eventi);
  il fattorino segna il contante e il gerente lo conferma (come «Cobré en la visita» di Floral
  Care); rimborso registrato su un ordine cancellato; dati di pagamento solo dopo l'accettazione.

### F8. Messaggi (M3)

- Oggi solo in Floral Care (ADR-084). Proposta: un filo di messaggi con foto per ogni ordine,
  richiesta e prenotazione, nell'app del fiorista e in «Mi cuenta», con il riassunto giornaliero
  come Floral Care. I pulsanti WhatsApp restano come alternativa, ma non servono più.

### F9. Servizi e richieste (M5)

- Impostazioni → Servizi in vetrina: i quattro predefiniti (accesi o spenti, testi, foto e
  traduzioni) e quelli del fiorista, ognuno con le sue domande.
- Voce nuova «Richieste»: elenco con stato, dettaglio con dati e foto del cliente, messaggi,
  «Prepara preventivo» già compilato, «Rifiuta». Il preventivo accettato diventa ordine o
  abbonamento.

### F10. Prenotazioni di Floral Care (M6)

- In Floral Care, scheda «Prenotazioni»: piante dichiarate, prezzo calcolato, fascia o date, extra
  e assistente, distanza; «Accetta» (il contratto parte da solo), «Proponi un'altra fascia»,
  «Rifiuta».
- Alla prima visita «Correggi le piante»: il nuovo prezzo va al cliente.
- Assistente: prezzo al mese e domande comprese in Impostazioni → Floral Care; pacchetti chiesti
  dal cliente e approvati dal fiorista (ADR-085).
- «Date scelte a mano» anche per i contratti creati dal fiorista.

### F11. Clienti e marketing

- **Oggi:** il cliente online entra nel CRM per email, senza consenso; **errore**: se l'email esiste
  già, il telefono dell'ordine non arriva alla fioreria; **errore**: il canale «online» si cancella
  modificando il cliente; niente date speciali dal cliente; promo solo via WhatsApp.
- **Proposta:** M0 i due errori; M8 consenso nell'ordine, date speciali e destinatari salvati,
  codici promo usabili online, «ordina di nuovo», recensioni dopo la consegna con la risposta del
  fiorista.

### F12. Report (M8)

- Oggi niente separa negozio e online. Proposta: vendite per canale; ordini online accettati,
  rifiutati e scaduti; tempo medio di risposta; fee del marketplace stimata (D-24).

### F13. Squadra (M3)

- Oggi lo staff vede gli ordini ma non accetta, non segna il contante, non riceve avvisi. Proposta:
  avvisi per persona, contante segnato dal fattorino e confermato dal gerente, accettazione per lo
  staff se il proprietario la attiva.

## 3. I blocchi, in quest'ordine

| Blocco | Cosa                                                                                                                                                                          | Perché                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **M0** | Correzioni subito (sotto)                                                                                                                                                     | errori che fanno perdere clienti  |
| **M1** | Vetrina che vende: categorie, ricerca, evidenza, pagine, info in alto, galleria, carrello che resta, anteprima e QR, filtro e accensione insieme, Google e anteprime WhatsApp | oggi è scarna                     |
| **M3** | Ordine tutto nell'app: messaggi, avvisi a ogni passo, cambi proposti e accettati, prova di pagamento e ricevuta, «Da gestire» e promemoria, fattorino e contante              | basta WhatsApp e email            |
| **M5** | Servizi della fioreria e richieste con preventivo                                                                                                                             | il cliente chiede tutti i servizi |
| **M6** | Floral Care prenotabile: prezzo subito, fasce libere, date a mano, assistente col prezzo del fiorista, correzione alla prima visita                                           | la richiesta principale           |
| **M2** | Opzioni ed extra, «Armalo en ramo», upsell nell'ordine                                                                                                                        | ordini più ricchi                 |
| **M9** | Disegna il tuo ramo                                                                                                                                                           | dopo servizi e Floral Care        |
| **M4** | Calendario e capienza: pieni, festivi, ora limite, raggio                                                                                                                     | prima del 14 febbraio             |
| **M8** | Clienti e marketing (consenso, date speciali, promo online, riordino, recensioni) e report online                                                                             | clienti che tornano               |
| **M7** | Fiori ogni settimana come abbonamento con ordini automatici                                                                                                                   | dopo M5                           |

Ogni blocco ha il suo piano di dettaglio da approvare, test (unit, integrazione con isolamento
A↔B, E2E a 320 px), CI verde, staging con il via libera del founder.

## 4. M0, correzioni subito (fatto il 25/11)

- **Telefono perso:** se l'email di chi ordina corrisponde a un cliente della fioreria senza
  telefono, il telefono dell'ordine si salva sul cliente; quello già salvato dal fiorista non si
  tocca mai. Nel pannello «Da accettare» dell'ordine c'è la riga «Cliente:» con nome, telefono (si
  tocca per chiamare) ed email (si tocca per scrivere).
- **Canale online:** `online_store` («Negozio online») fra i canali del cliente, così modificare la
  scheda non lo cancella più.
- **Testi:** il terzo passo della home ora è «Ordina online o su WhatsApp»; in Impostazioni →
  Negozio online, con gli ordini online accesi, il testo dice che i clienti mandano ordini da
  accettare o rifiutare lì; il pannello «Da accettare» dice cosa si cambia davvero (data, consegna e
  costo; i prodotti no).
- **Errore dell'ordine:** al posto di «no se puede cotizar», un messaggio generale («Un prodotto che
  hai scelto non è più disponibile: toglilo e invia di nuovo l'ordine») e, accanto al prodotto da
  togliere, «Non è più disponibile: metti 0 per toglierlo». Il nome si vede perché l'errore sta
  sulla riga del prodotto (i codici di validazione non portano parametri).
- **Consegna a 0:** un ordine a domicilio con il costo a 0 si accetta solo da una finestra «Consegna
  gratis?» («Accetta con consegna gratis»), che invita a mettere il costo prima se c'è; il servizio
  rifiuta l'accettazione senza la conferma e il registro la ricorda (`freeDelivery`).
- **Prodotto tolto:** il link di un prodotto tolto dalla vetrina (o mai esistito) mostra «Este
  producto ya no está disponible» con «Ver los productos de …»; «tienda no disponible» resta solo
  per una vetrina che non c'è.
- **Link di stato:** vale fino a 30 giorni dopo la consegna (mai meno dei soliti 60 giorni), anche
  per i link della conferma degli ordini del banco; se il fiorista sposta la consegna più in là, il
  link attivo si allunga (mai accorciato, mai riaperto se scaduto o disattivato).
- **Test:** dominio (scadenza del link, conferma della consegna a 0, canale), integrazione
  (telefono solo se mancava, canale conservato, consegna a 0, link che segue la consegna, errore
  accanto al prodotto), E2E dell'ordine online (riga del cliente, finestra della consegna gratis a
  320 px, ramo tolto mentre si ordina, prodotto che non c'è più).

## 5. M1, la vetrina che vende (fatto il 25/11)

Piano approvato il 25/11 (ADR-087), in due rilasci.

- **M1-1 «Vetrina e prodotto» (fatto):**
  - vetrina con testata (ordini online, primo giorno, costo, ritiro), «Destacados», schede,
    ricerca senza accenti, ordine, pagine da 24 e politiche della fioreria;
  - prodotto con galleria a schermo intero, quantità, «Agregar al pedido» e «Pedir ahora», primo
    giorno di consegna, cura e cani e gatti per le piante (solo dai nostri dati), anteprima su
    WhatsApp con la foto;
  - carrello nel cookie della fioreria con la barra «Tu pedido»; nel modulo d'ordine i prodotti del
    carrello in cima, gli altri sotto «Agregar otros productos», il calendario dal primo giorno
    aperto e il riepilogo completo (chi riceve, tarjeta, commenti, politiche);
  - per il fiorista: stella «In evidenza» nel Catalogo, copertina e ordine delle foto, schede
    «Politiche del negozio» e «In evidenza» in Impostazioni → Negozio online.
- **M1-2 «Strumenti e visibilità» (fatto):**
  - Impostazioni → Negozio online: «Completa la tua vetrina» (8 passi con il link al punto dove si
    fanno), link sempre visibile, QR da scaricare e «Anteprima» per proprietario e gerente;
  - Catalogo: filtro «Negozio online» (sì, no, senza foto), fino a 20 prodotti accesi o spenti
    insieme, segno «Senza foto» e avviso;
  - ricerca delle fiorerie: schede con ordini online o WhatsApp, primo giorno e costo (preciso per
    l'indirizzo cercato);
  - Google solo con `PUBLIC_INDEXING` acceso in produzione: robots.txt, sitemap.xml, canonici e
    dati strutturati; staging resta fuori;
  - occasioni: voce nella scheda del prodotto, chip nella vetrina, scorciatoie nella home e nella
    ricerca;
  - «Mis pedidos / Entrar» nella testata della vetrina.
  - L'E2E della pagina 2 della vetrina accende 25 prodotti insieme e poi li rispegne.

## 6. M3, l'ordine tutto nell'app (M3-1 su staging il 26/11)

Piano di dettaglio approvato il 26/11 (ADR-088), in tre rilasci: M3-1 «Messaggi e avvisi», M3-2
«Cambi da confermare», M3-3 «Soldi e squadra».

- **M3-1 «Messaggi e avvisi» (su staging, 26/11):**
  - chi compra: la pagina dell'ordine in «Mis pedidos» (`/cuenta/pedidos/<id>`) con i passi, la
    consegna, la tarjeta, i prodotti, come pagare dopo l'accettazione, «Cancelar pedido» finché è da
    accettare (con la scadenza) e «Pedir de nuevo» quando è chiuso; «N mensajes nuevos» sulle righe;
    il link di stato resta da inoltrare, senza messaggi, con il rimando al conto;
  - messaggi nei due sensi con una foto, «da leggere» e «nuovi», avviso per email al primo da
    leggere e di nuovo dopo 6 ore, mai con il testo; si scrive fino a 7 giorni dopo la chiusura;
  - email a «En preparación», «Listo» (solo ritiro), «En camino», «Entregado», una volta sola;
    «Cambió tu pedido» con la casella in «Cambia consegna e biglietto» o con «Avvisa il cliente dei
    cambi»;
  - il fiorista: «Da gestire» in cima alla Home, numero su «Ordini» per gli ordini da accettare,
    filtro «Con mensajes por leer», segni «En línea», scadenza visibile, «Rifiuta» con i motivi
    pronti; email del nuovo ordine completa, promemoria prima dell'annullamento automatico ed email
    alla fioreria quando succede;
  - le foto dei messaggi si cancellano 30 giorni dopo la chiusura; i messaggi sono in «Descargar mis
    datos» e nello ZIP della fioreria.
- **M3-2 e M3-3:** da fare, con lo stesso piano (ADR-088).

## PROPOSTO (da confermare)

- In Floral Care i «Servizi» (irrigazione, pulizia delle foglie…) si chiamano «Lavori della visita»,
  per non confonderli con i servizi della vetrina.
- L'ordine dei blocchi qui sopra.
- Richieste e prenotazioni non tengono posti finché il fiorista non accetta.
- Pagine pubbliche indicizzate da Google solo in produzione (staging resta nascosto).

## DA VALIDARE con professionisti

- Termini per i consumatori (PROFECO): cambi, cancellazioni, rimborsi, prova di pagamento, prezzo di
  Floral Care corretto dopo la prima visita.
- Aviso de privacidad: foto della prova di pagamento e delle piante.
- Fatture (CFDI) della fioreria al cliente: fuori da Gardelia per ora.
