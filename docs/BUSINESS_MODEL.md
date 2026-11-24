# Modello economico di Gardelia

**Stato: PROPOSTO (23/11/2026)**, salvo le parti indicate come DECISO. Nasce dall'analisi fatta con
il founder il 22 e 23/11/2026. Le decisioni sono registrate in `docs/DECISIONS.md` (D-23, D-24,
D-25); l'ordine in cui arrivano le cose è in `docs/ROADMAP.md`.

Le cifre sono stime. I prezzi vanno validati con i fioristi (spec §15.4); il costo dell'AI si
riconcilia con la prova da ~100 immagini; tutto ciò che è fiscale va confermato da un commercialista
italiano e da un contador messicano (§6). Cambio di riferimento: 1 € = 20,72 MXN (spec), 1 € = 1,15
USD (ipotesi).

## 1. Listino (D-23)

**Struttura DECISA dal founder (23/11/2026):** tre livelli più qualche add-on, al posto di Basic/Plus
(D-05, D-16). **Prezzi PROPOSTI**, in MXN al mese + IVA (IVA inclusa o esclusa: O-06).

| Livello         | MXN/mese |  ~€ | Contiene                                                                                                                                                    |
| --------------- | -------: | --: | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Esencial**    |      699 |  34 | clienti, catalogo, calendario e date speciali con la loro promo (ADR-047), preventivi, **ordini, consegne, pagamenti registrati**, report di base, 2 utenti |
| **Profesional** |    1.199 |  58 | Esencial + inventario e margini, abbonamenti dei clienti e Floral Care, Diseñador con **15 immagini** al mese, 3 utenti                                     |
| **Premium**     |    1.899 |  92 | Profesional + promozioni più articolate, Diseñador con **30 immagini**, Diseñador pubblico, priorità sugli ordini dei privati, 5 utenti                     |

La promo delle date speciali resta in tutti i livelli; le promozioni più articolate sono a
pagamento (decisione del founder del 22/11/2026, O-11).

- **Al lancio solo Esencial e Profesional (PROPOSTO).** Il Premium apre quando esistono le funzioni
  che lo distinguono (Studio, Diseñador pubblico, priorità sugli ordini): la V1 non vende funzioni
  "in arrivo" (D-22, `docs/V1_SCOPE.md` §1).
- **Precio de fundador (PROPOSTO):** i primi 20 fioristi pagano il 30% in meno per 12 mesi. Serve a
  verificare i prezzi e premia chi parte per primo.
- **Gli ordini stanno nel livello d'ingresso** perché sono il motivo per cui un fiorista lascia
  WhatsApp. Un "Base" senza ordini a 500 MXN (proposta del founder del 23/11) era più caro del
  Basic della spec e dava meno.

| Add-on              |        MXN/mese |          ~€ | Note                                                        |
| ------------------- | --------------: | ----------: | ----------------------------------------------------------- |
| Studio              |           1.000 |          48 | foto degli ambienti, 12 incluse; dopo il lancio             |
| Crediti AI          | 169 / 299 / 549 | 8 / 14 / 26 | 25 / 50 / 100 immagini, senza scadenza (aggiorna ADR-024)   |
| Utente extra        |              99 |         4,8 | oltre gli utenti del livello                                |
| Sede extra          |             300 |        14,5 | dopo il lancio                                              |
| WhatsApp automatico |       a consumo |           — | costo di Meta per messaggio più un ricarico; dopo il lancio |

| Fee (D-24, D-25)                             | Quanto      | Note                                              |
| -------------------------------------------- | ----------- | ------------------------------------------------- |
| Ordini dei clienti propri del fiorista       | **nessuna** | regola della spec §3.2, confermata                |
| Ordini portati da Gardelia, privati compresi | 10–15%      | a carico del fiorista; dopo la V1 (§4)            |
| Pagamenti online tramite Gardelia            | 1–2%        | quando esisteranno i pagamenti online, dopo la V1 |
| Contratti aziendali portati da Gardelia      | 10%         | il founder aveva indicato 7%: perché 10% in §5    |

**Alternativa valutata e scartata:** listino a la carte (Base 500 MXN + otto add-on). Dava lo stesso
ricavo medio per fioreria (~1.080 MXN contro ~1.140 dei livelli) ma con sette scelte da spiegare in
negozio e un "Base" debole.

## 2. Costi per fioreria

- **AI:** ~0,11 USD (~2 MXN) per anteprima esatta riuscita (0,09 al primo tentativo, 0,18 con il
  secondo; ADR-034). Lo scontorno delle foto costa 0,002 USD (ADR-033), trascurabile.
  **Dato del founder (24/11/2026):** in fattura un'immagine gli costa circa **0,25 €**, più del
  doppio della stima (contano anche tentativi e controlli): va riconciliato con la prova da ~100
  immagini. Nella fase di prova (D-29) le anteprime si vendono a parte, con crediti.
- **Stripe Italia**, finché fattura una partita IVA italiana (O-02): 3,15% + 0,25 € per carta
  internazionale, 2% di cambio, ~0,7% per gli abbonamenti (non confermato). In tutto circa il 6,8%
  dell'importo con IVA più 0,25 € a fattura.
