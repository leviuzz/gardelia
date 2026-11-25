/**
 * Foglio di revisione dell'elenco dei fiori (O-09, ADR-081): l'elenco resta unico e lo cura
 * Gardelia; un fiorista di Aguascalientes lo controlla su questo foglio, in spagnolo, e le
 * correzioni entrano in `reference-data.ts` con il rilascio successivo. Il foglio si genera da
 * quel file (`pnpm --filter @floral/db flowers:review`) e un test controlla che sia aggiornato.
 */
import { CANONICAL_FLOWERS, type CanonicalFlowerSeed } from './reference-data';

/** Nomi dei colori come nell'app in es-MX (`catalog.colors`). */
const COLOR_ES: Record<string, string> = {
  red: 'rojo',
  pink: 'rosa',
  fuchsia: 'fucsia',
  white: 'blanco',
  cream: 'crema',
  yellow: 'amarillo',
  orange: 'naranja',
  peach: 'durazno',
  coral: 'coral',
  purple: 'morado',
  lilac: 'lila',
  blue: 'azul',
  green: 'verde',
  burgundy: 'vino',
  multicolor: 'multicolor',
  black: 'negro',
  gold: 'dorado',
  silver: 'plateado',
  brown: 'café',
  transparent: 'transparente',
};

/** Dati di cura delle piante in vaso (ADR-085), con le parole dell'app in es-MX. */
const LIGHT_ES: Record<string, string> = {
  LOW: 'poca luz',
  MEDIUM: 'luz indirecta brillante',
  HIGH: 'sol directo parte del día',
};
const WATERING_ES: Record<string, string> = {
  LITTLE: 'poco riego, dejar secar del todo',
  DRY_BETWEEN: 'cuando los primeros centímetros estén secos',
  SLIGHTLY_MOIST: 'tierra apenas húmeda, sin encharcar',
};
const HUMIDITY_ES: Record<string, string> = { LOW: 'baja', MEDIUM: 'media', HIGH: 'alta' };
const PETS_ES: Record<string, string> = {
  TOXIC: 'tóxica',
  MILD: 'molestias leves',
  NON_TOXIC: 'no tóxica',
  VARIES: 'depende de la especie',
};

function petsCell(care: NonNullable<CanonicalFlowerSeed['care']>): string {
  const source = care.toxicitySource ? `fuente: ${care.toxicitySource}` : 'sin fuente: confirmar';
  return `${PETS_ES[care.petToxicity] ?? care.petToxicity} (${source})`;
}

const SECTIONS: readonly { category: CanonicalFlowerSeed['category']; title: string }[] = [
  { category: 'CUT_FLOWER', title: 'Flores de corte' },
  { category: 'FOLIAGE', title: 'Follaje' },
  { category: 'PLANT', title: 'Plantas' },
];

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** Il foglio in Markdown, in spagnolo del Messico. */
export function flowerReviewMarkdown(): string {
  const lines: string[] = [
    '# Lista de flores de Gardelia — revisión',
    '',
    '<!-- Generado desde packages/db/src/reference-data.ts con',
    '     `pnpm --filter @floral/db flowers:review`. No editar a mano. -->',
    '',
    'Esta es la lista de flores, follaje y plantas que Gardelia usa para reconocer los productos',
    'del catálogo, buscarlos en cualquier idioma y describirlos en las imágenes de los ramos.',
    '',
    '**Para quien revisa:** marque en la última columna lo que esté mal o falte (un nombre que en',
    'Aguascalientes se dice distinto, un sinónimo que confunde, un color que no existe en el',
    'mercado) y anote al final las flores que vende y no aparecen.',
    '',
    'En las plantas, revise también la luz, el riego, la humedad y si son tóxicas para perros y',
    'gatos: el Asistente de plantas usa estos datos y muestra el aviso de toxicidad tal como está',
    'aquí (por ahora tomado de la lista de la ASPCA, sin revisar).',
    '',
    `Total: ${CANONICAL_FLOWERS.length} especies.`,
    '',
  ];
  for (const section of SECTIONS) {
    const flowers = CANONICAL_FLOWERS.filter((flower) => flower.category === section.category)
      .slice()
      .sort((a, b) => a.names['es-MX'].localeCompare(b.names['es-MX'], 'es'));
    lines.push(`## ${section.title} (${flowers.length})`, '');
    const plants = section.category === 'PLANT';
    lines.push(
      plants
        ? '| Nombre | También se dice | Nombre científico | Colores | Luz | Riego | Humedad | Perros y gatos | ¿Correcto? / Comentarios |'
        : '| Nombre | También se dice | Nombre científico | Colores | ¿Correcto? / Comentarios |',
    );
    lines.push(
      plants
        ? '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
        : '| --- | --- | --- | --- | --- |',
    );
    for (const flower of flowers) {
      const synonyms = (flower.synonyms['es-MX'] ?? []).join(', ') || '—';
      const colors = flower.colors.map((color) => COLOR_ES[color] ?? color).join(', ') || '—';
      const base = `| ${cell(flower.names['es-MX'])} | ${cell(synonyms)} | *${cell(flower.scientificName)}* | ${cell(colors)} |`;
      const care = flower.care;
      lines.push(
        plants && care
          ? `${base} ${LIGHT_ES[care.light]} | ${WATERING_ES[care.watering]} | ${HUMIDITY_ES[care.humidity]} | ${petsCell(care)} |  |`
          : `${base}  |`,
      );
    }
    lines.push('');
  }
  lines.push(
    '## Flores que faltan',
    '',
    '| Nombre | Cómo se le dice | Comentarios |',
    '| --- | --- | --- |',
  );
  for (let row = 0; row < 8; row++) lines.push('|  |  |  |');
  lines.push('');
  return lines.join('\n');
}
