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

## Prima del lancio (V1, `docs/V1_SCOPE.md` §2.15)

- Revisione dell'avvocato e testi definitivi (senza riquadro "BORRADOR") sulle pagine già pronte.
- Caselle di consenso in registrazione o nel pedido, se l'avvocato le richiede.
- Esportazione e cancellazione dei dati dall'app **per le fiorerie** (per chi compra ci sono già:
  "Descargar mis datos" ed "Eliminar mi cuenta" in "Mi cuenta", ADR-068).
