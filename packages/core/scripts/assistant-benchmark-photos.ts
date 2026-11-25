/**
 * Le foto della prova dell'Asistente de plantas (ADR-085, docs/AI_BENCHMARK.md): circa 50 foto a
 * licenza libera da Wikimedia Commons, fino a due per specie della nostra lista (una in vaso o
 * d'interno e, se si trova, una con un problema visibile) più alcune piante d'interno che NON sono
 * nella lista (la risposta giusta è «no está en la lista»).
 *
 *   pnpm --filter @floral/core assistant:photos --dir <cartella>
 *
 * Solo JPEG con licenza CC0, CC BY, CC BY-SA o pubblico dominio; miniature larghe 960 px (una
 * larghezza standard) da `thumb.php` di Commons. Lento di proposito (una richiesta ogni 2 s, attese
 * lunghe quando Commons risponde 429) e con uno User-Agent generico. Scrive `photos/` e
 * `manifest.json` (pagina, autore, licenza) nella cartella e riprende da dove era rimasto. Le foto
 * non vanno mai nel repo.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const UA = 'PlantPhotoBenchmark/1.0 (evaluation script)';
const API = 'https://commons.wikimedia.org/w/api.php';
const THUMB = 'https://commons.wikimedia.org/w/thumb.php';
const UPLOAD = 'https://upload.wikimedia.org/wikipedia/commons/';
const WIDTH = 960;
const BACKOFF_SECONDS = [20, 40, 80, 160, 300, 300, 300, 300];

/** Slug della nostra lista → nomi scientifici su Commons (il primo è il più usato) e quante foto. */
const SPECIES: readonly (readonly [string, readonly string[], number])[] = [
  ['telefono', ['Epipremnum aureum'], 2],
  ['monstera', ['Monstera deliciosa'], 2],
  ['cuna-de-moises', ['Spathiphyllum'], 2],
  ['lengua-de-suegra', ['Sansevieria trifasciata', 'Dracaena trifasciata'], 2],
  ['zamioculca', ['Zamioculcas zamiifolia'], 2],
  ['mala-madre', ['Chlorophytum comosum'], 2],
  ['hule', ['Ficus elastica'], 2],
  ['ficus-lira', ['Ficus lyrata'], 2],
  ['sabila', ['Aloe vera'], 2],
  ['calathea', ['Calathea', 'Goeppertia'], 2],
  ['aglaonema', ['Aglaonema'], 2],
  ['filodendro', ['Philodendron'], 2],
  ['palma-areca', ['Dypsis lutescens'], 2],
  ['palma-camedor-planta', ['Chamaedorea elegans'], 1],
  ['palo-de-brasil', ['Dracaena fragrans'], 2],
  ['dracena-marginata', ['Dracaena marginata', 'Dracaena reflexa'], 1],
  ['cheflera', ['Schefflera arboricola', 'Heptapleurum arboricola'], 1],
  ['croton', ['Codiaeum variegatum'], 2],
  ['diefenbaquia', ['Dieffenbachia'], 2],
  ['singonio', ['Syngonium podophyllum'], 2],
  ['pata-de-elefante', ['Beaucarnea recurvata'], 1],
  ['helecho-boston', ['Nephrolepis exaltata'], 2],
  ['orquidea-phalaenopsis', ['Phalaenopsis'], 2],
  ['anturio-planta', ['Anthurium andraeanum'], 1],
  ['peperomia', ['Peperomia obtusifolia', 'Peperomia'], 1],
  ['violeta-africana', ['Saintpaulia'], 1],
  ['kalanchoe', ['Kalanchoe blossfeldiana'], 1],
  ['ficus', ['Ficus benjamina'], 1],
  ['yuca', ['Yucca elephantipes', 'Yucca gigantea'], 1],
];
/** Piante d'interno comuni che non sono nella lista. */
const OUTSIDE = [
  'Hoya carnosa',
  'Tradescantia zebrina',
  'Alocasia',
  'Fittonia',
  'Pilea peperomioides',
];

