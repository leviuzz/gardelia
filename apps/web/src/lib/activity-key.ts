/**
 * Chiave del testo di una voce di "Actividad reciente" (dashboard): `activity.<azione>` (es.
 * `activity.customer.created`, testi annidati per modulo), altrimenti quella nel namespace del
 * modulo (ADR-060: `inventory.item_created` → `inventory.activity.item_created`); null se l'azione
 * non ha un testo (si mostra quello generico).
 */
export function activityMessageKey(action: string, has: (key: string) => boolean): string | null {
  const direct = `activity.${action}`;
  if (has(direct)) return direct;
  const [module, ...rest] = action.split('.');
  const moduleKey = `${module}.activity.${rest.join('.')}`;
  return has(moduleKey) ? moduleKey : null;
}
