# Documenti legali — bozze da revisionare

**Stato: BOZZE (22/11/2026), scritte su richiesta del founder (O-07). Non pubblicare senza la
revisione di un avvocato messicano.** Il codice non le mostra ancora: l'app dice che termini e
aviso definitivi arriveranno prima del lancio commerciale.

| File                                                       | Cosa contiene                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`aviso-de-privacidad.md`](./aviso-de-privacidad.md)       | Aviso de privacidad integral per gli utenti di Gardelia                        |
| [`terminos-y-condiciones.md`](./terminos-y-condiciones.md) | Termini del servizio, con la clausola sul trattamento per conto delle fiorerie |

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

## Prima del lancio (V1, `docs/V1_SCOPE.md` §2.15)

- Testi definitivi su pagine pubbliche (`/privacidad`, `/terminos`) e link in registrazione.
- Consensi in registrazione se l'avvocato li richiede.
- Esportazione e cancellazione dei dati dall'app.
