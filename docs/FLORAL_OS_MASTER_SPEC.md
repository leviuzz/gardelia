# FLORAL OS
## Product Requirements Document, business model e piano tecnico per Claude Code

**Versione:** 1.0 — 21 novembre 2026  
**Stato:** specifica iniziale per avvio sviluppo  
**Mercato pilota:** Aguascalientes, Messico  
**Espansione:** altre città del Messico, poi Italia; in seguito altri Paesi  
**Valuta di lettura:** EUR primaria; MXN tra parentesi, indicativi  
**Destinatari:** founder, sviluppatore, partner commerciale, Claude Code

> **IMPORTANTE — COME LEGGERE QUESTO DOCUMENTO**  
> `DECISO`: orientamento confermato nelle conversazioni.  
> `PROPOSTO`: dettaglio suggerito per rendere implementabile l'idea; approvazione non ancora definitiva.  
> `DA VALIDARE`: ipotesi commerciale, tecnica, fiscale o contrattuale che richiede verifica.  
> Le cifre MXN sono conversioni *indicative* al riferimento di pianificazione **1 EUR ≈ 20,72 MXN**, non un tasso di cambio live. Prezzi SaaS e commissioni sono **ipotesi**, non offerte deliberate o ricavi garantiti.

---

# 1. Executive summary e visione

**Floral OS** è una piattaforma SaaS multi-tenant dedicata ai fioristi. La prima fonte di ricavo è l'abbonamento mensile al gestionale. Il piano superiore integra un **AI Bouquet Builder**, con una differenza commerciale di circa **7 €/mese** per incentivare l'upgrade. Durante l'acquisizione dei primi fioristi si avvia anche la ricerca di clienti aziendali: più avanti **Floral Network** mette in relazione domanda B2B (uffici, hotel, cliniche, ristoranti, showroom, abitazioni di fascia medio-alta) e fornitori floreali, con fee sui contratti. **Flora Studio** è un addon AI separato per visualizzare allestimenti in fotografie di ambienti; l'editing video è un'evoluzione successiva.

**Non viene aperta una fioreria propria come modello principale.** Floral OS non acquista fiori, non ha magazzino centrale e non prepara o consegna bouquet. Il fiorista mantiene catalogo, stock, prezzi, produzione, qualità, consegne, manutenzioni e rapporti operativi con il cliente. La piattaforma offre tecnologia, gestione e nuove opportunità commerciali.

**Strategia:**

1. **Floral OS Basic + Plus (con Bouquet Builder)**: acquisire fioristi paganti ad Aguascalientes.
2. **Acquisizione della domanda B2B in parallelo**: validare richieste reali e assegnarle anche manualmente ai fioristi aderenti.
3. **Floral Network + Network Pro**: automatizzare richieste, matching, preventivi, contratti e commissioni, attivando il canone Pro solo quando il marketplace produce reale valore.
4. **Flora Studio AI**: rendere vendibili e visualizzabili gli allestimenti floreali in uffici e abitazioni.
5. **Evoluzione**: marketplace B2C per bouquet personalizzati, marketplace accessori, video AI, espansione internazionale.

## 1.1 Obiettivi di prodotto

- Digitalizzare i flussi quotidiani di una fioreria con un software concretamente utile anche *senza* marketplace o AI.
- Dare al fiorista un catalogo unico e strutturato riutilizzabile da gestionale, Bouquet Builder, Room Studio e Floral Network.
- Ridurre il tempo richiesto per preventivi, ordini, inventario e ricorrenze cliente.
- Consentire al consumatore di specificare **fiori e quantità** e ottenere un'anteprima acquistabile, non soltanto un'immagine fantasiosa.
- Generare ricavi ricorrenti da abbonamenti SaaS, addon e commissioni per clienti procurati dalla piattaforma.
- Supportare in futuro un ecosistema internazionale senza creare software separati per ogni Paese.

## 1.2 Non-obiettivi iniziali

- Gestire una fioreria fisica, acquistare fiori o sostenere consegne con mezzi propri.
- Sviluppare un POS fiscale completo e certificato per il Messico nel primo sprint.
- Lanciare subito un marketplace pubblico con decine di città o un carrello multi-venditore.
- Promettere generazione video AI o bouquet fotorealistici in tempo reale a ogni clic.
- Garantire che un render AI rispetti sempre il numero visibile di petali/steli.
- Automatizzare totalmente il matching B2B prima di avere richieste aziendali reali.

---

# 2. Registro delle decisioni

| ID | Decisione | Stato | Implicazione |
|---|---|---|---|
| D-01 | Il prodotto principale è un gestionale SaaS per fioristi. | **DECISO** | MRR prima delle commissioni di marketplace. |
| D-02 | Primo test ad Aguascalientes; Italia in seconda fase. | **DECISO** | UX in spagnolo messicano, fiscalità MX quando necessaria. |
| D-03 | Non acquistiamo e rivendiamo direttamente fiori come business principale. | **DECISO** | Magazzino e operatività appartengono ai merchant. |
| D-04 | Bouquet Builder va lanciato con il gestionale, nel piano superiore. | **DECISO** | MVP commerciale include almeno una versione funzionante del Builder. |
| D-05 | Differenza Basic/Plus circa 7 €/mese. | **DECISO come strategia** | Il numero di generazioni AI va contingentato. |
| D-06 | Floral Network è soprattutto marketplace B2B per clienti importanti. | **DECISO** | Domanda commerciale acquisita parallelamente allo sviluppo. |
| D-07 | Accesso alle opportunità B2B come addon gestionale. | **DECISO come modello** | L'attivazione a pagamento è successiva a una rete di lead realmente utilizzabili. |
| D-08 | Fee su ordini e subscription B2B originati da Floral Network. | **DECISO** | Attribution e ledger delle commissioni indispensabili. |
| D-09 | Flora Studio è un addon separato del gestionale. | **DECISO** | Catalogo e AI condivisi, billing separato. |
| D-10 | Foto ambiente + posizionamento di fiori/vasi/piante + anteprima AI. | **DECISO** | Editor fotografico e pipeline generativa. |
| D-11 | Video con stop-frame e rigenerazione è fase successiva. | **DECISO** | Non blocca MVP né billing iniziale. |
| D-12 | Floral Care: fioristi possono offrire due visite/mese, il cliente irriga tra visite. | **DECISO come offerta tipo, non vincolo globale** | Contratti configurabili per frequenza, con istruzioni e interventi. |
| D-13 | Rinnovo allestimenti ogni 2–3 mesi, se richiesto. | **DECISO come caso d'uso** | Addon/intervento separato, non rinnovo automatico obbligatorio. |
| D-14 | Vasi autoirriganti e irrigazione sono servizi/beni vendibili dai merchant. | **DECISO** | Catalogo accessori e servizi installazione; no stock centrale. |
| D-15 | Marketplace bouquet B2C e marketplace accessori solo in seguito. | **DECISO** | Moduli futuri, non nel primo rilascio. |
| D-16 | Prezzi Base 19,90 €, Plus 26,90 €, Network Pro +9,90 €, Studio +14,90 €. | **PROPOSTO** | Esperimento di pricing, configurabile. |
| D-17 | Fee Network Standard 10%, Pro 7%; B2C bouquet ~15%; accessori ~12–20%. | **PROPOSTO** | Configurazione per Paese, campagna e contratto. |
| D-18 | Stack Next.js/TypeScript/Prisma/PostgreSQL con componenti AI asincroni. | **PROPOSTO** | Validare nel bootstrap tecnico. |
| D-19 | Canale di vendita iniziale: contatto diretto dei fioristi, senza forte advertising. | **PROPOSTO** | Pilot assistito, interviste e onboarding manuale. |
| D-20 | Una singola piattaforma multi-tenant, non progetti completamente separati. | **DECISO in linea di principio** | Isolamento dati forte e moduli configurabili per feature flag. |

**Nota sui prezzi:** nessun prezzo è stato definitivamente testato con fioristi; qualunque checkout reale deve leggere prezzi/configurazioni da database, mai valori hardcoded nella logica.

---

# 3. Business model, pubblico e monetizzazione

## 3.1 Segmenti

**Clienti paganti SaaS (B2B merchant):** fiorerie indipendenti, piccoli laboratori floreali, fioristi con 1–N sedi, fornitori per eventi e studi di floral design. Mercato pilota: Aguascalientes. Il prodotto va progettato per piccoli team con tempo limitato e bassa tolleranza alla configurazione complessa.

**Acquirenti Floral Network (B2B end customer):** uffici, reception, alberghi, ristoranti, cliniche, studi professionali, showroom, negozi, condomini, case private ad alta capacità di spesa. Possono chiedere servizio occasionale oppure contratto ricorrente.

