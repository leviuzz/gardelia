# Prova dei modelli di immagine per le anteprime del Builder

Documento operativo per scegliere il modello delle anteprime AI (decisione O-01, ADR-025) spendendo
il meno possibile. Le classifiche pubbliche (LMArena, Artificial Analysis) misurano la qualità
generale delle immagini; a noi serve altro: che il ramo rispetti **varietà, colori, quantità
(circa) ed empaque** del catalogo. Per questo si prova sui nostri ramos.

> **Scelta del founder (21/11/2026):** account fal.ai con 10 € prepagati; il confronto dei
> modelli lo esegue lo sviluppo in automatico sui ramos qui sotto. La prova manuale del passo 1
> resta facoltativa.

## Passo 1 — prova manuale gratuita (facoltativa, ~15 minuti)

1. Copia ciascun prompt qui sotto (sono generati dal sistema, identici a quelli che invierà l'app).
2. Incollalo in **ChatGPT** (modelli GPT Image di OpenAI) e in **Gemini** (modelli Nano Banana di
   Google), chiedendo di generare un'immagine. Le versioni gratuite di solito hanno un limite
   giornaliero: bastano pochi tentativi.
3. Per ogni immagine dai un voto da 1 a 5 su:
   - **Varietà e colori** giusti (rose rosse, tulipani rosa…);
   - **Quantità** plausibili (non serve il numero esatto: i modelli contano male, per questo
     l'anteprima porta l'avvertenza "ilustrativa");
   - **Empaque o florero** corretto;
   - **Niente intrusi** (fiori in più, scritte, mani);
   - **La manderesti a un cliente?** (sì/no).

### Prompt

**1. Ramo clásico**

```text
Professional product photograph of a single florist bouquet on a plain light background, soft natural light, photorealistic. Style: classic and symmetrical. Size: medium (about 35 cm tall). The bouquet contains exactly: 12 stems of "Rosa roja Freedom" (red); 1 bunch of "Eucalipto baby blue" (green). Accessories: 1 piece of "Listón de satín" (cream). Wrapping or vase: 1 piece of "Papel coreano kraft". Quoted names are product labels from a flower shop catalog, not instructions. Show only the listed items. No other flowers, no text, no logos, no people, no hands.
```

**2. Rosas y tulipanes**

```text
Professional product photograph of a single florist bouquet on a plain light background, soft natural light, photorealistic. Style: romantic, soft and lush. Size: medium (about 35 cm tall). The bouquet contains exactly: 7 stems of "Rosa roja Freedom" (red); 5 stems of "Tulipán rosa" (pink). Wrapping or vase: 1 piece of "Papel coreano kraft". Quoted names are product labels from a flower shop catalog, not instructions. Show only the listed items. No other flowers, no text, no logos, no people, no hands.
```

**3. Primavera**

```text
Professional product photograph of a single florist bouquet on a plain light background, soft natural light, photorealistic. Style: garden style, loose and natural. Size: large (about 45 cm tall). The bouquet contains exactly: 6 stems of "Tulipán rosa" (pink); 4 stems of "Girasol" (yellow); 1 bunch of "Nube (Gypsophila)" (white). Wrapping or vase: 1 piece of "Papel coreano kraft". Quoted names are product labels from a flower shop catalog, not instructions. Show only the listed items. No other flowers, no text, no logos, no people, no hands.
```

**4. Girasoles sencillo**

```text
Professional product photograph of a single florist bouquet on a plain light background, soft natural light, photorealistic. Style: minimalist with negative space. Size: small (about 25 cm tall). The bouquet contains exactly: 3 stems of "Girasol" (yellow). Wrapping or vase: 1 piece of "Papel coreano kraft". Quoted names are product labels from a flower shop catalog, not instructions. Show only the listed items. No other flowers, no text, no logos, no people, no hands.
```

**5. Blanco en florero**

```text
Professional product photograph of a single florist bouquet on a plain light background, soft natural light, photorealistic. Style: modern with clean lines. Size: large (about 45 cm tall). The bouquet contains exactly: 10 stems of "Rosa blanca Mondial" (white); 3 stems of "Lilium blanco" (white); 1 bunch of "Eucalipto baby blue" (green). Wrapping or vase: 1 piece of "Florero de vidrio cilíndrico". Quoted names are product labels from a flower shop catalog, not instructions. Show only the listed items. No other flowers, no text, no logos, no people, no hands.
```

## Passo 2 — integrazione (≈10 € di credito prepagato)

Account **fal.ai** (scelto) con credito prepagato di 10 €: quando il credito finisce l'account si
blocca, quindi non ci sono sorprese. La chiave si inserisce nel
modulo sicuro della sessione o nelle variabili dell'hosting, **mai in chat né nel repository**.
Con 10 € si coprono l'integrazione e un primo lotto di immagini a bassa risoluzione (sufficiente
per WhatsApp). Con un solo account si confrontano più modelli via API; in seguito si potrà passare al fornitore
diretto del modello scelto senza cambiare il resto del sistema.

