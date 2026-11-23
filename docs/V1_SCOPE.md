# V1 — il prodotto finito

**Stato: PROPOSTO (22/11/2026).** Nasce dalla decisione del founder D-22: ai clienti veri arriva
solo un prodotto finito, non un pilota. Fino ad allora l'app la usano il founder e alcuni tester.
Questo documento dice **cosa** deve contenere la V1, **quando** una parte si considera finita e in
che **ordine** ci arriviamo. Fonte dei requisiti: `docs/FLORAL_OS_MASTER_SPEC.md` (priorità P0).

## 1. Regole

- Nessun cliente reale prima che la V1 sia completa. Prima della V1: ambiente online di prova, dati
  di prova o dati dei tester (con il loro consenso), nessun pagamento reale.
- "Finito" non vuol dire "funziona": ogni parte della V1 rispetta il criterio della sezione 3.
- Niente funzioni finte o "prossimamente" cliccabili, nemmeno in V1.

## 2. Cosa contiene la V1

Legenda: ✅ fatto · 🟡 parziale · ⬜ da fare.

| #   | Area (spec)                                      | Fatto oggi                                                                                                                                                                                                                                                                                                                                         | Manca per la V1                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Accesso e account (CORE-01)                      | ✅ registrazione con email verificata, login, recupero password, login con Google, limiti anti-abuso                                                                                                                                                                                                                                               | ⬜ verifica in due passaggi per i proprietari; ⬜ sessioni attive e chiusura a distanza                                                                                                                                                                                                                                                           |
| 2   | Fioreria e squadra (CORE-01)                     | ✅ creazione guidata con indirizzo messicano, più fiorerie per utente, ruoli, inviti, disattivazione                                                                                                                                                                                                                                               | ⬜ logo; ⬜ giorni e orari; ⬜ zone, raggio e tariffe di consegna; ⬜ impostazioni dei preventivi (validità; IVA con il contador, O-06)                                                                                                                                                                                                           |
| 3   | Piano, utilizzo e abbonamento (CORE-01, billing) | ✅ piani Basic/Plus con quota AI e pacchetti extra (assegnati dalla piattaforma)                                                                                                                                                                                                                                                                   | ⬜ piani rifatti sui livelli **Esencial** e **Profesional** con add-on (D-23, prezzi in `docs/BUSINESS_MODEL.md`); ⬜ prova gratuita (O-12); ⬜ pagamento con carta (Stripe, prima in modalità di prova); ⬜ fatture, cambio piano, disdetta; ⬜ acquisto dei crediti AI dall'app. L'intestatario dei pagamenti si decide prima del lancio (O-02) |
| 4   | Clienti (CRM-01)                                 | ✅ scheda persona/azienda, indirizzi, ricorrenze, consenso marketing, WhatsApp                                                                                                                                                                                                                                                                     | ⬜ cronologia (preventivi, ordini, consegne, abbonamenti); ⬜ etichette e filtri; ⬜ import da CSV con anteprima; ⬜ "nuovo ordine" dalla scheda                                                                                                                                                                                                  |
| 5   | Catalogo (CAT-01)                                | ✅ tipi di articolo, prezzi e costi, disponibilità, ricette (distinta), foto con scontorno                                                                                                                                                                                                                                                         | ⬜ regole di sostituzione; ⬜ servizi con durata e zona; ⬜ fornitore e tempi di preparazione; ⬜ etichette; 🟡 elenco ufficiale dei fiori (O-09)                                                                                                                                                                                                 |
| 6   | Inventario (INV-01)                              | —                                                                                                                                                                                                                                                                                                                                                  | ⬜ giacenze per articolo; ⬜ movimenti (acquisto, consumo, scarto, rettifica, reso); ⬜ acquisti dal grossista; ⬜ riserve con scadenza; ⬜ avvisi di scorta; ⬜ costo previsto e reale                                                                                                                                                           |
| 7   | Preventivi (ORD-01)                              | ✅ righe da catalogo e dal Diseñador, stati, numerazione, stampa e PDF, immagine del ramo, WhatsApp                                                                                                                                                                                                                                                | ⬜ link pubblico per il cliente con accettazione (approvato il 21/11); ⬜ conversione in ordine                                                                                                                                                                                                                                                   |
| 8   | Ordini, pagamenti e consegne (ORD-01)            | —                                                                                                                                                                                                                                                                                                                                                  | ⬜ ordine da preventivo o diretto; ⬜ stati fino a consegnato e completato, più annullato e rimborsato; ⬜ acconto e saldo registrati a mano; ⬜ ritiro, consegna o servizio con data, fascia, destinatario e costo; ⬜ link pubblico dello stato; ⬜ calendario e promemoria; ⬜ foto del ramo finito e nota di consegna                         |
| 9   | Abbonamenti dei clienti (SUB-01)                 | —                                                                                                                                                                                                                                                                                                                                                  | ⬜ contratti ricorrenti (prodotto o servizio, frequenza, prezzo, pausa, chiusura); ⬜ attività programmate per il personale con esito, materiali e foto                                                                                                                                                                                           |
| 10  | Floral Care (CARE-01)                            | —                                                                                                                                                                                                                                                                                                                                                  | ⬜ piante per sede del cliente; ⬜ schede di cura; ⬜ calendario delle manutenzioni con checklist; ⬜ rinnovo stagionale con preventivo                                                                                                                                                                                                           |
| 11  | Report (BI-01)                                   | 🟡 pannello con catalogo, primi passi, attività, ricorrenze                                                                                                                                                                                                                                                                                        | ⬜ fatturato per periodo, ticket medio, prodotti venduti, ricavi ricorrenti, margine lordo solo con costi completi, scarti, prossimi interventi                                                                                                                                                                                                   |
| 12  | Diseñador con AI (AI-BQ P0)                      | ✅ prezzo dalla distinta, anteprime AI, anteprima esatta con conteggio verificato, quota, preventivo                                                                                                                                                                                                                                               | ⬜ contenitori e dimensione del ramo nel boceto; ⬜ scelta della foto di copertina; ⬜ prova da ~100 immagini con foto vere (costo reale); ⬜ storico delle generazioni                                                                                                                                                                           |
| 13  | Email e avvisi                                   | ✅ verifica, inviti, recupero password                                                                                                                                                                                                                                                                                                             | ⬜ preventivo e conferma d'ordine al cliente; ⬜ promemoria interni (consegne del giorno, ricorrenze, manutenzioni)                                                                                                                                                                                                                               |
| 14  | Amministrazione della piattaforma (P0 minimo)    | ✅ strumenti a riga di comando (piani, crediti, primo amministratore), lanciabili da GitHub senza installare nulla                                                                                                                                                                                                                                 | ⬜ pannello: fiorerie, piani, supporto, audit, interruttori delle funzioni                                                                                                                                                                                                                                                                        |
| 15  | Privacy e termini                                | ✅ bozze di aviso de privacidad e termini (`docs/legal/`)                                                                                                                                                                                                                                                                                          | ⬜ revisione dell'avvocato; ⬜ pagine pubbliche e consensi nell'app; ⬜ esportazione e cancellazione dei dati su richiesta (diritti ARCO)                                                                                                                                                                                                         |
| 16  | Piattaforma (`docs/PLATFORM_PLAN.md`)            | ✅ errori e log, configurazione unica, errori silenziosi, immagini private, sicurezza delle dipendenze, job AI su Vercel, azioni, percorsi, elenchi e componenti condivisi, CI vera a ogni push, scadenze con un lavoro giornaliero, ambiente di prova online su Vercel con rilasci dal ramo `staging` (ADR-041, guida in `docs/DEPLOY_VERCEL.md`) | ⬜ anteprime per PR e deploy dalla CI; ⬜ Sentry e monitor; ⬜ backup con prova di ripristino; ⬜ scansione dei segreti e aggiornamenti automatici; ⬜ immagini con URL firmati (quando serviranno)                                                                                                                                               |