**Acquirenti B2C (futuro):** privati che creano bouquet o acquistano composizioni tramite fioristi locali.

**Partner accessori (futuro):** vivai, fornitori vasi, terriccio, sistemi autoirriganti, componenti per decorazioni. Modello senza magazzino proprio.

## 3.2 Offerta commerciale di riferimento

| Prodotto | Prezzo EUR | Equivalente MXN indicativo | Ricavo / condizione |
|---|---:|---:|---|
| Floral OS Basic | **19,90 €/mese** | ~412 MXN | Gestionale, CRM, ordini, catalogo, inventario, calendari e abbonamenti. |
| Floral OS Plus | **26,90 €/mese** | ~557 MXN | Basic + Bouquet Builder AI, con quote di utilizzo. |
| Differenza per passare a Plus | **7,00 €/mese** | ~145 MXN | Meccanismo upsell desiderato. |
| Floral Network Standard | **0 € di addon iniziale** | 0 MXN | Accesso base ai lead qualificati, fee proposta 10%. |
| Floral Network Pro | **+9,90 €/mese** | ~205 MXN | Strumenti commerciali avanzati, fee proposta 7%. |
| Flora Studio AI | **+14,90 €/mese** | ~309 MXN | Foto ambienti, posizionamento, rendering e preventivi, con quota AI. |
| Bouquet Builder, extra generazioni | **Da definire** | — | Pacchetti crediti oltre la quota inclusa. |
| Flora Studio, generazioni video | **Da definire** | — | Prezzo specifico a consumo; futuro. |
| Marketplace B2C bouquet | **Fee ~15%** | — | Commissione proposta, su ordini acquisiti dal marketplace. |
| Marketplace accessori | **Fee ~12–20%** | — | Commissione proposta, su prodotti terzi. |

**Regola commerciale fondamentale:** nessuna commissione marketplace sui clienti già acquisiti autonomamente dal fiorista e gestiti attraverso il suo CRM/checkout diretto, salvo diverso accordo esplicito. Le fee devono premiare domanda nuova procurata dalla piattaforma.

**Network Pro:** nella fase in cui non esistono abbastanza opportunità qualificate, proporre accesso gratuito al network e commissione per successo; attivare il canone premium dopo aver dimostrato valore tangibile. Evitare promesse di un numero minimo di lead se non contrattualmente sostenibili.

## 3.3 Esempio economico di riferimento (NON forecast)

Scenario puramente illustrativo:

| Fonte | Volumi ipotizzati | Ricavi mensili EUR |
|---|---|---:|
| Floral OS Basic | 20 × 19,90 € | 398 € |
| Floral OS Plus | 30 × 26,90 € | 807 € |
| Network Pro | 10 × 9,90 € | 99 € |
| Flora Studio | 10 × 14,90 € | 149 € |
| Fee B2B | 10 contratti × 250 €/mese × 8% | 200 € |
| **Totale ricavi mensili** | 50 fioristi complessivi | **1.653 €** |
| **Annualizzato (a mix invariato)** | | **19.836 €** |

~34.250 MXN/mese usando il cambio storico di pianificazione. **Non è utile netto.** Dedurre gateway, AI, hosting, assistenza, marketing, tasse, eventuali imposte indirette e lavoro dei fondatori. Le fee per contratti e l'MRR SaaS vanno contabilizzati separatamente, altrimenti si crea confusione tra **GMV** (transato dai fioristi) e **ricavo della piattaforma**.

## 3.4 Costi della piattaforma

- **Fissi:** hosting, database, storage, dominio, email, logging/monitoraggio, accounting, amministrazione, software, eventuale supporto.
- **Variabili:** generazioni AI per immagine/video, eventuali costi provider per pagamenti e payout, email/SMS/WhatsApp, storage/uploads, gestione contestazioni e chargeback.
- **Commerciali:** visite, onboarding, dimostrazioni, acquisizione lead aziendali, pubblicità opzionale.
- **Non sono costi Floral OS:** fiori, terra, vasi, consegne, carburante e manodopera per realizzare bouquet o fare manutenzione — sono dei fioristi e vanno eventualmente inclusi nel loro preventivo.
- **Costo opportunità:** sviluppo e commerciale svolti dai due founder vanno misurati anche quando non generano immediata uscita di cassa.

---

# 4. Ruoli, permessi, tenancy e principi UX

## 4.1 Ruoli applicativi

1. **Platform Super Admin** — gestisce merchant, sottoscrizioni, feature flag, lead, fee, ticket, audit, payout/reconciliation; accesso dati inter-tenant solo autorizzato e tracciato.
2. **Merchant Owner** — crea e amministra la propria fioreria, sedi, billing, utenti, catalogo, ordini e attivazione addon.
3. **Merchant Manager** — gestione operativa catalogo, ordini, clienti, inventario, calendari e preventivi; senza modificare proprietà/pagamenti SaaS se non autorizzato.
4. **Merchant Staff** — visualizza e lavora sugli ordini/interventi assegnati; permessi limitati.
5. **Merchant Customer** — consumatore B2C o azienda che ha rapporti diretti con uno specifico merchant; privacy per singolo fornitore.
6. **B2B Buyer / Company Admin** — account aziendale con richieste, sedi, budget, preventivi, contratti e fatture.
7. **B2B Buyer Collaborator** — può partecipare a una richiesta o confermare un servizio con limiti di autorizzazione.
8. **Guest** — naviga pagine pubbliche o configuratori consentiti, con raccolta dati minima.

## 4.2 Principi di sicurezza

- Tutte le entità merchant-owned hanno `tenant_id` e tutte le query applicano filtri server-side obbligatori.
- Nessun merchant può leggere clienti, costi, inventario, vendite, conversazioni o file di un altro merchant.
- Le pagine pubbliche espongono soltanto i dati esplicitamente pubblicati dal merchant.
- L'applicazione è **mobile-first**, soprattutto l'onboarding e la gestione ordine da telefono.
- UX spagnolo MX al lancio, italiano ed inglese predisposti mediante i18n.
- Valuta, tasse, fuso orario, formato date e indirizzi vanno modellati per Paese e sede, non concatenati in stringhe.
- Tutte le modifiche critiche registrano autore, timestamp e diff/metadati rilevanti.

---

# 5. Funzionalità Floral OS: requisiti dettagliati

Le etichette **P0** (MVP), **P1** (prima espansione), **P2** (futuro) indicano la priorità proposta per lo sviluppo, non il valore commerciale assoluto.

## 5.1 Account, onboarding e impostazioni merchant [CORE-01]

**P0**

- Registrazione/login (email/password o provider, scelta implementativa da validare); recupero accesso, verifica email.
- Wizard iniziale con nome fioreria, ragione sociale se nota, partita fiscale locale facoltativa inizialmente, logo, contatti, fuso orario, indirizzo operativo, raggio di consegna, giorni e orari, lingua, valuta.
- Creazione del tenant e della prima sede. In futuro sedi multiple.
- Invito staff e assegnazione ruolo; stato invito, revoca, disattivazione.
- Scelta piano SaaS Basic/Plus e prova gratuita eventuale (durata **da definire**).
- Schermata `Impostazioni > Piano e utilizzo`: piano corrente, addon, quota generazioni AI, fatture/costi, aggiornamento carta, disdetta.
- Configurazione dati pubblici (brand, fotografia, bio, specialità, copertura) per futuro Network.

**Criteri di accettazione:** un nuovo merchant può creare il negozio e un primo prodotto senza intervento tecnico; non vede dati di nessun altro tenant; può vedere piano e consumo AI.

## 5.2 CRM e relazione con clienti [CRM-01]

**P0**

- Scheda cliente: nome, email, telefono, indirizzi (plurimi), tipo (`private`, `company`), note, preferenze floreali e restrizioni note, canale acquisizione, consensi comunicazioni.
- Timeline cronologica di ordini, preventivi, consegne, subscriptions, messaggi e interventi.
- Ricorrenze: compleanno, anniversario e promemoria data personalizzabile; distinzione tra ricorrenza del compratore e del destinatario regalo.
- Ricerca, filtri, tag, segmentazione semplice; import da CSV con validazione e anteprima.
- Azioni rapide: nuovo preventivo, nuovo ordine, nuova subscription, promemoria; contatto WhatsApp tramite link (no automazioni non autorizzate).

**P1:** segmenti automatici, campagne opt-in, template comunicazioni, customer portal, gestione account aziendali multi-sede.

**Regole:** non inviare messaggi promozionali senza consenso applicabile; dati regalo del destinatario non diventano automaticamente contatti marketing.