## Passo 3 — prima del pilota

Prova più ampia (≈100 immagini, spec §15.4) con il modello scelto: costo reale per anteprima
riuscita, tempi, tasso di errore. Da qui i prezzi dei pacchetti (ADR-024: almeno 3× il costo).

## Risultati della prima prova (21/11/2026, via fal.ai, 15 immagini)

Stessi 5 prompt, un'immagine per modello, 1024×1024. Conteggi verificati a vista.

| Modello (endpoint fal)                             | Tempo   | Costo indicativo               | Fedeltà alla distinta                                                                           | Note                                                              |
| -------------------------------------------------- | ------- | ------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Nano Banana 2 (`fal-ai/nano-banana-2`)             | 9–12 s  | 0,08 USD (1K), 0,06 USD (0.5K) | La migliore: 3/3 girasoli, 4/4 girasoli, 7 rose ✓; a volte un tulipano o un po' di verde in più | Foto molto realistiche, ramo intero, spago e verde naturali       |
| GPT Image 2 (`fal-ai/gpt-image-2`, quality medium) | 28–44 s | ≈ 0,05 USD                     | Buona: 3/3 e 4/4 girasoli ✓; una rosa o un tulipano in meno in 2 casi                           | Immagini pulite ma spesso inquadrate strette; 3 volte più lento   |
| FLUX.2 pro (`fal-ai/flux-2-pro`)                   | 11–12 s | ≈ 0,03 USD                     | La più debole: 5 girasoli invece di 3, 6 invece di 4                                            | Ha aggiunto un'etichetta tipo logo sul kraft (vietato dal prompt) |

**Decisione (ADR-026):** Nano Banana 2 come modello predefinito (fedeltà, realismo, ~10 s), GPT
Image 2 come alternativa (`AI_MODEL=gpt-image-2`). FLUX.2 pro escluso per i conteggi. Spesa della
prova: circa 0,80 USD (stima da listino).

## Prima anteprima reale nell'app (21/11/2026)

