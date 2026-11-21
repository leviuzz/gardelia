/**
 * FormData → oggetto semplice per la validazione Zod.
 *  - i campi elencati in `multiValueKeys` diventano array (checkbox multipli);
 *  - i nomi con punto ("location.city") diventano oggetti annidati;
 *  - i campi interni di Next ("$ACTION_*") e i file vengono ignorati.
 */
export type FormObject = { [key: string]: string | string[] | FormObject };

export function formDataToObject(
  formData: FormData,
  multiValueKeys: readonly string[] = [],
): FormObject {
  const result: FormObject = {};
  for (const [rawKey, value] of formData.entries()) {
    if (rawKey.startsWith('$ACTION') || typeof value !== 'string') continue;
    const path = rawKey.split('.');
    let target: FormObject = result;
    for (const segment of path.slice(0, -1)) {
      const next = target[segment];
      if (next === undefined || typeof next === 'string' || Array.isArray(next)) {
        const created: FormObject = {};
        target[segment] = created;
        target = created;
      } else {
        target = next;
      }
    }
    const leaf = path[path.length - 1] ?? rawKey;
    if (multiValueKeys.includes(rawKey)) {
      const existing = target[leaf];
      target[leaf] = Array.isArray(existing) ? [...existing, value] : [value];
    } else {
      target[leaf] = value;
    }
  }
  return result;
}
