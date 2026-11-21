# Prompt iniziale da incollare in Claude Code — Floral OS

Stai lavorando al progetto **Floral OS**, una piattaforma SaaS multi-tenant per fioristi, con **AI Bouquet Builder incluso nel piano Plus**, un marketplace **Floral Network** B2B da sviluppare progressivamente e un addon futuro **Flora Studio AI**.

**Documento di riferimento obbligatorio:** leggi integralmente `docs/FLORAL_OS_MASTER_SPEC.md` (o `FLORAL_OS_MASTER_SPEC.md` nella cartella corrente). Questo documento contiene decisioni, requisiti funzionali, roadmap, ruoli, modello dati, flussi, business model, vincoli di sicurezza e criteri di accettazione. Quando trovi un conflitto fra questo prompt e la specifica, segnalalo prima di implementare.

## Regole di lavoro

1. **Ispeziona il repository prima di fare qualunque modifica.** Se contiene codice esistente, descrivine stack, struttura, criticità e componenti riutilizzabili. Non azzerarlo e non sostituire l'architettura senza motivazione.
2. **Distingui le decisioni confermate da quelle proposte o da validare.** Non spacciare ipotesi di pricing, provider o modello fiscale per scelte definitive.
3. **Non provare a creare tutto il prodotto in un'unica iterazione.** Lavora per slice end-to-end, con implementazione funzionante e test.
4. **Priorità MVP:** autenticazione/tenant → catalogo e ricette bouquet → CRM → preventivi e ordini → Bouquet Builder AI con prezzo e quantità verificabili → billing Basic/Plus. Il marketplace B2B viene inizialmente validato con un processo manuale.
5. **Architettura:** preferisci modular monolith, TypeScript, PostgreSQL/Prisma, Next.js, queue per AI e object storage, salvo ragione tecnica espressa o stack già scelto nel repo. Applica isolamento per tenant in TUTTI gli endpoint e gli accessi DB.
6. **Money:** usa integer minor units; pricing e commissioni solo lato server. Il render AI non determina quantità, inventario, costi o prezzi.
7. **AI:** output asincrono, quote, retries limitati, error states, caching dove corretto, protezione immagini. Non costruire mock che sembrano funzionalità live.
8. **Linguaggio:** prodotto iniziale in spagnolo messicano (es-MX), codice e nomi dei componenti in inglese, documentazione tecnica in italiano salvo esigenze del codice.
9. **Qualità:** test automatici per tenancy, catalogo, prezzo bouquet, stock e stati ordine. Esegui lint, typecheck, test e riporta esiti reali, non dichiarare successo senza averli eseguiti.
10. **Sicurezza/legale:** non inventare fiscalità messicana, CFDI o split payments; prepara moduli con adattatori e segnala chiaramente ciò che richiede verifica con professionisti/provider.

## Primo incarico — Sprint 0

Fornisci prima un resoconto conciso dello stato del repo, quindi:

1. Proponi una struttura concreta di cartelle e moduli coerente con lo stato del progetto.
2. Crea/aggiorna `docs/DECISIONS.md` con decisioni confermate, proposte e aperte, inclusi gli ADR tecnici.
3. Prepara o verifica la base applicativa: setup, `.env.example`, lint, typecheck, test, CI, database e migrazioni.
4. Implementa la fondazione multi-tenant: `User`, `Tenant`, `Membership`, autorizzazioni owner/manager/staff, logiche di tenancy lato server.
5. Crea un seed demo con una fioreria, almeno 8 SKU (fiori/piante/accessori), 2 ricette bouquet e 3 clienti.
6. Realizza una dashboard minima reale, onboarding e catalogo CRUD funzionante.
7. Scrivi test che dimostrino che il tenant A non può leggere o modificare dati del tenant B.
8. Produci un backlog Sprint 1 ordinato e stimato per il vertical slice CRM → preventivo → Builder AI.

## Come voglio l'output al termine dello Sprint 0

- Lista sintetica dei file aggiunti/modificati.
- Funzioni operative concretamente disponibili e come testarle.
- Comandi eseguiti con risultati (`lint`, `typecheck`, `test`, `build` quando applicabile).
- Decisioni aperte che bloccano una feature futura, ma non l'avvio del progetto.
- Prossimi 5–10 task prioritari, ciascuno piccolo e verificabile.

**Vincolo di scope:** non implementare video AI, marketplace B2C, accessori e pagamenti marketplace nello Sprint 0. Preparane solo i confini dati/architetturali necessari a evitare riscritture inutili.
