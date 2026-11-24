import { getFormatter, getTranslations } from 'next-intl/server';
import type { LetterheadDto } from '@floral/core';
import type { Weekday } from '@floral/domain';
import { OpeningHoursList } from '@/components/common/opening-hours-list';
import { phoneForInput } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Intestazione delle stampe (cotización, comanda), visibile solo in stampa / PDF: logo, nome,
 * indirizzo, contatti e, se richiesto, l'orario. Va al cliente finale: nella lingua del mercato
 * della fioreria (`locale`), qualunque lingua usi chi stampa (ADR-042).
 */
export async function PrintLetterhead({
  letterhead,
  logoSrc,
  locale,
  showHours = false,
  className,
}: {
  letterhead: LetterheadDto;
  /** URL del logo (rotta privata dei membri), o null se la fioreria non ne ha. */
  logoSrc: string | null;
  locale: string;
  showHours?: boolean;
  className?: string;
}) {
  const [t, format] = await Promise.all([
    getTranslations({ locale, namespace: 'letterhead' }),
    getFormatter({ locale }),
  ]);
  // 22/11/2026 è una domenica (0): nomi dei giorni nella lingua del mercato.
  const dayName = (weekday: Weekday) =>
    format.dateTime(new Date(Date.UTC(2026, 10, 22 + weekday, 12)), {
      weekday: 'long',
      timeZone: 'UTC',
    });
  const { address } = letterhead;
  const contacts = [
    letterhead.phone ? t('phone', { phone: phoneForInput(letterhead.phone) }) : null,
    letterhead.email,
  ].filter(Boolean);

  return (
    <div
      className={cn('hidden items-start gap-4 print:flex', className)}
      data-testid="print-letterhead"
    >
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo servito dall'app, solo in stampa.
        <img
          src={logoSrc}
          alt={t('logoAlt', { name: letterhead.name })}
          className="size-16 shrink-0 rounded-lg object-contain"
        />
      ) : null}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-display text-2xl font-semibold">{letterhead.name}</p>
        {address ? (
          <p className="text-sm">
            {[
              address.line,
              address.neighborhood,
              t('postalCode', { code: address.postalCode }),
              address.city,
              address.region,
            ]
              .filter(Boolean)
              .join(', ')}
          </p>
        ) : null}
        {contacts.length > 0 ? <p className="text-sm">{contacts.join(' · ')}</p> : null}
      </div>
      {showHours && letterhead.openingHours ? (
        <div className="shrink-0 text-right">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('hours')}
          </p>
          <OpeningHoursList
            className="mt-1 text-xs [&_div]:justify-end"
            days={letterhead.openingHours}
            dayName={dayName}
            dayRange={(first, last) => t('days', { first, last })}
            closedLabel={t('closed')}
          />
        </div>
      ) : null}
    </div>
  );
}