## 5.3 Catalogo prodotti, bouquet e servizi [CAT-01]

**P0**

- Tipologie: fiore reciso, fogliame, pianta viva, bouquet ricetta, vaso/contenitore, packaging/accessorio, servizio, addon servizio.
- Ogni SKU merchant-specific contiene nome locale, specie/varietà, colore, unità di vendita (`stem`, `bunch`, `piece`, `service`), costo stimato, prezzo, immagini, visibilità, disponibilità, fornitore opzionale, dimensioni indicative, tempo preparazione, tag, stato attivo/archiviato.
- Distinguere **catalogo normalizzato** (rosa rossa, peonia bianca, ecc.) da **SKU del singolo fiorista** con varietà, qualità e prezzo propri. I merchant mantengono controllo di disponibilità.
- Bouquet predefinito con foto, nome, prezzo e distinta base (BOM) di fiori, quantità, packaging, accessori, manodopera e regole di sostituzione.
- Servizi: allestimento, visita manutenzione, rinnovo stagionale, irrigazione, evento; unità, durata, area coperta e criteri preventivo.
- Gestione fotografie di bouquet storici con permesso d'uso AI, tag stilistici, formato, contesto ed eventuale ricetta ricostruita.
- Disponibilità di prodotti espressa in `available`, `limited`, `out_of_stock`, `on_request`; non tutti i fioristi hanno inventario in tempo reale.

**P1:** prezzi per fascia quantità, listini aziende, bundle, varianti, sincronizzazione con cataloghi esterni.

## 5.4 Inventario e acquisti [INV-01]

**P0**

- Quantità in stock per SKU/sede, unità, minimo scorta, rettifiche e causale.
- Scarico manuale o collegato all'ordine confermato; **riserva** temporanea configurabile, con timeout.
- Registrazione acquisto da grossista: fornitore, costo, data, lotto facoltativo e quantità.
- Movimenti: acquisto, consumo in bouquet, rettifica, scarto/deperimento, reso, trasferimento sede (futuro).
- Avviso quando un ingrediente della ricetta non è sufficiente.
- Costo materiale di un bouquet calcolato dalla distinta; differenza tra costo preventivato e consuntivo.

**P1:** lotti per prodotti deperibili, FEFO, forecast stagionale e riordini suggeriti.

**Vincolo:** non trattare foto o prompt AI come fonte di verità per inventario o composizione; la BOM strutturata è la fonte.

## 5.5 Preventivi, ordini, pagamenti e consegne [ORD-01]

**P0**

- Creazione ordine da catalogo o bouquet personalizzato: righe, quantità, sconti, tasse configurabili, nota, data/slot, indirizzo, destinatario, modalità (`pickup`, `delivery`, `service`).
- Preventivo in bozza con validità e conversione a ordine, senza duplicare clienti/righe.
- Stati suggeriti: `draft → quote_sent → accepted → confirmed → preparing → ready → dispatched → delivered → completed`; rami `rejected`, `cancelled`, `refunded` definiti con regole.
- Acconti e saldo; pagamento registrato manualmente (contanti/bonifico) nel primo MVP; pagamento online con provider in fase successiva o quando serve ai pilot.
- Stima costo consegna e fascia di servizio configurata dalla fioreria; link stato ordine pubblico con token a scadenza.
- Nota di consegna e fotografia del bouquet finito opzionale; prova consegna e gestione contestazione futura.
- Promemoria operativi e calendario ordini.

**P1:** route planning, invio comunicazioni automatiche, gateway completo, ricevute/fatture integrate.

## 5.6 Subscription e contratti ricorrenti [SUB-01]

**P0**

- Il fiorista può creare subscription a cliente privato/azienda: prodotto o servizio, frequenza, prezzo, data inizio, prossima esecuzione, termine opzionale, indirizzo, note, modalità pagamento, pausa/riattivazione/chiusura.
- Esempi: bouquet settimanale; manutenzione piante **2 volte al mese**; controllo periodico di reception; abbonamento orchidee/piante.
- Generazione delle attività programmate per il personale; ogni esecuzione traccia stato e interventi.
- Distinzione tra **subscription commerciale** (canone) e **service appointment** (prestazione effettiva).
- Al termine dell'esecuzione, registrazione materiali consumati, foto, commento cliente e problemi.

**P1:** checkout di sottoscrizione con pagamento ricorrente, rinnovi automatici, gestione insoluti, upgrade/downgrade, condizioni contrattuali variabili.

**Regola chiave:** una frequenza commerciale di due visite/mese non implica irrigazione automatica o assenza di cure tra le visite; la fioreria fornisce schede chiare al cliente.

## 5.7 Floral Care e gestione piante [CARE-01]

**P0**

- Inventario delle piante/installazioni **per sede del cliente**: specie, foto, vaso, dimensioni, posizione, livello luce, esigenze irrigazione, data installazione, operatore, condizioni.
- Schede con istruzioni per il personale dell'ufficio/casa (acqua, esposizione, segnali di allarme). Le indicazioni sono configurabili dal fiorista e devono evitare intervalli rigidi universalmente validi.
- Calendario manutenzioni: due visite mensili nell'offerta tipica; check-list per pulizia, potatura, substrato, problemi, verifica impianti, fertilizzazione se necessaria.
- Possibilità di inviare richiesta con foto tra una visita e l'altra.
- **Rinnovo stagionale opzionale ogni 2–3 mesi**: nuovo preventivo, materiali, ritiro eventuale, installazione e foto prima/dopo. Separato dal canone, salvo accordo specifico.
- Scheda QR/link pubblico protetto per indicazioni di base sulla singola pianta (P1 se appesantisce MVP).
- Upsell: vaso autoirrigante, serbatoio, substrato, sensore, kit di irrigazione e relativa installazione, con manutenzione/sostituzioni.

**Regola prodotto:** distinguere fiori recisi (durata breve, sostituzioni frequenti) da piante vive e composizioni stabilizzate, che rendono sostenibile un rinnovo ogni 2–3 mesi. Non promettere che un bouquet fresco duri mesi.

## 5.8 Report, marginalità e amministrazione [BI-01]

**P0:** fatturato per periodo, ordini, ticket medio, prodotti venduti, ricavi ricorrenti stimati, margine lordo **se** i costi sono stati compilati, scarti e calendario prossimi interventi.

**P1:** funnel preventivo→ordine, cohort retention, valore clienti, ROI subscription, import/export, confronti sedi, profitto per bouquet/commessa, previsione stock.

Le metriche devono esplicitare dati mancanti: se mancano i costi non mostrare margini apparentemente accurati.

---

# 6. AI Bouquet Builder: specifica funzionale e tecnica

## 6.1 Obiettivo

Permettere a un utente di creare un bouquet selezionando **fiori singoli, quantità, colori e preferenze**, usando esclusivamente ingredienti del catalogo della fioreria; utilizzare bouquet realizzati precedentemente come riferimenti di stile; restituire un'anteprima convincente e un prezzo **calcolato deterministicamente**.

Il Builder è integrato in **Floral OS Plus**. Il fiorista può usare l'editor per preparare preventivi; in una fase successiva può pubblicare il builder sulla propria pagina pubblica o incorporarlo nel sito.

## 6.2 Funzioni visibili all'utente [AI-BQ]

- [AI-BQ-01 | P0] Selezione catalogo della fioreria e soli prodotti abilitati.
- [AI-BQ-02 | P0] Aggiunta/rimozione fiori con quantità intere positive; limiti e disponibilità.
- [AI-BQ-03 | P0] Selezione stile e fascia budget, packaging e dimensioni indicative.
- [AI-BQ-04 | P0] Prezzo live per componenti + packaging + manodopera/margine e tasse secondo listino; nessun prezzo generato dall'AI.
- [AI-BQ-05 | P0] Generazione anteprima AI **su richiesta** e visualizzazione stato `queued / generating / ready / failed`.
- [AI-BQ-06 | P0] Salvataggio configurazione e preventivo; collegamento a ordine/CRM.
- [AI-BQ-07 | P0] Uso opzionale di esempi storici del fiorista con licenza e tag.
- [AI-BQ-08 | P1] Anteprima quasi immediata con asset fotografici scontornati e composizione canvas/WebGL controllata.
- [AI-BQ-09 | P1] Editor con aggiustamenti guidati e alternative disponibili a magazzino.
- [AI-BQ-10 | P1] Pagina pubblica condivisibile / embed, checkout e gestione ordini online.
- [AI-BQ-11 | P1] Crediti AI, rate limit, recupero failure, policy retry, storico generazioni.

