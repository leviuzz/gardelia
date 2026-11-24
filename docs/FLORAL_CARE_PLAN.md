# Floral Care, consegne periodiche e Asistente de plantas — piano

Piano approvato dal founder il 24/11/2026 (risposte nel §2). I blocchi 1 (ADR-075) e 2 (2a e 2b,
ADR-078) sono fatti; i blocchi seguenti seguono quest'ordine. Le etichette DECISO / PROPOSTO / DA VALIDARE valgono come nella
spec: una proposta non diventa decisione senza il founder.

## Contesto

Punto 5 della lista V1 (SUB-01 abbonamenti dei clienti, CARE-01 Floral Care). Il founder (24/11)
vuole:

- Floral Care configurabile: prezzo per uscita, il cliente sceglie quante uscite, più il care;
- un calendario dei lavori separato da quello degli eventi, con le uscite per fascia oraria;
- fasce scelte dal fiorista fra cui sceglie il cliente;
- blocchi e cambi con avviso e casella obbligatoria "Sí, avisé al cliente";
- raggio d'azione, servizi nostri più quelli del fiorista;
- una pagina del cliente con quanto ha pagato, le visite, i messaggi con fiorista o AI e le
  foto, cancellate da R2 a fine servizio;
- un assistente AI delle piante, nostro, venduto come add-on e pagabile dal cliente;
- consegne periodiche con gli ordini collegati e visibili insieme.

Risultato: il fiorista vende e gestisce i contratti di cura delle piante senza WhatsApp né
quaderni; il cliente ha una pagina sua; ogni visita lascia la prova (ora, checklist, foto).

## 1. Come lo vivono il fiorista e il cliente

**Il fiorista, una volta sola** (Ajustes → Floral Care):

1. Sceglie tariffa per uscita, care per pianta secondo la misura (chica, mediana, grande),
   frequenze offerte, raggio e sovrapprezzo per distanza.
2. Fissa le regole: preavviso per spostare, cliente che non apre, piante morte. Scrive il testo
   dei termini.
3. Sceglie i servizi: la nostra lista (riego, limpieza de hojas, poda, revisión de plagas,
   fertilización, sustrato, trasplante, rotación, limpieza de macetas) più i suoi. Ognuno è
   incluso o extra, con prezzo.
4. Crea le fasce di uscita per giorno della settimana con la capienza (es. martes 9–12, 2 visite).
5. Un simulatore mostra subito il canone: "10 piante medianas, 2 uscite al mese = $X al mes".

**Il fiorista, per ogni cliente:**

