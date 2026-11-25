# Documenti legali — bozze da revisionare

**Stato: BOZZE (22/11/2026, compradores 23/11/2026), scritte su richiesta del founder (O-07). Non
pubblicare in produzione senza la revisione di un avvocato messicano.** Dal blocco C5 (ADR-068)
l'app le mostra alle pagine `/privacidad`, `/terminos` e `/terminos/compradores` **così come sono,
con il riquadro "BORRADOR"**, perché il founder e l'avvocato le vedano nel loro contesto su staging.
La registrazione e l'invio di un ordine online rimandano a queste pagine.

| File                                                       | Cosa contiene                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`aviso-de-privacidad.md`](./aviso-de-privacidad.md)       | Aviso de privacidad integral per gli utenti di Gardelia                        |
| [`terminos-y-condiciones.md`](./terminos-y-condiciones.md) | Termini del servizio, con la clausola sul trattamento per conto delle fiorerie |
| [`terminos-compradores.md`](./terminos-compradores.md)     | Termini per chi compra dalle tiendas en línea (marketplace, D-26)              |

**Come si aggiorna un testo:** si modifica il file `.md` qui, poi
`pnpm --filter @floral/web legal:sync` lo porta nell'app (`apps/web/src/content/legal.generated.ts`);
il test `apps/web/test/legal-content.test.ts` fallisce se ci si dimentica. Quando un testo diventa
definitivo si toglie il riquadro "BORRADOR" e si aggiorna `LEGAL_VERSION` (`packages/domain/src/legal.ts`),
che si registra con ogni ordine online.

## Come sono state scritte

- Struttura secondo la nuova **Ley Federal de Protección de Datos Personales en Posesión de los
  Particulares** (DOF 20/03/2025, in vigore dal 21/03/2025), che ha sostituito la legge del 2010;
  l'autorità competente è ora la **Secretaría Anticorrupción y Buen Gobierno** (al posto
  dell'INAI). Fonti secondarie consultate: analisi di EY, Hogan Lovells, Garrigues, IDC Online.
- Descrivono **solo ciò che l'app fa davvero oggi** (dati, fornitori, cookie, IA). Ogni nuova
  funzione che tocca dati personali va riportata qui.
- Nessuna scadenza o regola legale è stata inventata: dove serve un dato di legge c'è un
  segnaposto `[... — validar]`.

## Domande per l'avvocato

1. **Intestatario** (O-02, rinviato): ragione sociale, domicilio e RFC del responsabile.
2. **Ruoli:** confermare Gardelia responsabile per gli utenti e incaricato (_encargado_) per i
   clienti delle fiorerie, e se serve un contratto di incarico separato oltre alla sezione 7 dei
   termini.
3. **Trasferimenti e rimessioni internazionali** (dati negli Stati Uniti; fornitori in tabella):
   cosa deve dire l'aviso con la legge 2025.
4. **Finalità aggiuntive** (marketing, sondaggi): meccanismo di rifiuto sufficiente o serve una
   casella in registrazione.
5. **Termini per i diritti ARCO** e per la notifica di violazioni alla fioreria.
6. **Conservazione** dopo la chiusura dell'account e obblighi fiscali e contabili.
7. **IA:** fotografie caricate dalle fiorerie e inviate a fal.ai e ai modelli che usa (Google,
   Anthropic); verificare i loro termini su addestramento e conservazione.
8. **Responsabilità** e limiti nei servizi fra imprese; legge applicabile e foro.
9. **Cookie:** oggi solo tecnici; confermare che non serva un banner.
10. **Prezzi, prova, rimborsi, fatture (CFDI):** sezione 3 dei termini, con il contador.
11. **Email promozionali delle fiorerie ai loro clienti** (ADR-047: sconto per le date speciali,
    solo con consenso, link di disiscrizione): cosa deve contenere il messaggio, se serve
    consultare registri di esclusione e se il consenso registrato dal fiorista nell'app basta.
12. **Chi compra (marketplace, `terminos-compradores.md`):** come descrivere Gardelia come
    piattaforma che mette in contatto (la vendita è fra cliente e fioreria, pagamento diretto) e
    quali obblighi della Ley Federal de Protección al Consumidor ricadono su Gardelia e quali sulla
    fioreria: informazioni prima dell'acquisto, prezzi con o senza IVA, cancellazioni, rimborsi,
    sostituzione dei fiori, reclami e PROFECO.