const POTTED = '(potted OR pot OR houseplant OR indoor OR maceta OR container OR "house plant")';
const PROBLEM_WORDS = [
  'yellowing',
  'yellow leaves',
  'yellow',
  'brown',
  'dying',
  'dead',
  'wilted',
  'wilting',
  'disease',
  'pest',
  'mealybug',
  'spider mite',
  'scale',
  'rot',
  'sunburn',
  'scorch',
  'chlorosis',
  'damaged',
  'leaf spot',
  'fungus',
  'aphid',
];
const PROBLEM = `(${PROBLEM_WORDS.map((word) => (word.includes(' ') ? `"${word}"` : word)).join(' OR ')})`;
const OK_LICENSE = /^(cc0|cc[- ]by(-sa)?([- ][0-9.]+.*)?|public domain|pd\b)/i;
const SKIP_TITLE =
  /herbari|specimen|illustrat|drawing|botanical|plate|stamp|map\b|seed|pollen|scan|macro|closeup|close-up|fruit|market|logo|diagram/i;

interface Photo {
  readonly file: string;
  /** Slug della nostra lista; null = pianta fuori dalla lista. */
  readonly species: string | null;
  readonly outside?: string;
  readonly title: string;
  readonly page: string;
  readonly url: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly author: string;
  /** Parola di un problema nel titolo o nella descrizione (solo un indizio). */
  readonly hint: string | null;
}

interface Candidate extends Omit<Photo, 'file' | 'species' | 'outside'> {
  readonly index: number;
}

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** GET paziente: Commons risponde 429 a ondate; dopo l'ultima attesa l'errore sale. */
async function get(url: string): Promise<Response> {
  for (const [attempt, pause] of [...BACKOFF_SECONDS, null].entries()) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': UA } });
      if (response.status === 429 && pause !== null) {
        console.warn(`429, attendo ${pause} s (tentativo ${attempt + 1})`);
        await sleep(pause);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (pause === null || (error instanceof Error && error.message.startsWith('HTTP '))) {
        throw error;
      }
      console.warn(`rete: ${error instanceof Error ? error.message : error}, attendo ${pause} s`);
      await sleep(pause);
    }
  }
  throw new Error('Commons non risponde');
}

let lastApiCall = 0;

async function api(params: Record<string, string>): Promise<Record<string, unknown> | null> {
  const wait = 2_000 - (Date.now() - lastApiCall);
  if (wait > 0) await sleep(wait / 1000);
  const query = new URLSearchParams({ ...params, format: 'json', formatversion: '2', maxlag: '5' });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let data: Record<string, unknown>;
    try {
      data = (await (await get(`${API}?${query}`)).json()) as Record<string, unknown>;
    } catch (error) {
      console.warn(
        'ricerca saltata',
        params.gsrsearch,
        error instanceof Error ? error.message : '',
      );
      return null;
    } finally {
      lastApiCall = Date.now();
    }
    const code = (data.error as { code?: string } | undefined)?.code;
    if (code !== 'maxlag') return data;
    await sleep(10);
  }
  return null;
}

