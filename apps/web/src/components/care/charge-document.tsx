import 'server-only';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { CareChargeDetailDto, CareChargeLineDto } from '@floral/core';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Le righe di un cargo di Floral Care (ADR-082) con i totali. Serve due volte: sullo schermo nella
 * lingua di chi guarda e nella stampa per il cliente nella lingua del mercato della fioreria
 * (ADR-042). Le visite del mese stanno in una riga sola ("4 visitas × $490").
 */
export async function ChargeLines({
  charge,
  locale,
  className,
}: {
  readonly charge: CareChargeDetailDto;
  readonly locale: string;
  readonly className?: string;
}) {
  const [t, format] = await Promise.all([
    getTranslations({ locale, namespace: 'care.charge' }),
    getFormatter({ locale }),
  ]);
  const price = (minor: number) => money(minor, charge.currency, locale);
  const day = (iso: string | null) =>
    iso
      ? format.dateTime(new Date(`${iso}T12:00:00Z`), {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        })
      : '—';
  const label = (line: CareChargeLineDto): string => {
    switch (line.kind) {
      case 'VISITS':
        return t('lines.VISITS', { count: line.quantity, price: price(line.unitPriceMinor) });
      case 'VISIT_DEBIT':
        return t('lines.VISIT_DEBIT', { date: day(line.visitDate) });
      case 'VISIT_CREDIT':
        return t('lines.VISIT_CREDIT', {
          date: day(line.visitDate),
          reason: line.creditReason ? t(`creditReasons.${line.creditReason}`) : '—',
        });
      case 'EXTRA_VISIT':
        return t('lines.EXTRA_VISIT', { date: day(line.visitDate) });
      case 'ONE_TIME_SERVICE':
        return t('lines.ONE_TIME_SERVICE', { name: line.label ?? '—', date: day(line.visitDate) });
      case 'CREDIT_CARRIED_IN':
        return t('lines.CREDIT_CARRIED_IN', { number: line.sourceCharge?.numberLabel ?? '—' });
      case 'CREDIT_CARRIED_OUT':
        return charge.carriedInto
          ? t('lines.CREDIT_CARRIED_OUT_TO', { number: charge.carriedInto.numberLabel })
          : t('lines.CREDIT_CARRIED_OUT');
      case 'ADJUSTMENT':
        return line.label ?? t('lines.ADJUSTMENT');
    }
  };
  const inFavor = charge.balanceMinor < 0;
  return (
    <div className={cn('space-y-3 text-sm', className)}>
      <ul className="divide-y rounded-xl border print:rounded-none print:border-x-0">
        {charge.lines.map((line) => (
          <li
            key={line.id}
            className="flex items-start justify-between gap-3 px-4 py-2.5 print:px-0"
          >
            <span className="min-w-0 break-words">{label(line)}</span>
            <span
              className={cn(
                'shrink-0 tabular-nums',
                line.amountMinor < 0 && 'text-[oklch(0.42_0.12_150)]',
              )}
            >
              {price(line.amountMinor)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="grid gap-1.5 rounded-xl bg-muted/50 p-4 print:bg-transparent print:px-0">
        <div className="flex justify-between gap-3 font-semibold">
          <dt>{t('total')}</dt>
          <dd className="tabular-nums">{price(charge.totalMinor)}</dd>
        </div>
        {charge.paidMinor !== 0 ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('paid')}</dt>
            <dd className="tabular-nums">{price(charge.paidMinor)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold">
          <dt>{inFavor ? t('inFavor') : t('balance')}</dt>
          <dd className="tabular-nums">{price(Math.abs(charge.balanceMinor))}</dd>
        </div>
      </dl>
      {charge.final ? <p className="text-xs text-muted-foreground">{t('finalNote')}</p> : null}
      <p className="text-xs text-muted-foreground">{t('taxNote')}</p>
    </div>
  );
}
