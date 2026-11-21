/** Slug URL dei tenant (/app/{slug}). */

export const SLUG_MAX_LENGTH = 48;
export const SLUG_MIN_LENGTH = 3;

/** Slug riservati: percorsi dell'app o nomi che potrebbero confondere gli utenti. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'billing',
  'demo',
  'help',
  'invite',
  'login',
  'logout',
  'new',
  'onboarding',
  'settings',
  'signup',
  'soporte',
  'static',
  'support',
  'www',
]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Florería Las Camelias & Co." → "floreria-las-camelias-y-co". */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= SLUG_MIN_LENGTH &&
    slug.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(slug) &&
    !RESERVED_SLUGS.has(slug)
  );
}

/**
 * Slug di partenza per un nuovo tenant: se il nome non produce uno slug valido
 * (troppo corto, riservato) si usa un fallback leggibile.
 */
export function baseSlugFor(displayName: string): string {
  const slug = slugify(displayName);
  if (isValidSlug(slug)) return slug;
  const fallback = slug.length > 0 ? `${slug}-floreria` : 'floreria';
  return fallback.slice(0, SLUG_MAX_LENGTH);
}

/** Variante con suffisso per risolvere collisioni: "las-camelias" → "las-camelias-2". */
export function slugWithSuffix(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`;
}