## 3. Quando una parte è "finita"

Ogni schermata e ogni flusso della V1:

1. **Funziona ovunque:** telefono da 320 px, tablet e computer; uso da tastiera; contrasti leggibili.
2. **Ha tutti gli stati:** caricamento, vuoto (che spiega cosa fare), errore (che dice come
   rimediare, con codice di riferimento se è inatteso) e conferma.
3. **Parla come il fiorista:** testi in spagnolo del Messico rivisti, termini del mestiere, nessun
   termine tecnico; aiuto breve dove serve la prima volta.
4. **È sicura:** permessi per ruolo e isolamento fra fiorerie verificati da test (A↔B); azioni
   importanti nel registro di audit; nessuna cancellazione definitiva di dati commerciali.
5. **È provata:** test del dominio, dei servizi sul database reale e del flusso principale da
   utente; tutti verdi prima di ogni rilascio.
6. **È veloce:** pagine principali sotto i 2 secondi su 4G (da misurare sull'ambiente online),
   immagini leggere.
7. **Si stampa** dove serve: preventivi (fatto), ordini, schede di cura.

## 4. Fuori dalla V1 (dopo il lancio)

Ordine e condizioni di ogni tappa in `docs/ROADMAP.md`; prezzi e fee in `docs/BUSINESS_MODEL.md`.

- **Studio** (foto degli ambienti con le piante; nella spec "Flora Studio", con il nome proposto
  "Gardelia Studio"): **dopo il lancio**, come primo addon (confermato dal founder il 22/11/2026).
  Con lui apre il livello **Premium** (D-23).
- Diseñador pubblico per i clienti della fioreria (AI-BQ-10), pagamenti online dei clienti delle
  fiorerie (fee dell'1–2%, D-24), WhatsApp automatico, notifiche push, più sedi.
- **Marketplace per i privati**: ordini inviati alle fiorerie in zona, fee del 10–15% sugli ordini
  portati da Gardelia (D-24).
- **Aziende** (Floral Network): prima come intermediario, poi il servizio gestito solo se
  l'intermediario ha portato ricavi (D-25).
- Mercato italiano, accessori, video.

## 5. Ordine di lavoro proposto

1. Resto della fase 0 e **ambiente online di prova** su Vercel, per provare l'app dal telefono.
2. **Ordini, pagamenti registrati e consegne** con calendario, più i link pubblici di preventivo e
   ordine: il cuore del lavoro quotidiano.
3. **Inventario.**
4. **Clienti completi:** cronologia, etichette, import CSV.
5. **Abbonamenti e Floral Care.**
6. **Report.**
7. **Impostazioni della fioreria complete** ed email agli utenti.
8. **Abbonamento a pagamento** sui livelli Esencial e Profesional (D-23; Stripe in modalità di
   prova) e **pannello della piattaforma**.
9. **Privacy nell'app:** pagine, consensi, esportazione e cancellazione dei dati.
10. **Rifinitura generale** (testi, accessibilità, prestazioni), prova con i tester e Diseñador con
    foto vere. Poi il lancio.