## 6.3 Flusso dati

1. Il client invia una `bouquet_configuration` strutturata: `tenantId`, righe `skuId + quantity`, packaging, stile e opzioni.
2. Il server rivalida tenant, SKU, prezzi, disponibilità, min/max e categorie combinabili.
3. Un **Pricing Engine** calcola prezzo, stima materiali e distinta ordine; salva uno snapshot del prezzo al momento del preventivo.
4. Un **Reference Selector** recupera esempi di bouquet della *medesima* fioreria filtrati per stile/ingredienti/diritti.
5. Un **Composition Planner** determina ingombri e layout plausibile; per MVP può essere un piano strutturato semplice.
6. Un worker invia al modello AI un payload composto da istruzioni, ingredienti, immagini autorizzate, composizione preliminare e vincoli; ottiene immagine.
7. Si salva output con metadata (`model`, prompt version, estimated cost, seed se supportato, reference IDs, status, retention).
8. L'utente vede il render e può generare una variante. **La fonte di verità per la vendita rimane la BOM**, non il contenuto pixels dell'anteprima.

## 6.4 Limiti e sicurezza del risultato

- Nessun bisogno di pregenerare combinazioni: la combinazione viene calcolata e renderizzata su richiesta.
- Le preview ad altissima fedeltà non sono istantanee e richiedono una coda e un'interfaccia di attesa.
- Un modello generativo può omettere, duplicare o nascondere steli, quindi aggiungere un disclaimer discreto: *anteprima illustrativa, dettagli naturali possono variare*.
- Non dichiarare disponibilità confermata quando il fiorista segnala `on_request`.
- Se manca stock, bloccare checkout o chiedere conferma per sostituzione, mai sostituire silenziosamente.
- Proteggere da prompt injection in descrizioni dei prodotti e immagini caricate; prompt server-side versionati, output moderato.
- Non addestrare su immagini del fiorista senza accordo esplicito; l'uso come riferimento per il rendering è una funzione separata dall'addestramento.

## 6.5 Quote / costi

**PROPOSTO:** 20–30 render fotografici per merchant/mese nel piano Plus, configurabili via billing; monitorare costo per generazione riuscita, tentativi, ritardi, uso reale e margine addon da 7 €. Pacchetti extra non ancora prezzati. Usare hash della configurazione e caching opportunistico delle preview identiche, rispettando dati e isolamento per merchant.

## 6.6 Acceptance criteria sintetici

- Il prezzo cambia correttamente quando cambiano quantità e packaging.
- Non si può acquistare uno SKU non disponibile senza processo di conferma.
- Una generazione fallita non crea un ordine né consuma definitivamente credito, secondo policy scelta.
- L'immagine appartiene solo al tenant e all'utente autorizzato; non può comparire su altre fiorerie.
- L'ordine contiene una distinta fiori/quantità esatta e snapshot dei prezzi anche se il rendering è visivamente approssimativo.

---

# 7. Flora Studio AI: progettazione ambienti

**Commercializzazione proposta:** addon a **14,90 €/mese** (~309 MXN), acquistabile indipendentemente da Network Pro; richiede Floral OS e catalogo strutturato.

## 7.1 MVP fotografico [AI-RM]

- [AI-RM-01 | P1] Upload di 1–N fotografie di un ambiente (ufficio, reception, salotto, ristorante, negozio, studio).
- [AI-RM-02 | P1] Visualizzazione immagine ed editor con click/tap per scegliere punto di posizionamento.
- [AI-RM-03 | P1] Inserimento di vasi, piante e bouquet dal catalogo reale del fiorista.
- [AI-RM-04 | P1] Gestione scala approssimativa (dimensioni catalogo o dimensione di riferimento), orientamento, vaso e colori.
- [AI-RM-05 | P1] Generazione di una preview fotorealistica con conservazione quanto possibile della stanza originale.
- [AI-RM-06 | P1] Varianti, salvataggio progetto e confronto prima/dopo.
- [AI-RM-07 | P1] Preventivo con prodotti, vasi, materiali, installazione, eventuale manutenzione ricorrente.
- [AI-RM-08 | P1] Condivisione link o PDF di proposta e conversione a ordine/contratto.
- [AI-RM-09 | P1] Privacy immagini, consenso caricamento, retention ed eliminazione.

## 7.2 Estensione video [AI-VID | P2]

- Upload video compatibile; estrazione fotogrammi e timeline.
- Pausa su un frame, scelta di una posizione e inserimento vaso/pianta.
- Modello video-editing con ancoraggio temporale dell'oggetto e conservazione il più possibile di geometria e occlusioni.
- Elaborazione asincrona, anteprima, limiti di durata/risoluzione e crediti separati.
- L'editing di **un solo frame non basta** a rigenerare coerentemente il video: occorrono tracking, profondità o video-to-video.
- Nessuna promessa di precisione dimensionale assoluta; preventivi verificati dal fiorista.

---

# 8. Floral Network: marketplace B2B

## 8.1 Business e servizi supportati

Il Network collega clienti importanti e professionisti locali. I fioristi scelgono quali servizi offrono, in quali zone, con quale capacità e condizioni. Servizi: allestimenti iniziali di piante e bouquet; cura continuativa; rinnovi stagionali; fornitura bouquet periodici; eventi; vasi autoirriganti; irrigazione con installazione e manutenzione.

**Floral Care tipico:** due visite ogni mese; istruzioni e acqua fornite dal cliente nel frattempo; cambio decorazioni ogni due o tre mesi solo se richiesto/previsto da contratto. Frequenze flessibili, perché esigenze botaniche diverse e fiori recisi non possono seguire tutti lo stesso schema.

## 8.2 Lancio manuale prima del marketplace [NET-00 | P0 commerciale]

- Sito/landing B2B con formulario richiesta (servizio, sede, foto autorizzate, budget, frequenza, tempo desiderato, contatto e consensi).
- Dashboard interna admin per qualificare lead, contattare azienda e invitare fioristi disponibili.
- Matching iniziale anche manuale; registrare dati di origine, assignment e outcome per costruire il motore futuro.
- Preventivi e contratti possono essere concordati off-platform durante pilot **con tracciamento delle fee secondo accordo**, senza fingere di avere un sistema di pagamento completo.
- Non applicare canone Network Pro finché non c'è valore pratico dimostrato.

## 8.3 Marketplace strutturato [NET-01 | P1]

- Profilo fiorista pubblico/privato con: sede, raggio operativo, servizi, capacità settimanale, portfolio, valutazioni verificate, SLA di risposta e lingue.
- Profilo cliente aziendale con più indirizzi/sedi e referenti.
- Richiesta preventivo strutturata (`lead`): tipo servizio, immagini, superfici e quantità indicative, fascia budget, frequenza, disponibilità per sopralluogo.
- Filtro merchant per copertura, competenze, disponibilità, eventuali tariffe minime e affidabilità.
- Invito a uno o più merchant e cronologia proposte.
- Preventivo con voci (`material`, `labor`, `visits`, `installation`, `travel`, `taxes`) e condizioni, scadenza, documenti.
- Negoziazione e versionamento preventivi; scelta dell'azienda.
- Contratto una tantum o subscription, appuntamenti associati e consuntivi.
- Tracking qualità: note visita, foto prima/dopo, conferma cliente, issue, cancellazioni e rimborsi.
- Commissione associata alla **provenienza effettiva del cliente**, tracciata in modo verificabile.
- Pannello merchant: nuove opportunità, offerte inviate, contratti vinti, commissioni, lavori previsti.
- Pannello azienda: richieste, preventivi comparabili, fornitori, sedi, subscription e storico.

## 8.4 Fee e piani [NET-02 | P1]

- **Standard:** accesso iniziale gratuito, commissione proposta **10%** sui contratti generati dal Network.
- **Pro:** addon **9,90 €/mese** (~205 MXN), con strumenti avanzati e commissione proposta **7%**; **non** garanzia di lead e **non** ranking artificiale a pagamento non dichiarato.
- Ricavi ripetuti: fee su rinnovi mensili soltanto per contratti procurati dal Network e nel rispetto di termini contrattuali espliciti.
- All'inizio, fee su incasso effettivo e non su preventivo; gestire storni/rimborsi e insoluti.
- Definire chiaramente finestra di attribuzione e quando un cliente smette di essere originato dal marketplace: **DA VALIDARE** legalmente/commercialmente.

## 8.5 Pagamenti marketplace [NET-03 | P1]