- **Server e servizi:** ~70 € al mese più 0,35 € a fioreria (`docs/PLATFORM_PLAN.md` §3).
- **Commercialista** ~800 € l'anno, **contador** ~900 € l'anno (stime). Email trascurabili.

Quanto resta di ogni voce dopo Stripe, AI e server: **Esencial 91%, Profesional 90%, Premium 89%,
Studio 90%, crediti AI 57–62%**. Con i prezzi dei pacchetti di ADR-024 (79/139/249 MXN), calcolati
su 0,05 USD a immagine, restava solo il 12–25%: da qui i nuovi prezzi.

Ridurre le immagini incluse cambia poco: con 60 fioristi, 10 immagini in meno a testa valgono circa
23 € al mese. Serve soprattutto a spingere i pacchetti di crediti.

## 3. Scenari con i tre livelli

Ipotesi: scelte 45% Esencial, 40% Profesional, 15% Premium; il 5% prende Studio, il 10% un utente
extra; uso medio dell'AI al 60% della quota; 8 contratti aziendali con 60 fioristi; forfettario,
gestione separata INPS, imposta al 5%. Ricavo medio ~1.140 MXN (~55 €) a fioreria. Con i soli
Esencial e Profesional del lancio (55/45) il ricavo medio è ~924 MXN.

| Fioristi | Incassi/mese | In tasca/mese | Nota                                                     |
| -------: | -----------: | ------------: | -------------------------------------------------------- |
|       30 |      1.762 € |       1.008 € |                                                          |
|       60 |      3.525 € |       2.246 € |                                                          |
|       90 |      5.287 € |       3.484 € |                                                          |
|      120 |      7.049 € |       4.722 € | vicino alla soglia del forfettario (85.000 €/anno)       |
|      150 |      8.811 € |       3.788 € | oltre la soglia, da ditta individuale: serve una società |

Dove vanno 100 € incassati con 60 fioristi: Stripe 7, AI 2, server 3, commercialista e contador 4,
**INPS 17,5**, imposta 2,5, **in tasca 64**. La voce grossa sono i contributi, non le tasse; in
gestione commercianti, a questo livello, l'INPS scende da ~616 a ~376 € al mese.

- **Pareggio:** circa 7 fioristi in gestione separata, 11 in gestione commercianti.
- **Ogni fiorista in più** lascia circa 41 € netti al mese.
- **Il limite non sono i costi ma il numero di fioristi**; la seconda leva sono le fee (§4, §5).

## 4. Fee sugli ordini (D-24)

- **Regole DECISE (founder, 23/11/2026):** nessuna fee sugli ordini dei clienti propri del fiorista;
  fee sugli ordini che porta Gardelia (pagina pubblica, Diseñador pubblico, ordini inviati alle
  fiorerie in zona), privati compresi; piccola fee sui pagamenti online. Percentuali PROPOSTE.
- **Chi paga:** il fiorista, su un incasso che senza Gardelia non avrebbe avuto. Niente costo di
  servizio al cliente finale: renderebbe Gardelia più cara di un messaggio WhatsApp al fiorista.
- **Quanto vale:** ramo medio ~600 MXN (fonti di settore poco affidabili, 300–800) → 90 MXN a ordine
  al 15%; circa 8 ordini al mese valgono un Esencial; 100 ordini al mese ad Aguascalientes ≈ 430 €.
  Picchi: 14 febbraio, 10 maggio, 2 novembre, 12 dicembre.
- **Riscossione:** all'inizio l'ordine portato da Gardelia resta segnato nell'app (origine del
  cliente, enum `AcquisitionSource`) e la fee si aggiunge alla fattura mensile del fiorista, senza
  soldi che passano da Gardelia. Con i pagamenti online la fee si trattiene in automatico: serve un
  provider con divisione degli incassi (spec §8.5) e probabilmente una società messicana.
- **Costo nascosto:** gli ordini dei privati vanno portati su Gardelia con pubblicità. La fee deve
  coprirla.

## 5. Aziende (D-25)

**DECISO (founder, 23/11/2026):** per ora solo il marketplace per i clienti e gli ordini. Le aziende
partono come **intermediario**; il **servizio gestito** si fa solo dopo che l'intermediario ha
portato ricavi.

**Intermediario (PROPOSTO):**

- l'impresa firma con il fiorista, che le emette la CFDI; Gardelia prende una fee sulle fatture
  pagate, addebitata al fiorista;
- ogni cliente ha un **fiorista titolare** e una o due **riserve** per picchi, ferie e imprevisti;
- una **ricetta standard del cliente** (distinta e foto) fa consegnare la stessa cosa a fioristi
  diversi;
- **pagamento per consegna confermata** (foto e conferma del cliente, spec §8.3): chi consegna
  incassa, meno la fee;
- periodo di attribuzione nel contratto, proposta 12 mesi (O-10);
- clienti: hotel indipendenti, ristoranti, uffici e cliniche di Aguascalientes, partendo da Floral
  Care (piante con visite). Niente catene finché non c'è copertura nazionale.

