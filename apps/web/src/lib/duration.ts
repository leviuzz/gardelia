/** Testi della durata (`duration.*` nei messaggi): "45 min", "2 h", "2 h 15 min". */
export type DurationTranslator = (
  key: 'hours' | 'minutes' | 'hoursMinutes',
  values: { hours: number; minutes: number },
) => string;

/** Minuti → testo breve leggibile, uguale nelle tre lingue dell'app (ADR-081). */
export function formatDuration(t: DurationTranslator, totalMinutes: number): string {
  const total = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return t('minutes', { hours, minutes });
  if (minutes === 0) return t('hours', { hours, minutes });
  return t('hoursMinutes', { hours, minutes });
}
