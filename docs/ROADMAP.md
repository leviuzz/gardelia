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
   A1–C5 in `docs/ORDERS_MARKETPLACE_PLAN.md`.
3. Inventario.
4. Clienti completi: cronologia, etichette, import CSV.
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
- chiave di Google Places per gli indirizzi (O-14);
- fase gratuita: se, quando e come (O-12).

**Traguardo:** V1 completa secondo `docs/V1_SCOPE.md` §3.

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

## Soglie da tenere d'occhio

| Soglia                                  | Cosa fare                                                          |
| --------------------------------------- | ------------------------------------------------------------------ |
| Primo incasso                           | partita IVA aperta e decisione O-02 presa                          |
| ~120 fioristi o 85.000 € l'anno         | società pronta prima, o si perde il forfettario e si guadagna meno |
| Prima catena o primo cliente multi-sede | società messicana e capitale per i pagamenti a 30–90 giorni        |