Preferire provider che supporti split payments/connect, KYC merchant, rimborsi e riconciliazione. Non inventare un wallet interno o trattenere fondi dei fioristi senza architettura legalmente corretta. Gestire fee, chi sostiene la commissione del gateway, payout, imposte e dispute in modo esplicito. Su pagamenti ricorrenti, l'abbonamento cliente finale va distinto dal canone SaaS pagato dal fiorista.

## 8.6 Evoluzione multi-sede enterprise [NET-04 | P2]

Richieste multi-città, assegnazione a diversi fioristi, SLA uniforme, referente unico aziendale, fatturazione centralizzata, indicatori per sede e account management. Non necessaria nell'MVP di Aguascalientes.

---

# 9. Marketplace B2C e accessori — prodotti futuri

## 9.1 B2C bouquet [B2C-01 | P2]

Il consumatore compone un bouquet con fiore/quantità, seleziona indirizzo e data, e vede soltanto i fioristi capaci di produrlo e consegnarlo. Ordina per prezzo, distanza, fascia consegna, rating, compatibilità con ingredienti e tempi. Per evitare preventivi fittizi, mostrare differenza tra `disponibile subito` e `richiede conferma`. L'AI rende una preview illustrativa, non garantisce replica fotografica perfetta.

Commissione proposta **~15%** sugli ordini generati dalla piattaforma. Consegne e assistenza alla qualità del bouquet appartengono al merchant, mentre la piattaforma gestisce accordi, pagamento, dispute secondo termini.

## 9.2 Accessori [ACC-01 | P2]

Marketplace senza magazzino proprio di vasi, terriccio, fertilizzanti, packaging, sistemi di irrigazione, componenti decorativi. Venditori partner responsabili di spedizione e garanzia dei beni; commissione ipotizzata **12–20%**. Prevedere anche upsell dentro i preventivi Flora Studio e Floral Care. Carrello multi-venditore **fuori MVP**.

---

# 10. Flussi UX end-to-end

## FLOW-A — Fiorista: registrazione → primo valore

1. Atterra su pricing; sceglie Basic o Plus e crea account.
2. Crea fioreria; imposta fuso, valuta, indirizzo, preferenze consegna.
3. Importa da CSV o aggiunge 5–10 fiori e 2 bouquet esempio.
4. Crea cliente, preventivo e ordine; visualizza margini se ha inserito i costi.
5. Se Plus, apre Builder, modifica fiori/quantità, genera preview e condivide proposta.
6. Dashboard mostra prossime consegne, ordini, stock e clienti da ricontattare.

**Evento successo onboarding:** merchant crea almeno 1 prodotto + 1 cliente + 1 ordine/preventivo entro 7 giorni (KPI, non una scadenza imposta).

## FLOW-B — Configurazione bouquet

1. Selezione merchant e ingredienti.
2. Cambiamento quantità/prezzo live, controllo stock.
3. Selezione stile/packaging e rendering on demand.
4. Anteprima con avviso illustrativo e distinta esatta.
5. Salvataggio configurazione; preventivo o checkout se abilitato.
6. Merchant conferma/produce e allega eventuale foto reale.

## FLOW-C — Contratto Floral Care diretto del merchant

1. Merchant crea scheda cliente aziendale e sito/installazione.
2. Registra piante, posizioni, vasi, istruzioni.
3. Definisce abbonamento, tipicamente 2 interventi/mese.
4. Il calendario genera gli appuntamenti; operatore compila check-list.
5. Cliente riceve istruzioni irrigazione, segnala problemi con foto.
6. Rinnovo stagionale: richiesta/consenso → preventivo → lavoro extra.

**Questo flusso NON genera fee Network se il cliente è stato acquisito direttamente dal merchant.**

## FLOW-D — Lead aziendale da Floral Network

1. Azienda crea richiesta con descrizione, foto, località, budget e frequenza.
2. Platform Admin qualifica il lead (manuale inizialmente).
3. Il sistema suggerisce merchant idonei e registra inviti.
4. Merchant rispondono con preventivi; azienda confronta e accetta.
5. Il contratto viene registrato con provenienza `network`.
6. Pagamenti/visite alimentano ledger delle commissioni e storico attività.
7. In caso di problemi, workflow issue e sostituzione fornitore secondo policy.

## FLOW-E — Proposta con Flora Studio

1. Cliente/merchant carica foto e presta consensi.
2. Seleziona pianta/vaso dal catalogo e punto sulla foto.
3. Il sistema compone un'anteprima, poi elabora immagine AI.
4. Il merchant corregge scala, verifica fattibilità, genera preventivo.
5. Cliente accetta, ordine o contratto ricorrente viene creato in Floral OS.

---

# 11. Mappa schermate e navigazione

| Area | Pagine previste | Priorità |
|---|---|---|
| Auth/Onboarding | Registrazione, login, password reset, crea fioreria, wizard import | P0 |
| Merchant Home | Overview KPI, ordini prossimi, attività, alert scorte | P0 |
| CRM | Lista clienti, dettaglio, import, ricorrenze, note | P0 |
| Catalogo | Fiori/SKU, piante, bouquet, ricette, servizi, foto | P0 |
| Inventario | Stock, movimenti, acquisti grossista, scarti | P0 |
| Ordini | Lista, creazione, dettaglio, preventivi, calendario consegne | P0 |
| Subscription | Lista contratti, piano visite, dettaglio intervento | P0 |
| AI Bouquet | Selezione ingredienti, preview, storico e quota | P0 (Plus) |
| Impostazioni | Negozio, staff, sedi, tariffe, billing e addon | P0 |
| Admin piattaforma | Merchant, supporto, piani, KPI, audit, feature flag | P0 minimo |
| Floral Network Merchant | Lead, inviti, preventivi, contratti, fee | P1 |
| Floral Network Buyer | Nuova richiesta, preventivi, sedi, contratti, assistenza | P1 |
| Flora Studio | Progetti foto, editor, varianti AI, offerta commerciale | P1 |
| Finanze avanzate | Margini, report, export, forecast, scarti | P1 |
| Public Bouquet Builder | Configuratore pubblico, condivisione, checkout | P1 |
| Marketplace B2C | Ricerca bouquet, merchant, pagamento, reviews | P2 |
| Accessori | Catalogo partner, carrello, ordine, consegna | P2 |
| Video Studio | Timeline, frame edit, rendering, anteprima video | P2 |

**Indicazione UI:** i merchant devono sempre riconoscere quali funzioni sono incluse nel piano, quali addon sono attivi e quali moduli sono beta; mai mostrare pulsanti che promettono funzionalità inesistenti.

---

# 12. Modello dati di riferimento

Modello iniziale concettuale; progettare schemi Prisma solo dopo aver verificato flussi e vincoli. Adottare ID stabili, datetime UTC e metadati timezone per la visualizzazione.

## 12.1 Entità per il gestionale

- `User(id, email, authProvider, locale, status, createdAt)`.
- `Tenant(id, legalName, displayName, marketCountry, currency, timezone, status)`.
- `Membership(id, tenantId, userId, role, status)`.
- `Location(id, tenantId, name, address, geo, deliveryZone, timezone)`.
- `SaasPlan(id, code, priceMinor, currency, entitlements)`.
- `TenantSubscription(id, tenantId, planId, billingPeriod, providerSubscriptionId, status, renewsAt)`.
- `AddonSubscription(id, tenantId, addonCode, status, limit, usageCycle)`.
- `Customer(id, tenantId, type, name, phone, email, consentFlags, acquisitionSource)`.
- `CustomerAddress(id, tenantId, customerId, recipientName, address, instructions)`.
- `Occasion(id, tenantId, customerId, type, dateParts, reminderPolicy)`.
- `CanonicalFlower(id, scientificName, commonNames, normalizedCategory, colors)`.
- `CatalogItem(id, tenantId, canonicalFlowerId?, type, sku, name, attrs, priceMinor, costMinor?, currency, availability, active)`.
- `CatalogImage(id, tenantId, itemId?, historicalBouquetId?, url, licenseScope, aiReferenceAllowed)`.
- `Supplier(id, tenantId, name, contact)`.
- `InventoryBalance(tenantId, locationId, itemId, qtyAvailable, qtyReserved, unit)`.
- `InventoryMovement(id, tenantId, itemId, locationId, kind, delta, unitCostMinor?, causeId, actorId)`.
- `BouquetRecipe(id, tenantId, catalogItemId, preparationMinutes?, packagingItemId?, styleTags)`.
- `BouquetRecipeLine(id, tenantId, recipeId, ingredientItemId, qty, unit)`.
- `Quote(id, tenantId, customerId, status, validUntil, totalMinor, currency, acquisitionSource)`.
- `QuoteLine(id, tenantId, quoteId, itemId?, description, qty, unitPriceMinor, costsSnapshot)`.
- `Order(id, tenantId, customerId, quoteId?, source, status, orderTotalMinor, currency, fulfillmentAt, addressId?)`.
- `OrderLine(id, tenantId, orderId, itemId?, configuredBouquetId?, qty, priceSnapshot, ingredientSnapshot)`.
- `Payment(id, tenantId, orderId?, customerSubscriptionId?, provider, providerPaymentId?, amountMinor, status)`.
- `Delivery(id, tenantId, orderId, slot, assigneeId?, status, proof?)`.
- `CustomerSubscription(id, tenantId, customerId, serviceTemplateId, priceMinor, cadence, nextRunAt, status, origin)`.
- `ServiceVisit(id, tenantId, customerSubscriptionId, scheduledAt, status, assigneeId?, checklist, materialUsed)`.
- `PlantInstallation(id, tenantId, customerId, siteId, catalogItemId?, potItemId?, locationNote, careGuide, condition)`.
- `CareGuide(id, tenantId, plantInstallationId, content, lastReviewedAt, publicToken?)`.
- `AiJob(id, tenantId, actorId, feature, inputRefs, outputRefs, status, usageUnits, costMinor?, createdAt)`.
- `BouquetConfiguration(id, tenantId, customerId?, ownerUserId?, configJson, priceSnapshot, status)`.
- `HistoricalBouquet(id, tenantId, title, imageIds, styleTags, recipeId?, licenseScope)`.
- `AuditLog(id, tenantId?, actorId, action, entityType, entityId, payload, timestamp)`.