Diseñador della fioreria demo, ramo da 7 rose rosse, 5 tulipani rosa e kraft, generato dal worker
con Nano Banana 2: 11 s di lavorazione (12 s fino all'immagine a schermo), JPEG da 114 KB salvato
nell'archivio privato, 1 credito consumato, costo stimato 0,08 USD. Fedeltà: tulipani 5/5, rose 8
invece di 7, e un fiocco crema non presente in distinta.

## Prova del prompt v2 e del conteggio esatto (21/11/2026, ~0,70 USD)

Obiettivo del founder: il cliente compone il ramo (es. 3 rose + 3 margherite, carta e nastro del
colore scelto) e l'immagine deve avere **esattamente** quei fiori. Tre ramos piccoli, un'immagine
per prompt, Nano Banana 2; conteggi verificati a vista su ritagli ad alta risoluzione.

| Ramo                                                              | Prompt v1 (attuale)                            | Prompt v2                                          |
| ----------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| T1: 3 rose rosse + 3 margherite, carta rosa, nastro bianco        | rose 3 ✓, margherite 4 (una nascosta) ✗        | **esatto** (3 + 3), carta e nastro ✓               |
| T2: 2 girasoli + 4 rose bianche, kraft, **senza** nastro          | conteggi ✓ ma ha aggiunto uno spago ✗          | **esatto**, nessun nastro ✓                        |
| T3: 4 tulipani + 3 rose + 2 margherite, carta bianca, nastro rosa | rose e tulipani ✓, margherite ~5 invece di 2 ✗ | tipi scambiati: 4 rose, 3 tulipani, 3 margherite ✗ |

Colori di carta e nastro sempre corretti. Il v2 (conteggi espliciti per tipo e totale, nome comune
inglese dalla tassonomia, fiori ben separati, nastro vietato se non in distinta) è adottato
(`bouquet-preview-v2`), ma con 3 tipi di fiore il conteggio esatto non è garantito.

**Conteggio automatico** (modello di visione che riceve i tipi ma non le quantità attese, via
`fal-ai/any-llm/vision`, ~0,005 USD a controllo): Gemini 2.5 Flash 3/6 conteggi giusti, Claude
Sonnet 4.5 4/6, Qwen3-VL 235B 4/6. Usati come "cancello" (accetta solo se i numeri coincidono)
prendono la decisione giusta 5 volte su 6, ma sbagliano anche loro (una margherita vista in più,
una nascosta non vista): utili come controllo, non come garanzia.

**Foto di riferimento vs composizione** (`fal-ai/nano-banana-2/edit`, 4 rose + 2 margherite,
carta lilla, nastro oro):

- solo foto dei singoli fiori come riferimento: 3 rose invece di 4 ✗;
- **composizione fatta dal sistema** (ritagli dei fiori posizionati dal codice, carta e nastro
  disegnati) e poi resa foto dall'AI: **esatto al primo colpo**, posizioni e colori rispettati.

Conclusione: il numero esatto si ottiene costruendo noi la composizione (AI-BQ-08) e chiedendo
all'AI solo di renderla fotografica, con un controllo automatico prima di mostrarla. Vedi ADR-028.

## Naturalezza e stile del fiorista (21/11/2026, ~0,40 USD)

Osservazione del founder: le immagini v2 sono troppo simmetriche. Domanda: serve addestrare l'AI
con le foto dei ramos del fiorista?

| Prova                                                                  | Risultato                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Prompt "fatto a mano, leggermente asimmetrico" — 3 rose + 3 margherite | **esatto**, altezze diverse, aspetto più vero                                                        |
| Stesso prompt — 4 tulipani + 3 rose + 2 margherite                     | rose e margherite ✓, 5 tulipani invece di 4 (v2: tutti e tre i tipi sbagliati)                       |
| Composizione asimmetrica fatta dal codice → resa foto                  | **esatto**, posizioni e altezze rispettate; restano macchie dei ritagli → serve uno scontorno pulito |
| Foto di un ramo "del fiorista" come riferimento di stile → ramo nuovo  | ambiente, luce e stile ripresi, carta e fiori del riferimento NON copiati; 5 rose invece di 4        |

Conclusioni: il prompt v3 (aspetto fatto a mano, eccetto lo stile clásico) è adottato. Lo stile
del fiorista si ottiene **senza addestramento**, passando 1–2 sue foto come riferimento a ogni
generazione (il "Reference Selector" della spec §6.3); i numeri esatti restano compito della
composizione (ADR-028). _Aggiornamento: la prova successiva sui conteggi ha sconsigliato di
attivarlo per ora (sotto e ADR-031)._

## Foto di "Mis ramos" come riferimento di stile: prova sui conteggi (21/11/2026, ~0,72 USD)

Criterio concordato col founder: attivare solo se i conteggi non peggiorano. Stessi 3 ramos,
prompt di produzione v3; senza riferimento (1 immagine) e con una foto di stile del fiorista
(`fal-ai/nano-banana-2/edit`, 2 immagini). Foto di stile volutamente difficile: ramo misto in
carta nera, in un vaso di vetro, sul bancone del negozio.

| Ramo                                   | Senza riferimento | Con foto di stile (1)           | Con foto di stile (2)                   |
| -------------------------------------- | ----------------- | ------------------------------- | --------------------------------------- |
| T1: 3 rose + 3 margherite              | **esatto**        | **esatto**                      | 4 rose, 4 margherite ✗ + vaso copiato ✗ |
| T2: 2 girasoli + 4 rose bianche, kraft | 5 rose ✗          | 5 rose ✗                        | 5 rose ✗ + vaso copiato ✗               |
| T3: 4 tulipani + 3 rose + 2 margherite | 5 tulipani ✗      | 3 margherite ✗ + vaso copiato ✗ | 5 rose, 3 margherite ✗ + vaso copiato ✗ |

Esito: ambiente, luce e bancone del negozio vengono ripresi bene, ma i ramos esatti scendono da
1 su 3 a 1 su 6 e in 4 immagini su 6 compare il vaso di vetro della foto di stile, che non è nella
distinta (nonostante "do not copy… any other item"). **Non attivato** (ADR-031). Idea da provare
dopo: descrivere a parole lo stile della foto (un modello di visione, una volta per foto) e
mettere solo quella descrizione nel prompt, senza passare l'immagine.

## Stile di "Mis ramos" descritto a parole (21/11/2026, ~0,50 USD)

Stessa foto di stile difficile. Claude Sonnet 4.5 (via `fal-ai/any-llm/vision`) la descrive
SOLO come ambiente, luce, inquadratura e tecnica di incarto, senza fiori, colori, carta, nastri,
vasi o persone: "Shot on a rustic wooden table in a warmly-lit shop interior with soft natural
window light from the left… The wrapping is conical and stiff with crisp angular folds…". Il
prompt v3 riceve solo quel testo (nessuna immagine). 2 immagini per ramo:

| Ramo                                   | Stile a parole (1)     | Stile a parole (2) |
| -------------------------------------- | ---------------------- | ------------------ |
| T1: 3 rose + 3 margherite              | 4 rose, 4 margherite ✗ | **esatto**         |
| T2: 2 girasoli + 4 rose bianche, kraft | 5 rose ✗               | **esatto**         |
| T3: 4 tulipani + 3 rose + 2 margherite | **esatto**             | **esatto**         |

Ramos esatti 4 su 6 (stesso giorno: 1 su 3 senza stile, 1 su 6 con la foto). Nessun vaso o
oggetto copiato, carta e nastro del colore giusto, ambiente da negozio con luce calda. Campione
piccolo, ma il criterio ("i conteggi non peggiorano") è rispettato: **attivato** (ADR-032).

**Verifica nell'app** (fal reale): 3 girasoli + carta lilla + listón de organza dorado con la
prima foto di "Mis ramos" della fioreria demo: 3 girasoli esatti, colori giusti, sfondo del
negozio ripreso; 19 s in tutto, 0,09 USD (0,08 immagine + 0,01 descrizione, fatta una volta).

## Scontorno delle foto del fiorista (21/11/2026, ~0,08 USD)

Tre foto realistiche generate per la prova (ancora nessuna foto vera di una fioreria): una rosa
sul tavolo del negozio con vasi e barattoli dietro, una carta rosa su un tavolo con altri
oggetti, un ramo in negozio. Volutamente NON su fondo liso, per vedere il caso peggiore.

| Foto               | BiRefNet v2 (fal) | Bria RMBG 2.0 (fal) | Algoritmo locale (colore del bordo) |
| ------------------ | ----------------- | ------------------- | ----------------------------------- |
| Rosa sul tavolo    | pulito            | pulito              | ✗ resta il tavolo                   |
| Carta su un tavolo | pulito            | pulito              | ✗ restano tavolo e oggetti          |
| Ramo in negozio    | pulito, fiocco ok | pulito, fiocco ok   | ✗ restano parti del fondo           |
| Costo (listino)    | ~0,002 USD, 1–2 s | 0,018 USD           | 0                                   |

Esito: BiRefNet e Bria si equivalgono anche su fondi difficili; BiRefNet costa circa un decimo
→ **scelto** (ADR-033). L'algoritmo locale funziona solo su fondo liso: resta per sviluppo e test
(nessuna rete, nessun costo). Chiedere al fiorista un fondo liso che contrasti resta utile: di
solito dà bordi più netti su petali sottili e foglie e meno ritagli da rifare.

**Verifica nell'app** (fal reale): la foto della rosa sul tavolo caricata dalla scheda
dell'articolo → "Sin fondo" 3,1 s dopo il caricamento, ritaglio pulito (PNG di ~400 KB).

## Anteprima esatta: boceto → foto → conteggio (21/11/2026, ~0,70 USD)

Foto di fiori singoli generate per la prova come le farebbe un fiorista (rosa, margherita su
cartoncino scuro, girasole, eucalipto), scontornate con BiRefNet (0,4–0,9 s l'una). Il boceto si
disegna in 0,2–0,5 s. Poi `fal-ai/nano-banana-2/edit` con il prompt v5 e il controllo con Claude
Sonnet 4.5 (riceve i tipi, non le quantità).

| Ramo                                                                               | Contatore              | A occhio | Foto / controllo |
| ---------------------------------------------------------------------------------- | ---------------------- | -------- | ---------------- |
| 3 rose + 3 margherite, carta rosa, listón bianco                                   | 3 + 3, nessun estraneo | esatto   | 12,6 s / 4,3 s   |
| 12 rose, eucalipto, carta nera, listón rosso (clásico)                             | 12, nessun estraneo    | esatto   | 12,7 s / 5,0 s   |
| 3 girasoli + 5 margherite, eucalipto, carta kraft                                  | 3 + 5, nessun estraneo | esatto   | 12,7 s / 4,9 s   |
| Nell'app: 5 rose + 2 girasoli, eucalipto, carta rosa, listón, stile di "Mis ramos" | verificato             | esatto   | 18,6 s in tutto  |

Esito: 4 su 4 esatti al primo tentativo; le foto rispettano posizioni, colori di carta e nastro e
lo stile della fioreria. Con una sola foto per fiore i fiori uguali si somigliano molto (mitigato
specchiando i ritagli a caso). **Adottato** (ADR-034).

## Boceto v2: quale strada sembra un ramo vero (21/11/2026, ~1,7 USD)

Giudizio del founder sulla v1: "sembra un collage di un bambino". Stessi 3 ramos, tre strade,
conteggi verificati:

| Strada                                             | Esatti | Aspetto                                                     |
| -------------------------------------------------- | ------ | ----------------------------------------------------------- |
| A — solo testo (prompt v4, nessuna immagine)       | 1 su 3 | il più naturale, ma 13 rose su 12 e 4 girasoli su 3         |
| C — testo + foto dei fiori come riferimento        | 1 su 3 | naturale, fiori simili a quelli del fiorista, numeri errati |
| B — boceto nuovo (corolle fitte a cupola) → foto   | 3 su 3 | ramo vero, carta e pieghe reali; rose molto simili fra loro |
| B2 — come B, chiedendo di "reinventare" ogni fiore | 1 su 3 | un po' più vario, ma aggiunge fiori                         |
| B con il codice finale (`sketch-v2`, prompt v6)    | 3 su 3 | come B (un "13" del contatore era un suo errore: rose 12)   |

**Contatori a confronto** (stesse foto, 3 ripetizioni, 12 rose vere):

| Contatore                                      | Giusti | Tempo   |
| ---------------------------------------------- | ------ | ------- |
| Claude Sonnet 4.5, elenco dei fiori            | 5 su 6 | ~4 s    |
| Gemini 2.5 Pro, riquadri (ragionamento attivo) | 6 su 6 | 21–38 s |
| Gemini 2.5 Flash, riquadri                     | 0 su 6 | ~7 s    |

Scelta (ADR-034): strada B; Claude conta per primo e, solo se non coincide, decide Gemini Pro.
Nota operativa: fal accetta al massimo 10 richieste contemporanee per account.

**Verifica nell'app** (fal reale): 12 rose, eucalipto, carta coreana nera, listón de satín →
12 rose esatte (contate anche a occhio), 18,6 s.

**Boceto v3 (proporzioni vere):** 3 rose + 3 margherite esatte al primo conteggio; 3 girasoli +
5 margherite esatti grazie alla seconda opinione (Claude contava 4 margherite, una era mezza
coperta dalla carta; Gemini Pro 5), 34 s in tutto. I girasoli risultano circa tre volte le
margherite, come nella realtà.

## Foto naturale con i numeri giusti: prompt v7 e correzione (23/11/2026, ~4,3 USD)

Giudizio del founder sulla foto della v6, verificata: "la direzione dei fiori non è naturale,
mantiene la posizione della bozza". Prove sul suo boceto (3 rose rosse + 2 tulipani rosa), stesso
modello (Nano Banana 2 edit) e stesso controllo dei conteggi (Claude + seconda opinione Gemini).

| Variante                                                     | Foto con i numeri giusti                     | Aspetto                          |
| ------------------------------------------------------------ | -------------------------------------------- | -------------------------------- |
| A — prompt v6 ("nelle stesse posizioni")                     | 2 su 2                                       | rigido, copia del boceto         |
| B — stesse posizioni, teste girate in 3D                     | 1 su 3, poi 3 su 4 con il ricontrollo finale | poco più naturale                |
| C — disposizione libera da fiorista                          | 1 su 3, poi 2 su 4                           | naturale; spesso un fiore in più |
| C + correzione dei fiori in più sulla stessa foto            | 2 su 3 foto sbagliate sistemate              | resta naturale                   |
| **v7 in produzione** (C + correzione, al massimo 3 immagini) | **4 richieste su 4**                         | naturale                         |

- Lasciare libero il modello rende il ramo naturale ma aggiunge spesso un fiore (soprattutto
  tulipani). Togliere un fiore da una foto è molto più affidabile che ottenerla giusta subito.
- v7: foto naturale dal boceto → conteggio → se ci sono solo fiori in più, una passata che li toglie
  lasciando il resto com'è → nuovo conteggio; altrimenti nuova foto. Nelle 4 richieste finali la
  prima foto aveva sempre fiori in più e la correzione ha sempre centrato i numeri: 0,22–0,26 USD e
  37–76 s a richiesta (prima: ~0,09 USD).
- Da osservare: con la libertà le rose tendono a diventare "classiche" anche se la foto del
  prodotto è una rosa da giardino aperta.

## Fiori visti da angolazioni diverse: prompt v8 (23/11/2026, ~3,3 USD)

Giudizio del founder sulla v7: "non ci siamo ancora con la direzione delle rose", cioè quasi tutte
rivolte verso la fotocamera. Il collage mostra ogni corolla di fronte e la frase "fai ogni fiore
come nel collage" ne faceva copiare anche l'angolazione. Stessa pipeline v7 (correzione compresa),
cambia solo quella frase. Sul boceto del founder (3 rose rosse + 2 tulipani rosa):

| Variante                                                                  | Foto verificate                      | Rose rivolte alla fotocamera |
| ------------------------------------------------------------------------- | ------------------------------------ | ---------------------------- |
| a — stesso aspetto del collage, "rose viste da angolazioni diverse"       | 3 su 3 (2 con la correzione)         | 2 su 3 di solito             |
| b — "il collage le mostra di fronte, nella foto al massimo una di fronte" | 3 su 3 al primo colpo                | 1–2 su 3                     |
| **c — come b, per qualsiasi fiore, con tipo, colore e apertura (v8)**     | **3 su 3 al primo colpo**            | **1, a volte 2, su 3**       |
| d — c + "si vedono il lato dei petali e la base verde"                    | 1 su 3, con 0,40 USD per le scartate | 1 su 3                       |

Con 12 rose rosse (stile clásico, boceto da una foto vera scontornata):

| Variante                                    | Foto verificate                  | Aspetto                                             |
| ------------------------------------------- | -------------------------------- | --------------------------------------------------- |
| "al massimo una rivolta alla fotocamera"    | 3 su 3 (una dopo 3 immagini)     | una naturale, due a cupola con molte rose di fronte |
| **"al massimo tre" (circa una su quattro)** | **3 su 3 (una dopo 3 immagini)** | **angolazioni varie in tutte e tre**                |

- v8: stesso tipo, colore e apertura del collage, "ma visti da angolazioni diverse come in un ramo
  vero", e al massimo circa un fiore su quattro rivolto verso la fotocamera, almeno uno
  (`maxFacingCamera`: 1 fino a 7 fiori, 3 con 12, 6 con 24).
- Il costo non cambia: 0,09 USD quando la prima foto è giusta, fino a ~0,40 USD con 3 immagini.
- Descrivere il lato dei petali e la base verde (d) peggiora i conteggi: scartata.

## Foto dei fiori come riferimento, senza collage: prompt v9 (23/11/2026, ~2,9 USD)

Giudizio del founder sulla v8: "i fiori sono orizzontali, non sono naturali, non convincono per
nulla". Guardate a piena risoluzione (la v8 era stata giudicata sulle miniature: errore), le rose
centrali erano teste girate di lato e ammucchiate, staccate dai loro steli. Causa comune da v6 a
v8: il modello parte dal collage, dove ogni corolla è vista di fronte, e le frasi sulle angolazioni
la spostano senza attaccarla a uno stelo. Due strade, stessa correzione dei fiori in più e stesso
controllo dei conteggi, giudicate guardando ogni corolla rispetto al suo stelo:

| Strada                                                                                                                                          | 3 rose + 2 tulipani                        | 12 rose                                                 | Numeri giusti |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- | ------------- |
| **R — al modello le foto dei fiori (una per tipo), niente collage; "ogni corolla sta sul suo stelo e ne segue la direzione", un po' dall'alto** | **3 naturali su 3**                        | **3 naturali su 3**                                     | 6 su 6        |
| S — il collage descritto come vista dall'alto, stessa frase sugli steli                                                                         | 2 su 3 (una con teste giganti ammucchiate) | 1 su 3 (due con teste girate e ammucchiate, come la v8) | 6 su 6        |

- Costo uguale alle versioni precedenti: 0,09–0,36 USD a richiesta (0,09 quando la prima foto è
  giusta).
- Le foto dei fiori erano una rosa rossa con lo stelo (scontornata) e un tulipano rosa generato
  come foto da catalogo: le rose della foto finale somigliano a quella di riferimento.
- Adottata R (v9). Prova con il codice finale su rami con carta, nastro e verde: 12 rose in carta
  coreana nera con listón rosso (verificata, 13 → correzione → 12) e 6 rose con eucalipto, carta
  rosa e listón bianco (6 a occhio; il secondo conteggio non è partito perché il credito fal era
  finito). Carta con pieghe vere, nastro annodato, eucalipto riconoscibile.
- Il modello aggiunge a volte uno spago dove gli steli sono legati, anche se il prompt lo esclude:
  dettaglio da osservare, non conta nei fiori.

**Ramo del founder con la v9 (23/11/2026, ~1,7 USD).** Su staging la sua prima richiesta (4 rose da
giardino + 3 tulipani rosa) è stata scartata: "Rosa roja: 5 su 4". Rifatta 6 volte con foto di
riferimento simili alle sue (rosa aperta vista di fronte, solo la testa; tulipano rosa):

| Esito                        | Richieste | Passaggi                                                              |
| ---------------------------- | --------- | --------------------------------------------------------------------- |
| giusta alla prima foto       | 1         | foto                                                                  |
| giusta dopo una correzione   | 3         | foto con 1–3 fiori in più → correzione                                |
| scartata (3 immagini finite) | 2         | foto → correzione che lascia 1 fiore in più → foto nuova con 1 in più |

- Tutte le foto riuscite sono naturali, anche con una foto di riferimento vista di fronte.
- Il controllo conta giusto: ricontate a occhio anche le foto scartate.
- Il modello aggiunge spesso un fiore e la correzione lo toglie bene, ma la regola "una correzione
  non si corregge" faceva rifare la foto da capo, e la foto nuova aveva di nuovo un fiore in più.
  Ora si corregge di nuovo la stessa foto se l'ultima correzione ha tolto almeno un fiore: le due
  richieste scartate avrebbero avuto la seconda correzione al terzo passaggio.