13. **Accettazione:** oggi un avviso con i link ("Al crear tu cuenta aceptas…", "Al enviar el
    pedido aceptas…") e la versione dei testi registrata con ogni ordine online. Basta, o servono
    caselle da spuntare o una prova diversa?
14. **Ruoli sui dati di un ordine online:** Gardelia responsabile del conto cliente, la fioreria dei
    dati dell'ordine e della scheda nel suo CRM. Confermare e dire cosa va scritto nel contratto
    con la fioreria.
15. **Dati di chi riceve i fiori** (terza persona: nome, telefono, indirizzo): basta l'avviso a chi
    compra di condividerli solo col suo permesso?
16. **Cookie dell'attribuzione** (`gardelia_found`, 30 giorni, solo gli slug delle tiendas aperte
    dalla ricerca): tecnica o serve il consenso?
17. **Cancellazione del conto cliente:** oggi immediata (conto, telefono, indirizzi; gli ordini
    restano alle fiorerie senza il collegamento; nel registro di sicurezza resta solo l'ID).
    Serve conservare qualcosa (prova dell'accettazione, reclami aperti) e per quanto?
18. **Eliminazione di una fioreria (ADR-074):** il titolare la elimina dalle impostazioni; sparisce
    subito e dopo 30 giorni si cancellano tutti i suoi dati (clienti, ordini, pagamenti registrati,
    foto). Gardelia deve conservare qualcosa per obblighi fiscali o reclami? E la fioreria va avvisata
    di scaricare prima i suoi dati (esportazione ancora da fare)?
19. **"Mi Floral Care" (ADR-084, bozza nell'aviso del 25/11/2026):** la fioreria invita per email
    una persona a vedere il servizio di cura delle piante di un suo cliente (visite, resoconti con
    foto, piante e, se la fioreria lo sceglie, prezzi e cargos); la persona può cambiare la data di
    una visita. Confermare i ruoli: la fioreria responsabile dei dati del servizio, Gardelia del
    conto e dell'accesso. La persona invitata può essere diversa dal cliente (per esempio una
    recepcionista): basta che sia la fioreria a decidere chi invitare, o serve il consenso del
    cliente? L'accesso si chiude 30 giorni dopo la fine del contratto, come le foto. Dal 25/11 (5b)
    la persona scrive messaggi con una foto alla fioreria: restano alla fioreria anche se la persona
    elimina il conto (senza il suo nome), le foto si cancellano con quelle del servizio; l'avviso
    per email non contiene il testo. Va bene che i messaggi restino alla fioreria come parte del
    servizio, o la persona deve poterli far cancellare?
20. **Asistente de plantas per i clienti (ADR-085, blocco 6b, bozze del 25/11/2026):** la fioreria
    compra crediti da Gardelia e li dà ai suoi clienti, che li usano in "Mi Floral Care" (foto e
    domande ad Anthropic, Stati Uniti, come fornitore; mai nomi né contatti). La fioreria vede
    quante consultas, non le domande, salvo quelle che il cliente le manda. Domande: chi è
    responsabile delle foto e delle domande del cliente (la fioreria, come per i messaggi, o
    Gardelia)? La vendita dei crediti alla fioreria (prezzo, IVA, CFDI, rimborsi) con il contador;
    la rivendita al cliente è della fioreria: basta dirlo nei termini? Le domande restano alla
    fioreria anche se la persona elimina il conto (senza il suo nome), come i messaggi.

## Prima del lancio (V1, `docs/V1_SCOPE.md` §2.15)

- Revisione dell'avvocato e testi definitivi (senza riquadro "BORRADOR") sulle pagine già pronte.
- Caselle di consenso in registrazione o nel pedido, se l'avvocato le richiede.
- Esportazione e cancellazione dei dati per le fiorerie: fatte ("Datos de tu florería" ed "Eliminar
  florería" in Ajustes, ADR-079 e ADR-074); per chi compra ci sono "Descargar mis datos" ed "Eliminar
  mi cuenta" in "Mi cuenta" (ADR-068).