## 12.2 Entità B2B e marketplace

- `BuyerOrganization(id, legalName, primaryContactId, country, status)`.
- `BuyerSite(id, buyerOrgId, address, contactId, serviceNotes)`.
- `MerchantNetworkProfile(id, tenantId, coverageZones, servicesOffered, capacity, portfolio, verifiedAt?)`.
- `ServiceLead(id, buyerOrgId, buyerSiteId, category, budgetRange, requestedCadence, photos, source, status)`.
- `LeadAssignment(id, leadId, tenantId, invitedAt, responseStatus, scoreExplanation?)`.
- `Bid(id, leadId, tenantId, version, status, totalMinor, currency, terms)`.
- `BidLine(id, bidId, kind, qty, unitPriceMinor, taxData)`.
- `NetworkContract(id, leadId, tenantId, buyerOrgId, acceptedBidId, source, billingCadence, status)`.
- `CommissionRule(id, country, channel, tier, percentBasisPoints, effectiveFrom, effectiveTo?)`.
- `CommissionLedgerEntry(id, contractId, paymentId, ruleSnapshot, basisMinor, feeMinor, status, adjustmentOf?)`.
- `PayoutRecord(id, tenantId, providerPayoutId, amountMinor, status)`.
- `Dispute(id, leadId?, orderId?, contractId?, raisedById, status, resolution)`.

## 12.3 Vincoli principali

- Ogni FK verso dati merchant deve mantenere coerenza `tenantId` (non basta filtrare solo nel frontend).
- Prezzi e importi in **unità minime intere** (`minor units`), mai floating point per denaro.
- Contratti, ordini e fee mantengono **snapshot** dei prezzi/tasse/condizioni al momento dell'accettazione.
- Un pagamento gateway deve avere chiave idempotente e riferimento provider unico; webhook ri-eseguibili in sicurezza.
- Eliminarne il catalogo non deve cancellare storici di ordini o tracce contabili: usare soft-delete/archiviazione.
- La disponibilità può essere stimata: mostrare chiaramente se lo stock è confermato o da verificare.
- `source` cliente/ordine: `merchant_direct`, `network_b2b`, `marketplace_b2c`, `import`, `manual`, con regole di attribuzione esplicite.
- Upload foto clienti/uffici protetti con URL firmati; no pubblicazione senza autorizzazione.

---

# 13. Architettura tecnica proposta

## 13.1 Principio guida

**Iniziare con un modular monolith**, anziché microservizi separati. I moduli devono avere confini di dominio chiari, ma deployment e debug semplici. Crescere verso worker e servizi dedicati soltanto quando necessario.

```text
                   [Web / Mobile Browser]
                            |
             [Next.js Frontend + BFF/API]
                            |
    ---------------------------------------------------
    | Auth | Tenancy | CRM | Catalog | Orders | Billing |
    | Stock| Care    | AI  | Network | Analytics       |
    ---------------------------------------------------
           |                   |                 |
     [PostgreSQL]        [Job Queue/Redis]   [Object Storage]
           |                   |                 |
    [Prisma ORM]         [AI Image Worker]  [Media files]
           |                   |
     [Webhook Inbox]     [AI provider API]
           |
   [Payment Provider / Email / Messaging]
```

## 13.2 Stack suggerito, non vincolante

- **Frontend:** Next.js (App Router), TypeScript, React, Tailwind; i18n per ES-MX e IT.
- **Backend:** server functions/API route o Fastify TypeScript separato se giustificato; contratti schema-first (Zod/OpenAPI).
- **DB:** PostgreSQL e Prisma; migrazioni versionate; tenant scoping centralizzato.
- **File:** S3 compatibile / Cloudflare R2 per immagini con CDN e signed URL.
- **Queue:** BullMQ + Redis o equivalente managed per job AI e webhook retry.
- **Billing:** Stripe o altro provider supportato in MX, compatibilità split/Connect da verificare; adattatore provider.
- **AI:** API immagini per generazione/edit, con adapter sostituibile e queue; non vincolare il dominio a un nome di modello.
- **Observability:** log strutturati, error tracking, metriche per job AI, pagamenti, ricerca, onboarding.
- **QA:** Vitest/unit, integrazione DB e Playwright end-to-end; CI GitHub Actions.

## 13.3 Moduli repository suggeriti

```text
/apps/web                       # Merchant + buyer + admin UI
/apps/worker                    # AI jobs, notifiche, webhook processing
/packages/db                    # Prisma schema, migrations, seeds
/packages/domain                # Contratti, entità, regole di pricing
/packages/ui                    # Design system
/packages/auth                  # Tenant scope e RBAC
/packages/ai                    # Prompt versioning, adapters, usage metering
/packages/payments              # Gateway e reconciliation
/packages/shared                # Schemi Zod, tipi, enums
/docs                           # Decision log, ADR, product spec
```

Un monorepo è **proposto**, non una decisione già presa. Claude Code deve verificare prima se esiste un repository o stack già iniziato, senza cancellarlo o reimpostarlo automaticamente.

## 13.4 Requisiti non funzionali

- Responsive da 320 px, accessibile da mobile; navigazione tastiera per flussi principali.
- Paginazione, indicizzazione ricerca e import CSV robusto.
- Multitenancy testata con dati malevoli/ID di altri tenant.
- Job AI asincroni con timeout, retry limitati, cancellazione ed errori leggibili.
- Backup DB, retention media, policy eliminazione e disaster recovery.
- Feature flags per addon, marketplace, public pages e video.
- Pagamenti idempotenti; riconciliazione, doppio webhook e chargeback.
- Configurazione crediti AI per piano e per periodo, non per numero di click frontend.
- Separazione `live` vs `demo` per impedire email/ordini reali in test.

---

# 14. API e contratti funzionali suggeriti

Non implementare tutti gli endpoint immediatamente: sono un riferimento per organizzare moduli e test. Le rotte finali e l'autenticazione saranno definite nello Sprint 0.

| Dominio | Endpoint/azione esemplificativa | Note |
|---|---|---|
| Merchant | `POST /api/tenants`, `GET /api/tenants/current` | Contesto tenant e onboarding. |
| CRM | `GET/POST /api/customers`, `GET/PATCH /api/customers/:id` | Filtro server-side tenant. |
| Catalogo | `GET/POST /api/catalog/items`, `GET /api/catalog/items/:id` | SKU, prezzo, stato. |
| Inventario | `POST /api/inventory/movements` | Solo movimenti, non qty mutate arbitrariamente. |
| Ricette | `POST /api/bouquet-recipes`, `POST /api/bouquet-configurations/price` | Pricing engine deterministico. |
| Builder AI | `POST /api/ai/bouquet-jobs`, `GET /api/ai/jobs/:id` | Quote e job status. |
| Ordini | `POST /api/quotes`, `POST /api/orders`, `POST /api/orders/:id/transition` | State machine e audit. |
| Care | `POST /api/customer-subscriptions`, `POST /api/service-visits/:id/complete` | Cadence e checklist. |
| Studio AI | `POST /api/ai/room-jobs`, `POST /api/room-projects` | Media accesso controllato. |
| Network | `POST /api/network/leads`, `POST /api/network/bids`, `POST /api/network/bids/:id/accept` | Buyer/merchant permissions. |
| Payments | `POST /api/webhooks/payments`, `GET /api/billing/usage` | Idempotenza, firma webhook. |
| Platform | `GET /api/admin/tenants`, `GET /api/admin/network/queue` | Solo super admin, log accessi. |