1. Dalla scheda del cliente, "Nuevo contrato Floral Care": sceglie la sede.
2. Fa la **prima visita di diagnosi**: registra le piante (anche a gruppi: "12 potos en
   jardinera"), con foto, misura e posizione.
3. Sceglie frequenza e fascia; il server calcola il canone. Il contratto resta in borrador
   finché il prezzo non è confermato.
4. Annota i dati pratici della sede: persona di contatto, orari di accesso, gafete, parcheggio,
   giorni chiusi.
5. Invita il cliente al portale (email) oppure gli manda il link per WhatsApp.

**Il fiorista, ogni giorno:**

- **Agenda**: consegne e visite per fascia e persona, giorno e mese, ruta con le une e le altre.
- Alla visita, dal telefono:
  1. "Empezar visita";
  2. checklist dei servizi;
  3. stato di ogni pianta (bien, atención, problema, muerta), con "todas bien" per fare prima;
  4. foto una alla volta, con salvataggio a ogni passo (in un locale il segnale può mancare);
  5. materiali, che escono dall'inventario;
  6. "Terminar visita": il cliente riceve il resoconto.
- Lo staff fa le visite ma non prepara preventivi, non registra pagamenti e non tocca
  l'inventario fuori dalla visita. Segnala "reposición" o "extra" al gerente. Se incassa sul
  posto, lo segna come "por registrar".
- Imprevisti:
  - cliente chiuso → "No se pudo realizar", con la regola del contratto;
  - pianta morta → sostituzione inclusa o preventivo;
  - **visita extra** ("evento el viernes"), alla tariffa per uscita, fuori dal conto del mese;
  - **cambio di stagione** (cempasúchil, nochebuena), con un preventivo e le visite di
    installazione e ritiro; quelle piante restano fuori dal canone e niente si rinnova da solo;
  - **vacanze del fiorista o persona malata**: blocca i giorni e sposta o scala le visite tutte
    insieme. Cambiare solo la persona assegnata, senza cambiare l'ora, non chiede avviso.
- Ogni cambio che tocca visite già fissate mostra i clienti toccati, propone le nuove date, offre
  l'email e non salva senza "Sí, avisé al cliente".

**Il fiorista, i soldi:**

- All'inizio di ogni mese c'è il cargo di ogni contratto; registra i pagamenti a mano e vede chi
  è in ritardo.
- Un'azienda con più sedi riceve un solo estado de cuenta.

**Il cliente:**

1. Accetta l'invito, crea il conto (o entra con Google) e trova **Mi Floral Care**:
   - cosa ha contrattato e quanto paga, cargos pagati e da pagare (paga alla fioreria);
   - prossime visite con "Cambiar fecha" fra le fasce libere, nello stesso mese, con il preavviso;
   - resoconti con foto, chi è venuto e quando;
   - le piante con le istruzioni fra una visita e l'altra;
   - messaggi con la fioreria (con foto);
   - l'asistente de plantas: prima le consultas incluse dalla fioreria, poi le sue, comprate
     con la carta.
2. Senza email o senza conto: il fiorista gli manda il resoconto con un link firmato, come quello
   per seguire un ordine (ADR-056), oppure lo stampa.
3. A fine contratto: avviso che le foto si cancellano 30 giorni dopo.

## 2. Decisioni

**DECISO dal founder (24/11):**

- prezzo Floral Care: tariffa per uscita + care per pianta secondo la misura + servizi extra; il
  cliente sceglie le uscite e il canone si calcola da solo;
- si parte da Floral Care; le consegne periodiche vengono dopo, con gli ordini collegati e una
  vista d'insieme;
- il cliente sposta una visita solo nello stesso mese, fra le fasce libere, con il preavviso del
  fiorista;
- pagamenti di contratti e ordini registrati a mano;
- ricariche dell'assistente pagate dal cliente a Gardelia, fin dall'inizio dell'assistente.
  Questo cambia D-26 ("nessun pagamento online nella V1") solo per le consultas;
- agenda dei lavori separata dal calendario degli eventi;
- "Sí, avisé al cliente" obbligatorio sui cambi che toccano visite fissate;
- foto cancellate da R2 a fine servizio;
- vasi autoirriganti e irrigazione fuori per ora;
- (blocco 2) l'Agenda nella barra in basso del telefono al posto di Clientes, che passa in "Más";
- (blocco 2) una visita extra si fissa in un orario di visita, e conta i posti, oppure a un'ora
  libera, che non tocca i posti e i clienti non possono scegliere.

**PROPOSTO da me (da confermare guardando il piano):**

- frequenze: 1 o 2 volte al mese in giorni fissi (1º, 1º e 3º martes), oppure ogni settimana in
  1–3 giorni (gli hotel lo chiedono). Il cargo conta le visite davvero programmate nel mese;
- preavviso predefinito 24 ore; foto cancellate 30 giorni dopo la fine;
- **Agenda** nuova voce del menu (lavoro). Raccoglie "Hoy salen", il mese degli ordini e la ruta
  di oggi, allargati alle visite; aggiorna ADR-057. **Calendario** resta per le date dei
  clienti;
- giorni di punta bloccati per proposta (14 feb, 10 may, 1–2 nov, 12 dic);
- raggio di Floral Care suo, che parte dal raggio di consegna già impostato (`deliveryRadiusKm`),
  detto chiaramente nella pagina;
- specie dalla lista che c'è già (17 piante da vaso), allargata con le piante d'interno più
  comuni (palmas, dracena, calathea, aglaonema, filodendro) e con i dati di cura e tossicità
  rivisti da un fiorista;
- le consegne periodiche creano l'ordine 2 giorni prima, non 7: altrimenti l'inventario mostra
  mancanze tutta la settimana.

**DA VALIDARE con professionisti:**

- termini del contratto fra fioreria e cliente: li scrive la fioreria, noi non inventiamo
  condizioni;
- aviso de privacidad: foto dei locali, messaggi, AI di un fornitore esterno;
- vendita di consultas a consumatori in Messico da parte di Gardelia:
  - possibile registrazione al SAT e IVA per i servizi digitali di fornitori esteri;
  - CFDI;
  - PROFECO, rimborsi;
  - quale società incassa (O-02, ancora aperto);
- dati di tossicità delle piante;
- il cargo dice "Precios finales, sin impuestos (O-06)": non è una factura.

## 3. Le regole

**Soldi (una regola sola):**

- Il cargo nasce all'inizio del mese dalle visite programmate, con la data di scadenza, e poi non
  si modifica più.
- Il primo mese è in proporzione alle visite che restano.
- Ogni variazione va sul cargo del mese dopo:
  - visita cancellata dalla fioreria e non recuperata: credito;
  - cliente che non apre: la regola del contratto;
  - spostata nello stesso mese: niente;
  - extra fatti e visite extra: si aggiungono.
- Il prezzo è copiato in ogni versione del contratto: un cambio di prezzo vale dal mese dopo.
- Il care per pianta si conta per visita (pianta × misura × uscite).

**Fasce e capienza:**

- Ogni prenotazione passa da una sola funzione: generazione, spostamento del fiorista,
  spostamento del cliente, spostamento automatico.
- Blocca le righe delle fasce in ordine (niente stalli) e conta le visite vive di quel giorno.
- Un contratto grande (un ufficio con 80 piante) può occupare più posti.
- Abbassare la capienza, archiviare una fascia o aggiungere un blocco è un cambio con avviso.

**Visite:**

- Si creano alla conferma del contratto per circa 60 giorni; la manutenzione allunga ogni giorno,
  un contratto per transazione e con un limite per giro.
- Una visita è unica per contratto, versione del calendario e data originale. Le cancellate
  restano come righe.
- Tutte le date e le ore sono nel fuso della fioreria. Una visita spostata in automatico resta
  nello stesso mese, altrimenti diventa "Por reprogramar".

**Portale e accesso:**

- Collegamento cliente ↔ persona: più persone per un cliente, anche limitate a un contratto.
  Nasce da un invito (7 giorni, stessa email) e si revoca a mano, quando il cliente si archivia o
  quando il contratto finisce.
- La persona vede solo i contratti del suo cliente. Oltre ai controlli del servizio, una regola
  del database sulle tabelle del portale (RLS restrittiva) vieta il resto, e la risposta è
  sempre 404.
- Se la persona elimina il conto:
  - il collegamento sparisce e i suoi messaggi restano senza autore;
  - le consultas pagate e non usate bloccano l'eliminazione;
  - "Descargar mis datos" comprende i dati del portale.

**Foto:**

- Una per richiesta (il limite di 4 MB vale per tutta la richiesta), ridotte e senza i dati
  EXIF (posizione GPS).
- Chiavi `tenants/<id>/care-photos/<contratto>-<foto>.jpg`.
- A fine contratto + 30 giorni la manutenzione cancella prima su R2, poi segna come cancellate
  foto e miniature. Riprova ogni giorno e scrive un errore nel log se dopo 7 giorni non ci
  riesce.
- Se il contratto riparte entro i 30 giorni, la cancellazione salta.
- I testi restano. È un'eccezione voluta dal founder alla regola "niente cancellazioni": va in un
  ADR nuovo e nel §5 di `CLAUDE.md`, accanto a quella di ADR-051.

**Email e WhatsApp:**

- Un solo controllo per tutte le email di Floral Care: fioreria LIVE e attiva, mai demo
  (ADR-016).
- Ogni email della stessa visita e dello stesso tipo parte una volta sola (tabella d'uscita con
  chiave unica, come `OccasionPromoEmail`).
- Promemoria del giorno prima solo se il contratto lo prevede. Il fiorista riceve un riassunto
  dei messaggi, non un'email per ognuno.
- Il fornitore email gratuito ha un tetto mensile e consegna solo al proprietario finché il
  dominio non è verificato: per inviti e resoconti c'è sempre anche "Copiar enlace / WhatsApp".

## 4. Asistente de plantas: cosa ne penso

**L'idea è buona e la farei:**

- tiene legato il cliente al fiorista fra una visita e l'altra;
- aiuta il fiorista durante la visita;
- è un asset nostro, che si vende.

Con tre cautele:

1. **Costo.**
   - Con il modello più capace (4 USD per milione di token in entrata, 20 in
     uscita), una risposta costa circa 0,02–0,05 USD contando il "pensiero", che si paga come
     uscita e non si può spegnere: si tiene al minimo.
   - Con il modello più piccolo costa circa 40 volte meno; il modello lo scegli tu dopo la prova.
   - Per contenere il costo:
     - dopo il riconoscimento la foto non si rimanda;
     - al posto della storia intera va un breve riassunto del caso;
     - le risposte sono brevi;
     - il prezzo della consulta si fissa sul costo misurato dei casi peggiori.
   - Le consultas pagate dai clienti hanno un budget loro, fuori dal tetto di 50 USD delle
     immagini.
   - Limiti al giorno per persona; una risposta rifiutata o in errore non si conta.
2. **Pagamenti dei clienti a Gardelia (tua decisione).**
   - Stripe Checkout ospitato da Stripe:
     - l'acquisto si scrive prima di mandare il cliente a pagare;
     - le consultas arrivano solo dal webhook firmato, una volta sola per evento;
     - con OXXO arrivano quando il pagamento risulta pagato;
     - rimborsi e contestazioni tolgono consultas.
   - Su staging un banner dice "Modo de prueba: no se cobra". In produzione l'app non parte con
     una chiave di prova, e con una chiave vera solo con l'interruttore di approvazione, dopo il
     via libera legale.
   - Lo stesso pagamento servirà ai fioristi per comprare i crediti delle immagini.
3. **Sicurezza:**
   - niente dosi di prodotti chimici;
   - gli avvisi di tossicità vengono dai nostri dati rivisti, non dal testo del modello;
   - dice quando non è sicuro e passa il caso alla fioreria ("Enviar a la florería").

Come funziona:

1. Foto.
2. 2–3 specie possibili dalla nostra lista, che il cliente conferma o corregge.
3. Il cliente descrive il problema e riceve una risposta breve con i passi.

L'unità di vendita è la **consulta**, cioè una risposta. Dietro si registra il costo vero di
ognuna.

## 5. Cosa c'è già e si riusa

- **Distanza e fasce**:
  - `distanceKm`, `freshCoordinates` (`packages/domain/src/places.ts`); `quoteDeliveryFee`,
    `DeliveryFeeTier` (`delivery.ts`); origine dalla `Location` principale (`loadDeliveryPricing`
    in `services/delivery-settings.ts`);
  - `weekdayOf`, `isClosedOn`, `parseTimeInput`, `formatTimeOfDay`;
  - attenzione: le coordinate dei clienti si cancellano dopo 30 giorni (ADR-059), quindi distanza
    e sovrapprezzo si salvano nel contratto. Quelle del negozio si aggiornano solo con la tienda
    pubblicata o le fasce di distanza: Floral Care deve chiederle.
- **Agenda**:
  - `getOrdersDay` e `getOrdersMonth` (`services/order-schedule.ts`);
  - `getDeliveryRoute` e `Order.assignedMembershipId` (`services/delivery-route.ts`);
  - le viste di `calendar/calendar-views.tsx`; il menu in `app/[tenantSlug]/layout.tsx`; le rotte
    in `lib/routes.ts`.
- **Manutenzione** (`jobs/maintenance.ts`, ogni giorno ~9:07 a Città del Messico):
  - le funzioni SQL `SECURITY DEFINER` danno gli ID fra le fiorerie;
  - il lavoro avviene in `withTenantContext({tenantId, userId: null})`.
- **Conto di chi compra** (ADR-064):
  - `withUserContext`, `app_enable_user_rls`, `runBuyerAction`, `/cuenta`, `app_buyer_orders()`;
  - inviti con token come `Invitation` (`services/team.ts`).
- **Foto**:
  - `normalizeUploadedPhoto`, `storeFilesThenCommit`, `deleteUnusedFiles`;
  - `ObjectStorage.delete` (`ai/storage.ts`, una sola cartella nella chiave);
  - `privateImageRoute`;
  - link firmati (`signed-ids.ts`, `public-links.ts`).
- **Ordini e inventario**:
  - `catalogLineDraft`, `lineRowData`, `nextTenantCounter`, `priceOrder`;
  - `consumeStockTx` per i materiali della visita;
  - pagamenti `OrderPayment`, da cui copiare regole e CHECK per i cargos;
  - cronologia del cliente (`services/customer-timeline.ts`).
- **AI**:
  - adattatori con un simulato ammesso solo in locale ed etichettato;
  - tetto di piattaforma (`fitsMonthlyAiBudget`, `app_ai_spend_since`, che oggi conta solo
    `AiJob`);
  - crediti `AiCreditGrant`, solo per le anteprime: l'assistente ha tabelle sue e l'SDK
    ufficiale `@anthropic-ai/sdk`.
- **Nomi già usati**:
  - `TenantSubscription`, `SubscriptionStatus` e `SubscriptionSource` sono l'abbonamento della
    fioreria a Gardelia, quindi le tabelle nuove si chiamano `CustomerSubscription…`;
  - i piani nel codice sono BASIC e PLUS (Esencial e Profesional sono ancora sulla carta): la
    funzione `floralCare` si aggiunge ai piani esistenti e si accende per tutti nella fase di
    prova (D-29).

## 6. Modello dati

Tabelle della fioreria (con `tenantId`, RLS e FK composite), salvo dove indicato.

- `CustomerSubscription`:
  - numero `SUS-0001`, cliente, tipo (`CARE`, poi `DELIVERY`), stato;
  - versione del calendario e del prezzo, inizio, fine, pausa;
  - `confirmedById`: da quel membro viene il permesso dei lavori automatici;
  - quanto è già generato, sede e dati pratici della sede;
  - distanza e sovrapprezzo salvati, origine del cliente (D-24).
- Impostazioni Floral Care (una riga per fioreria) e fasce di sovrapprezzo.
- `CareService`: chiave nostra o testo del fiorista; incluso o extra; per visita, per pianta o
  una tantum; archiviabile.
- `CareSlot` (giorno della settimana, da–a, capienza) e `CareBlock` (dal–al, fascia facoltativa,
  motivo).
- Servizi del contratto (prezzo copiato) e `CarePlant`:
  - specie, prodotto del catalogo facoltativo, quantità, misura, posizione, vaso, luce, acqua;
  - istruzioni, stato, date.
- `CareVisit`:
  - data originale e attuale, fascia e minuti copiati, posti occupati;
  - stato (programada, en curso, hecha, no realizada, cancelada, por reprogramar);
  - extra sì o no, persona assegnata, inizio e fine, note, registro d'inventario.
- Risultati per pianta e per servizio; `CarePhoto` (tipo, chiavi, chi, cancellata il);
  `CareMessage`.
- Cargos e pagamenti con storni (uno per contratto e mese, regole copiate da `OrderPayment`).
- Accesso al portale:
  - inviti e collegamenti cliente ↔ persona;
  - le tabelle del portale portano anche `customerId` per la regola RLS restrittiva;
  - funzione `app_buyer_care_access()`.
- Email in uscita con chiave unica.
- Assistente:
  - conversazioni e messaggi con il costo vero, nella fioreria;
  - consultas, acquisti ed eventi Stripe in tabelle **per persona** (RLS per persona), perché
    sono della persona anche fra fiorerie.
- Permessi (`packages/domain/src/permissions.ts`):
  - `subscriptions:read` (tutti);
  - `subscriptions:write` e `subscriptions:payments` (proprietario e gerente);
  - `care:visit` (tutti).

## 7. Blocchi di lavoro, in quest'ordine

Ogni blocco è completo (database, servizio, pagine, testi nelle tre lingue, test, documenti,
rilascio su staging) e lascia qualcosa di usabile.

1. **Offerta, fasce e contratti.**
   - Ajustes → Floral Care (tariffe, care per misura, frequenze, raggio, regole, termini, servizi,
     fasce con capienza, simulatore).
   - Contratto: dalla diagnosi al prezzo confermato, piante anche a gruppi.
   - Visite generate e **Agenda** (giorno, mese, ruta con consegne e visite), persona assegnata.
   - "Hecha / No se pudo" semplice; il controllo "Sí, avisé al cliente" su ogni modifica che
     tocca visite.
   - Base dei lavori senza utente (§8).
2. **La visita dal telefono**, in due rilasci (decisioni del founder del 24/11: l'Agenda nella
   barra in basso al posto di Clientes; la visita extra in un orario di visita oppure a un'ora
   libera, che non conta i posti e i clienti non possono scegliere).
   - **2a (fatto, ADR-078):** "Empezar visita", checklist, piante con "todas bien", foto una alla
     volta, materiali dall'inventario, nota per il cliente, avvisi per chi gestisce, "Terminar" e
     "No se pudo"; resoconto per email (tabella d'uscita con nuovi tentativi) e con link firmato;
     cancellazione delle foto 30 giorni dopo la fine del contratto; ruta del día con consegne e
     visite; Agenda nella barra in basso.
   - **2b (fatto, ADR-078):** visita extra (in un orario o a un'ora libera, con il costo calcolato
     dal server), reposición delle piante morte (sin costo, alla prossima visita, cotización o no se
     repone) e cambio di stagione con la cotización legata al contratto.
3. **Cargos e pagamenti**, in due rilasci (decisioni del founder del 24/11: "Días para pagar"
   scelti dalla fioreria, 10 di default; il cliente che non apre paga la visita e il recupero è
   gratis; un solo pagamento sull'estado de cuenta per tutte le sedi; lo staff segna gli incassi
   "por registrar").
   - **3a (fatto, ADR-082):** cargo del mese alla conferma (con le visite che restano) e ogni mese
     dal lavoro giornaliero; crediti, debiti, visite extra e servizi "una sola vez" sul cargo del
     mese dopo; prezzo copiato in ogni cargo; saldo a favore portato avanti e devolución nel cargo
     finale; pagamenti su un cargo o distribuiti sull'estado de cuenta, storni; Cobros con i
     vencidos; regole copiate nel contratto; causa di "No se pudo"; voci nella cronologia;
     riquadro nel pannello.
   - **3b:** "Cobré en la visita" (por registrar, confermato o rifiutato da chi gestisce), "Por
     recuperar" con la visita extra "Sin costo" legata alla visita mancata, "Ajuste para el
     próximo cargo".
4. **Blocchi, vacanze e cambi di massa.**
   - Blocchi di giorni o fasce, giorni di punta proposti.
   - Elenco dei clienti toccati, spostamento o credito di tutte le visite insieme, email
     facoltativa, casella obbligatoria.
5. **Pagina del cliente.**
   - Invito e collegamenti, regola RLS restrittiva.
   - Mi Floral Care, "Cambiar fecha", messaggi con foto e riassunto per il fiorista.
   - Cancellazione delle foto a fine contratto, dati nell'export e regole di eliminazione del
     conto.
6. **Asistente de plantas.**
   - Prima per il fiorista, poi nel portale, con Stripe in modalità di prova e il banner.
   - Prima del via: prova su circa 50 foto vere, pagata da te con il tuo ok, e i testi legali.
7. **Consegne periodiche (piano a parte).**
   - Righe, cadenza, ordini creati 2 giorni prima e mai doppi.
   - Etichetta e filtro negli ordini, vista d'insieme, pausa e salti.
   - Prima vanno convertite al nuovo ambito senza utente le funzioni di apartados e inventario
     (`reserveStockTx`, `syncOrderReservationTx`, `consumeStockTx`).

## 8. Punti tecnici delicati

- **Lavori senza utente** (visite, cargos, email, cancellazione foto, poi ordini):
  - mai un `TenantContext` finto né l'ID del proprietario;
  - un `JobScope` (fioreria, fuso, modo, nome del lavoro) costruito solo nel codice dei job
    dopo aver riletto la fioreria;
  - `recordJobAudit` accanto a `recordAudit`, con attore nullo e nome del lavoro;
  - funzioni interne `…Tx` che ricevono {fioreria, fuso, utente o nulla};
  - il lavoro si trova con funzioni SQL che danno gli ID, senza `withSystemContext` né nuove
    eccezioni ESLint;
  - un test delle convenzioni vieta `as TenantContext`.
- **Transazioni brevi**: una per contratto (limite 15 s), con un tetto per giro (la route di
  manutenzione si ferma a 60 s).
- **Ore**: il preavviso si controlla nell'ora locale della fioreria (serve un helper nuovo).
- **Variabili nuove**:
  - in `.env.example` e nella configurazione validata: chiave Anthropic, chiavi e segreto
    webhook di Stripe, interruttore degli acquisti, budget dell'assistente;
  - mai nel repo.
- **Documenti**:
  - ADR nuovi da ADR-075 (Floral Care, portale, assistente e pagamenti; ADR-073 è il dominio);
  - aggiornare ADR-057 (agenda) e D-26 (pagamenti online);
  - `docs/V1_SCOPE.md` righe 9 e 10; `IMPLEMENTATION_PLAN.md` a ogni blocco.

## 9. Fuori dal perimetro

- Vasi autoirriganti e irrigazione.
- QR per pianta.
- Pagamenti online di contratti e ordini.
- WhatsApp automatico.
- Floral Network.

## 10. Verifica

- **Dominio:**
  - frequenze e date (1º e 3º martes, settimane con 5 martedì);
  - canone, proporzione del primo mese, crediti;
  - preavviso in ora locale, raggio;
  - data di cancellazione delle foto.
- **Integrazione** (DB vero con RLS):
  - visite e cargos mai doppi rigenerando;
  - capienza con due prenotazioni insieme e spostamenti incrociati senza stalli;
  - cambio rifiutato senza "Sí, avisé al cliente";
  - pagamenti e storni;
  - cancellazione foto con R2 che fallisce e poi riesce;
  - isolamento fra fiorerie e fra clienti della stessa fioreria (404);
  - accesso revocato;
  - webhook Stripe ripetuto senza doppio accredito.
- **E2E:**
  - il fiorista crea offerta, fasce, contratto, fa la visita dal telefono;
  - il cliente accetta l'invito, sposta una visita nel mese, manda una foto;
  - il blocco di un giorno con visite chiede la casella.
- **A ogni blocco:**
  - controllo a 320 px;
  - `pnpm lint`, `typecheck`, `test`, `build` e `test:e2e` verdi;
  - CI verde e rilascio su staging.