**Perché 10% e non 7%.** Vendere a un'impresa, seguirla e gestire le contestazioni richiede persone.
Con persone a stipendio fisso il Network al 7% perde soldi (−168 € al mese con 18 clienti, −478 con
57), al 10% è in pari, al 15% guadagna. Se chi vende è pagato a percentuale (proposta: 30% della fee
di ogni cliente che porta, per il primo anno; O-13) il Network rende dal primo cliente.

Spesa mensile stimata per tipo di cliente, da verificare con 3–5 imprese vere: ufficio o clinica con
piante 4.000 MXN; ristorante con fiori settimanali 6.000; hotel medio 15.000; hotel grande 40.000;
evento aziendale 30.000 una tantum.

**Servizio gestito (fase successiva, condizionata):** Gardelia firma con l'impresa e le emette una
CFDI unica, con un referente e report per sede; paga i fioristi per consegna confermata; margine del
20–25% oppure quota di gestione per sede (~1.500 MXN per hotel) più fee. Rende 3–4 volte di più per
cliente, ma richiede una società messicana, capitale (gli hotel pagano a 30–90 giorni, i fioristi
vanno pagati ogni settimana) e un'assicurazione. Attenzione: Gardelia diventa fornitore del servizio
e il suo ricavo fiscale è l'intero importo, non la sola fee.

Il modello dati del Network (spec §12.2: `NetworkContract` con una sola offerta accettata) andrà
esteso con assegnazioni per consegna e fioristi di riserva.

## 6. Fiscalità e pagamenti: DA VALIDARE (O-02)

Orientamento, non consulenza: ogni punto va confermato da commercialista e contador.

- **Per partire:** partita IVA italiana (regime forfettario) e Stripe Italia, con i soldi su un conto
  italiano e le tasse pagate in Italia, è praticabile. **Nessun prestanome:** i ricavi e l'attività
  sarebbero legalmente della persona, con rischi fiscali e antiriciclaggio.
- **Fase gratuita:** senza incassi non serve la partita IVA; si apre poco prima del primo pagamento.
  La normativa sui dati personali vale comunque (LFPDPPP, e probabilmente il GDPR per chi tratta i
  dati dall'Italia); nei termini il titolare è il founder come persona fisica.
- **IVA messicana:** l'IVA del 16% la paga il fiorista sopra il prezzo e va girata al fisco
  messicano. Un fornitore estero di servizi digitali probabilmente deve iscriversi al RFC e versarla
  ogni mese (LIVA art. 18-B e seguenti): va confermato se il SaaS rientra.
- **CFDI:** i fioristi la chiederanno per dedurre il costo; una partita IVA italiana non la emette.
- **Ritenuta ISR:** il Messico potrebbe trattare il canone come royalty; per software standard di
  solito non si applica. Va confermato.
- **Forfettario:** imposta del 5% nei primi cinque anni (poi 15%) sul 67% dei ricavi; INPS in
  gestione separata (26,07%) o commercianti (fisso 4.611,64 € nel 2026, ridotto del 35%): lo decide
  il commercialista in base all'attività.
- **Soglia di 85.000 € l'anno** (circa 120 fioristi): oltre si perde il forfettario e si guadagna meno.
  Prima serve una società.
- **Residenza fiscale:** dove vive il founder conta più di dove arrivano i soldi.

**Domande per il contador:** il SaaS rientra nei servizi digitali dell'art. 18-B? Serve un
rappresentante o domicilio in Messico, e con che responsabilità? Il fiorista deve trattenere ISR sul
canone? Può dedurre il costo con una fattura estera? Le fee sugli ordini fanno di Gardelia una
piattaforma di intermediazione con ritenute, anche se non incassa? Per le aziende, intermediario o
fornitore? Il commerciale in Messico crea una stabile organizzazione?

**Domande per il commercialista:** gestione INPS separata o commercianti? Codice ATECO? Quando
conviene la società, e italiana o messicana?

## 7. Ipotesi da verificare

| Ipotesi                               | Valore usato              | Come verificarla                    |
| ------------------------------------- | ------------------------- | ----------------------------------- |
| Prezzi e scelta dei livelli           | 699/1.199/1.899; 45/40/15 | interviste e precio de fundador     |
| Costo di un'anteprima AI              | 0,11 USD                  | prova da ~100 immagini, fattura fal |
| Uso medio dell'AI                     | 60% della quota           | dati d'uso dopo il lancio           |
| Studio                                | 12 foto a 0,15 USD        | quando si costruisce                |
| Commissione per abbonamento di Stripe | 0,7%                      | listino Stripe                      |
| Commercialista e contador             | 800 e 900 € l'anno        | preventivi                          |
| Vendite di una fioreria               | 60.000 MXN al mese        | interviste ai fioristi              |
| Spesa delle imprese                   | 4.000–40.000 MXN al mese  | 3–5 imprese vere (spec §15.4)       |
| Nessuna ritenuta ISR sul canone       | —                         | contador                            |

Non sono contati: il lavoro dei founder, la pubblicità, i viaggi, i fioristi che disdicono e le
oscillazioni del cambio.