Per ogni endpoint definire: input Zod, output, permessi, idempotenza, eventi, status code, errori e test di isolamento. Le azioni con denaro non devono fidarsi di importi passati dal client.

---

# 15. Analytics, KPI e criteri di successo

## 15.1 SaaS

- **MRR netto e lordo** per piano e addon, trial→paid, ARPA, churn merchant e net revenue retention.
- **Activation rate:** % merchant con catalogo + cliente + primo ordine/preventivo.
- **WAU/MAU merchant** e utilizzo di catalogo, ordini, CRM e calendar.
- **Support load:** ticket per merchant, durata onboarding, richieste ripetute.
- **AI attach rate:** % Basic→Plus, quota Studio, frequenza generation e costo per rendering.
- **Gross margin SaaS:** ricavi da subscription meno costi direttamente imputabili, non confondere con ricavi B2B.

## 15.2 Floral Network

- Lead ricevuti / qualificati, tempo prima risposta, % lead con almeno un preventivo, quote→win rate.
- Contratti attivi, GMV B2B, fee incassate, valore medio contratto e churn dei contratti.
- Percentuale fioristi disponibili realmente a coprire una richiesta nella propria area.
- SLA e customer satisfaction, dispute e rimborsi, commissioni insolute.
- Acquisizione: costo per lead qualificato e costo per contratto vinto.

## 15.3 Bouquet Builder e Flora Studio

- Avvio configurazione → prima preview → richiesta preventivo → ordine.
- Latenza P50/P95 generazioni, failure rate, costo immagini realmente utilizzate.
- Frequenza rigenerazione, tasso di riacquisto, feedback su fedeltà delle immagini.
- Incremento conversione rispetto al flusso tradizionale, misurato e non dato per scontato.

## 15.4 Traguardi di validazione (indicativi)

- Intervistare **15–20 fioristi** di Aguascalientes prima di congelare scope MVP.
- Ottenere **5–10 fioristi paganti** nella prima coorte pilota, non soltanto iscrizioni gratuite.
- Validare almeno **3–5 richieste B2B reali** e una procedura di preventivazione utilizzabile anche manualmente.
- Misurare costi e qualità di almeno **100 render AI** prima di garantire un numero di crediti incluso nei piani.
- Decidere ampliamento città solo dopo retention, frequenza d'uso e domanda B2B confermate.

---

# 16. Roadmap implementativa e backlog per Claude Code

Le durate sono **indicative**, non promesse. Le fasi commerciali possono sovrapporsi allo sviluppo. Priorità per il prossimo passo: uno **vertical slice completo** con tenant, catalogo, CRM, preventivo e Builder, non molti moduli scollegati.

## Fase 0 — Discovery e foundation (Settimane 0–2)

- Interviste strutturate a fioristi; definire 3 personas e top-5 workflow.
- Scegliere stack e provider principali, controllare eventuale repo esistente.
- Decision record/ADR: tenancy, pricing, schema catalogo, AI usage, money/tax model.
- Setup repo, lint, typecheck, test, CI, environment template, seed demo.
- Auth, tenant, ruoli base, design system e i18n ES-MX.

**Uscita:** dashboard merchant demo con login, tenant scope funzionante e dati seed.

## Fase 1 — Floral OS gestionale (Mesi 1–3 indicativi)

**Slice 1:** onboarding tenant, staff, impostazioni, subscription SaaS (prima anche simulata), feature flags.  
**Slice 2:** catalogo `Flower/SKU/Plant/Service`, ricette bouquet, upload immagini.  
**Slice 3:** CRM, contatti, indirizzi, preferenze, import CSV.  
**Slice 4:** stock movements, disponibilità, scarti, costi ingredienti.  
**Slice 5:** preventivi, ordini, stati, pricing, calendario operativo.  
**Slice 6:** customer subscriptions, visite e istruzioni di base.  
**Slice 7:** AI Bouquet Builder P0: configurazione → prezzo deterministico → preview AI → preventivo.  
**Slice 8:** billing Basic/Plus, limiti AI, onboarding e verifiche E2E.

**Uscita:** 5–10 fioristi possono gestire veri ordini e creare bouquet con AI nel piano Plus.

## Fase 2 — Domanda commerciale B2B (parallela a Fase 1)

- Landing per aziende, form, lista lead interna.
- Qualificazione e matching manuale tra richieste e merchant.
- Modello attribuzione cliente e fee anche nei contratti gestiti offline.
- Prime call a studi, hotel, cliniche e ristoranti; verificare cosa comprano davvero.

**Uscita:** primi lead e almeno una procedura ripetibile di richiesta→preventivo→servizio.

## Fase 3 — Floral Network (Mesi 4–9 indicativi)

**Slice 9:** Merchant Network Profile e coverage.  
**Slice 10:** Buyer org/site e richiesta B2B strutturata.  
**Slice 11:** Invito/matching merchant, offerte versionate.  
**Slice 12:** Accettazione preventivo, contratto e visite.  
**Slice 13:** Ledger fee, riconciliazione e provider marketplace.  
**Slice 14:** Network Pro (+9,90 €) con CRM B2B avanzato e fee proposte ridotte; attivazione solo quando serve.

## Fase 4 — Flora Studio (Mesi 6–12 indicativi)

**Slice 15:** upload immagini e progetto stanza.  
**Slice 16:** editor posizionamento, asset catalogo, scala e variante.  
**Slice 17:** job AI room, confronti prima/dopo, condivisione.  
**Slice 18:** preventivo e conversione a ordine/contratto, billing addon.

## Fase 5 — Futuro (dopo validazione)

- Editor bouquet quasi-real-time più preciso, con geometria/asset scontornati.
- Pubblicazione Bouquet Builder su pagine merchant e checkout completo.
- Marketplace pubblico B2C bouquet; matching consumer per fiori, prezzo e posizione.
- Marketplace accessori e beni di terze parti.
- Video editor per Flora Studio con tracking oggetti e generazione asincrona.
- Multi-sede, account enterprise, mercato italiano con adattamento fiscale e lingua.

---

# 17. Test, quality gate e definition of done

## 17.1 Definition of Done per ogni funzionalità

- User story chiara con ruolo, scenario principale e almeno un errore atteso.
- Input validati client e server; tenant permissions verificate.
- Test unitari per regole di dominio; integration per query DB/API; E2E per flusso utente critico.
- Log errori e UI feedback con stati loading, empty, success, failure.
- Controllo responsive, accessibilità base e traduzioni es-MX dove applicabile.
- Nessuna chiave API nel client, nessun segreto in repo; `.env.example` aggiornato.
- Migrazione DB ripetibile, seed non distruttivo, documentazione aggiornata.
- Nessun modulo dichiarato completo se ha bottoni finti o pagamenti simulati spacciati per reali.

## 17.2 Esempi di acceptance test

**TEN-01:** un utente staff del tenant A tenta GET/PATCH di un ordine B e riceve accesso negato, con audit.  
**CAT-01:** SKU `rosa rossa` con disponibilità 6 non consente checkout di 10 unità senza conferma speciale.  
**BQ-01:** 7 rose × prezzo + 5 tulipani × prezzo + packaging genera totale coerente; l'immagine AI non modifica il totale.  
**BQ-02:** se AI fallisce, configurazione e preventivo rimangono, e non appare anteprima inventata.  
**ORD-01:** ordine accettato mantiene snapshot di prezzi anche se il merchant modifica successivamente listino.  
**CARE-01:** un contratto da 2 visite/mese pianifica correttamente appuntamenti e non crea rinnovi stagionali automatici non autorizzati.  
**NET-01:** un contratto merchant-direct non genera alcuna commissione Network.  
**NET-02:** un contratto Network con storno parziale genera rettifica fee, senza doppio incasso.  
**BILL-01:** utente Basic non può consumare risorse del Builder senza upgrade; la quota Plus scade/rinnova in modo coerente.  
**MEDIA-01:** foto di ufficio di un'azienda non accessibile da URL non autorizzato.

---

# 18. Privacy, pagamenti, conformità e rischi

## 18.1 Privacy e sicurezza