/** Testo semplice da un campo HTML dei metadati di Commons. */
function text(meta: Record<string, { value?: unknown } | undefined>, key: string): string {
  const raw = String(meta[key]?.value ?? '');
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** File JPEG più larghi di 960 px che rispondono alla ricerca, con licenza libera. */
async function search(query: string): Promise<Candidate[]> {
  const data = await api({
    action: 'query',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '30',
    gsrsearch: `${query} filemime:image/jpeg filew:>${WIDTH}`,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
  });
  const pages = ((data?.query as { pages?: unknown[] } | undefined)?.pages ?? []) as {
    title?: string;
    index?: number;
    imageinfo?: {
      url?: string;
      descriptionurl?: string;
      mime?: string;
      width?: number;
      height?: number;
      extmetadata?: Record<string, { value?: unknown } | undefined>;
    }[];
  }[];
  const found: Candidate[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const title = page.title ?? '';
    if (!info || info.mime !== 'image/jpeg' || SKIP_TITLE.test(title)) continue;
    const meta = info.extmetadata ?? {};
    const license = text(meta, 'LicenseShortName');
    if (!OK_LICENSE.test(license) || !(info.url ?? '').startsWith(UPLOAD)) continue;
    const width = info.width ?? 0;
    if (width <= WIDTH || Math.min(width, info.height ?? 0) < 600) continue;
    const haystack = `${title} ${text(meta, 'ImageDescription')}`.toLowerCase();
    found.push({
      title,
      page: info.descriptionurl ?? '',
      url: `${THUMB}?${new URLSearchParams({ f: title.replace(/^File:/, ''), w: String(WIDTH) })}`,
      license,
      licenseUrl: text(meta, 'LicenseUrl'),
      author: text(meta, 'Artist').slice(0, 160),
      hint: PROBLEM_WORDS.find((word) => haystack.includes(word)) ?? null,
      index: page.index ?? 0,
    });
  }
  return found.sort((a, b) => a.index - b.index);
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { dir: { type: 'string' } } });
  if (!values.dir) {
    console.error('Serve --dir <cartella>.');
    process.exit(1);
  }
  const dir = values.dir;
  const photosDir = path.join(dir, 'photos');
  const manifestPath = path.join(dir, 'manifest.json');
  await mkdir(photosDir, { recursive: true });
  const manifest: Photo[] = existsSync(manifestPath)
    ? (JSON.parse(await readFile(manifestPath, 'utf8')) as Photo[])
    : [];
  const taken = new Set(manifest.map((photo) => photo.title));

  const download = async (
    candidate: Candidate,
    file: string,
    species: string | null,
    outside?: string,
  ): Promise<boolean> => {
    try {
      const bytes = new Uint8Array(await (await get(candidate.url)).arrayBuffer());
      await writeFile(path.join(photosDir, file), bytes);
    } catch (error) {
      console.warn(
        'download non riuscito',
        candidate.title,
        error instanceof Error ? error.message : '',
      );
      return false;
    }
    await sleep(2);
    const { index: _index, ...rest } = candidate;
    manifest.push({ file, species, ...(outside ? { outside } : {}), ...rest });
    taken.add(candidate.title);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return true;
  };
  const firstNew = (items: Candidate[], needHint = false) =>
    items.find((item) => !taken.has(item.title) && (!needHint || item.hint !== null));

  for (const [slug, names, wanted] of SPECIES) {
    let got = manifest.filter((photo) => photo.species === slug).length;
    for (const name of names) {
      if (got >= wanted) break;
      const quoted = `"${name}"`;
      if (wanted >= 2 && got === 0) {
        const item = firstNew(await search(`${quoted} ${PROBLEM}`), true);
        if (item && (await download(item, `${slug}-${got + 1}.jpg`, slug))) got += 1;
      }
      for (const query of [`${quoted} ${POTTED}`, quoted]) {
        while (got < wanted) {
          const item = firstNew(await search(query));
          if (!item || !(await download(item, `${slug}-${got + 1}.jpg`, slug))) break;
          got += 1;
        }
      }
    }
    console.info(`${slug}: ${got} foto`);
  }

  for (const name of OUTSIDE) {
    if (manifest.some((photo) => photo.outside === name)) continue;
    const item =
      firstNew(await search(`"${name}" ${POTTED}`)) ?? firstNew(await search(`"${name}"`));
    const file = `fuera-${name.toLowerCase().replace(/\s+/g, '-')}.jpg`;
    const ok = item ? await download(item, file, null, name) : false;
    console.info(`${name} (fuori dalla lista): ${ok ? 1 : 0} foto`);
  }
  console.info(`Foto in tutto: ${manifest.length}. Manifest: ${manifestPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
