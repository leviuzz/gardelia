import {
  formatOpeningRanges,
  groupOpeningDays,
  type OpeningDay,
  type Weekday,
} from '@floral/domain';
import { cn } from '@/lib/utils';

/**
 * L'orario della tienda in poche righe ("Lunes a viernes 09:00–14:00, 16:00–20:00", "Domingo
 * Cerrado"): giorni consecutivi con le stesse fasce uniti, da lunedì. Componente server: i testi
 * arrivano già nella lingua giusta (della tienda o di chi usa l'app).
 */
export function OpeningHoursList({
  days,
  dayName,
  dayRange,
  closedLabel,
  className,
}: {
  days: readonly OpeningDay[];
  /** Nome del giorno come lo scrive Intl nella lingua giusta ("lunes", "Monday"). */
  dayName: (weekday: Weekday) => string;
  /** Più giorni di fila ("Lunes a viernes"). */
  dayRange: (first: string, last: string) => string;
  closedLabel: string;
  className?: string;
}) {
  return (
    <dl className={cn('grid gap-1 text-sm', className)}>
      {groupOpeningDays(days).map((group) => {
        const text =
          group.first === group.last
            ? dayName(group.first)
            : dayRange(dayName(group.first), dayName(group.last));
        // I nomi arrivano come li scrive Intl ("lunes", "Monday"): maiuscola solo in testa.
        const label = text.charAt(0).toLocaleUpperCase() + text.slice(1);
        return (
          <div key={group.first} className="flex flex-wrap gap-x-2">
            <dt className="font-medium">{label}</dt>
            <dd className={group.ranges.length > 0 ? undefined : 'text-muted-foreground'}>
              {group.ranges.length > 0 ? formatOpeningRanges(group.ranges) : closedLabel}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