- Messico: verificare adempimenti privacy applicabili (LFPDPPP e relative disposizioni); successivamente GDPR per Italia/UE.
- Separare dati dei merchant, clienti merchant e buyer Network; informativa e ruoli titolare/responsabile per ogni trattamento.
- Consensi per marketing, immagini di clienti e ambienti, uso delle foto storiche come riferimenti AI.
- Policy retention e diritto cancellazione/export, con eccezioni per record fiscali e contabili.
- Rispettare condizioni e privacy dei provider AI; foto private non devono finire in dataset cross-merchant.
- Protezione upload: scansione, whitelist tipi, limiti dimensione, signed URLs, rate limit, moderazione in caso di contenuti inappropriati.

## 18.2 Fiscalità e pagamenti

- **DA VALIDARE con contador messicano:** IVA, ISR, CFDI, trattamento delle commissioni di intermediazione e dei contratti ricorrenti.
- **DA VALIDARE con professionista legale:** termini piattaforma, merchant agreement, cancellazioni, contestazioni, consumer protection, responsabilità del servizio, uso foto e diritti AI.
- **DA VALIDARE con payment provider:** account merchant, fee processing, split payment, KYC, payout, chargeback, incassi ricorrenti e fondi trattenuti.
- La piattaforma non deve emettere automaticamente documenti fiscali definitivi senza integrazione adeguata al Paese.

## 18.3 Rischi prioritari e mitigazioni

| Rischio | Effetto | Mitigazione proposta |
|---|---|---|
| Fioristi non vogliono un altro software | Scarso MRR | Interviste, onboarding assistito, import CSV, valore operativo immediato. |
| Differenza Basic/Plus di 7 € non copre abuso AI | Margini ridotti | Quote, caching, fair use e pacchetti di crediti. |
| Stock reale non sincronizzato | Ordini impossibili | Stati disponibilità, conferma manuale, riserva e sostituzioni autorizzate. |
| AI inventa dettagli bouquet | Reclami cliente | Distinta esatta, preview illustrativa, fotografia prodotto finito. |
| Foto clienti e uffici sensibili | Problemi privacy | Permessi, retention, consensi e URL firmati. |
| B2B non genera lead all'inizio | Network Pro poco attraente | Non monetizzare addon prima di consegnare valore. |
| Merchant aggira commissione | Ricavi Network persi | Benefici continuativi, workflow, pagamenti/assistenza, attribution contrattuale. |
| Concentrazione su poche aziende | Ricavi instabili | Portafoglio diversificato e pipeline multi-città. |
| Complexity creep e scope troppo grande | Ritardi MVP | Slice verticali, feature flags e DoD per modulo. |
| Costi supporto e onboarding superiori al previsto | Margine SaaS eroso | Self-service, template, guida, telemetria, onboarding standardizzato. |

---

# 19. Decisioni ancora aperte (da validare prima di costruire parti specifiche)

Questa sezione è intenzionale: **non trasformare automaticamente ogni suggerimento in una decisione già approvata.**

1. **Brand:** Floral OS, Floral Network, Flora Studio sono nomi di lavoro; ricerca marchi e domini necessaria prima della registrazione.
2. **Piani definitivi:** prezzi, IVA inclusa/esclusa, trial, annuale scontato, utenti/sedi/ordini per piano e quota AI.
3. **Builder pubblico al day one?** Decisione operativa da concretizzare: merchant-facing P0 certamente; checkout pubblico può seguire nella P1 per ridurre scope, purché il Builder sia realmente disponibile col gestionale.
4. **Payments MX:** provider per canone SaaS, gateway diretto merchant, marketplace split/payout, oneri e resi.
5. **Scontrini/fatture:** integrazioni fiscali messicane necessarie prima di promettere POS fiscale.
6. **Catalogo fiori canonico:** tassonomia, varietà e unità di misura; disponibilità grossisti spesso non in tempo reale.
7. **Qualità AI:** provider/modello, costo rendering, quote incluse, immagini referenziali, diritti foto e policy di conservazione.
8. **Pricing Network:** fee 10%/7%, frequenza, durata attribuzione, commissioni di pagamento, definizione lead acquisito.
9. **SLA e dispute B2B:** responsabilità per manutenzione, danni, piante morte e sostituzioni; termini e assicurazioni merchant.
10. **Internazionalizzazione:** quando aprire Italia, fatturazione e privacy, costi di supporto multilingua.
11. **Ruolo della partner:** tempo commerciale disponibile, attività sul territorio, supporto merchant e collaborazione contrattuale.
12. **Marketplace B2C:** timing reale subordinato alle metriche e qualità Network.

---

# 20. Istruzioni operative immediate per Claude Code

## Primo obiettivo: NON sviluppare tutto insieme

1. **Leggere integralmente questa specifica e `CLAUDE_CODE_START.md`.**
2. Se c'è un repository esistente, **ispezionarlo prima**: non cancellare file, non reinstallare tutto, non scegliere un nuovo stack senza motivazione.
3. Creare un `docs/DECISIONS.md` che separi decisioni definitive, proposte e aspetti aperti.
4. Definire uno **Sprint 0** eseguibile: architettura, package manager, schema tenancy, auth, migrazioni e seed fioreria demo.
5. Creare backlog con task atomici collegati agli ID (`CORE-01`, `CAT-01`, `AI-BQ`, ecc.).
6. Implementare **un vertical slice**: login → merchant → catalogo → cliente → configurazione bouquet → preventivo con prezzo corretto → job AI mock e poi provider reale.
7. Includere test tenant isolation, pricing e stock prima di ampliare le funzionalità.
8. Lavorare per PR/slice completi, aggiornando decision log e changelog.

## Deliverable Sprint 0

- README con setup locale, `.env.example` e istruzioni DB.
- Monorepo o repo modulare proposto, funzionante con lint/typecheck/test.
- Auth tenant-scoped e 3 ruoli merchant (owner/manager/staff).
- Prisma schema minimo con `User`, `Tenant`, `Membership`, `CatalogItem`, `Customer`, `BouquetRecipe`, `Quote`, `AiJob`.
- Seed esempio di fioreria con 5–10 SKU e 2 ricette bouquet.
- Una pagina dashboard e una pagina catalogo funzionanti, non mock statici.
- Piano Sprint 1 scritto e prioritizzato dopo review.

## Successo dell'MVP

Un fiorista reale paga Floral OS Plus, configura catalogo, clienti e ordini, crea un bouquet personalizzato con quantità corrette, ottiene un preventivo e un'anteprima AI e riesce a gestire la produzione senza Excel. Contemporaneamente, i founder possono raccogliere e assegnare manualmente i primi lead aziendali.

---

# 21. Glossario rapido

- **Merchant / fiorista:** venditore che paga Floral OS e realizza i servizi.
- **Tenant:** spazio dati isolato di una fioreria/azienda merchant.
- **Buyer:** privato o azienda che compra da un merchant o tramite Network.
- **BOM (Bill of Materials):** distinta ingredienti/quantità che rende producibile un bouquet.
- **MRR:** ricavo mensile ricorrente SaaS della piattaforma.
- **GMV:** valore totale venduto dai merchant attraverso il marketplace, non ricavo della piattaforma.
- **Take rate:** percentuale di GMV riconosciuta alla piattaforma.
- **Floral OS Plus:** piano che integra Bouquet Builder.
- **Floral Network:** canale di acquisizione B2B, matching e contratti.
- **Flora Studio:** editor e AI per allestimenti in ambienti.
- **Subscription merchant:** abbonamento pagato dal fiorista per Floral OS.
- **Customer subscription:** contratto ricorrente venduto dal fiorista a un suo cliente finale.
- **Direct merchant order:** vendita originata dal fiorista, non soggetta a fee marketplace per il solo uso del gestionale.

---

# 22. Riferimenti di mercato da riesaminare

In conversazione sono stati citati, come esempi di panorama competitivo e non come benchmark definitivamente validati al 21 novembre 2026:

- Florame.ai (Italia): https://florame.ai/ — bouquet personalizzabili e AI.
- Lili / HolaLili (Messico): https://www.holalili.app/ — bouquet configurabili e discovery locale.
- FlorApp (Messico): https://florapp.mx/ — gestionale per fiorerie.
- Benli (Messico): https://benli.ai/florerias/ — software per fiorerie.
- BloomNation (USA): https://www.join.bloomnation.com/ — merchant software e network.

**Nota:** prezzi, funzionalità, disponibilità e posizionamento dei competitor possono cambiare. Non assumere dati esterni non verificati come requisito tecnico.

---

**Fine master specification — Floral OS v1.0**  
Questa specifica è una base per progettare e implementare, non sostituisce ricerca con i merchant, consulenza fiscale/legale e test AI su dati reali.
