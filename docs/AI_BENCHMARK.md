# Prova dei modelli di immagine per le anteprime del Builder

Documento operativo per scegliere il modello delle anteprime AI (decisione O-01, ADR-025) spendendo
il meno possibile. Le classifiche pubbliche (LMArena, Artificial Analysis) misurano la qualità
generale delle immagini; a noi serve altro: che il ramo rispetti **varietà, colori, quantità
(circa) ed empaque** del catalogo. Per questo si prova sui nostri ramos.

## Passo 1 — prova manuale gratuita (founder, ~15 minuti)

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

Account **diretto** solo presso il fornitore che vince il passo 1 (OpenAI o Google), credito
prepagato di circa 10 € e limite di spesa impostato nel suo pannello. La chiave si inserisce nel
modulo sicuro della sessione o nelle variabili dell'hosting, **mai in chat né nel repository**.
Con 10 € si coprono l'integrazione e un primo lotto di immagini a bassa risoluzione (sufficiente
per WhatsApp). Un aggregatore (es. fal.ai) serve solo se si vogliono confrontare più modelli via
API senza aprire più account.

## Passo 3 — prima del pilota

Prova più ampia (≈100 immagini, spec §15.4) con il modello scelto: costo reale per anteprima
riuscita, tempi, tasso di errore. Da qui i prezzi dei pacchetti (ADR-024: almeno 3× il costo).
