/**
 * Il resoconto di una visita di Floral Care (ADR-078): lo stesso nella pagina della visita (lingua
 * di chi guarda) e nella pagina pubblica del cliente (lingua del mercato della fioreria). Cosa si è
 * fatto, come stanno le piante, la nota, le foto. Mai prezzi, materiali né avvisi interni.
 */
import { Check, X } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { CareVisitReportDto } from '@floral/core';
import type { CarePlantCondition, SupportedLocale } from '@floral/domain';
import { PrivateImage } from '@/components/common/private-image';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { calendarDate } from '@/lib/quote-ui';

const CONDITION_BADGE: Record<CarePlantCondition, BadgeVariant> = {
  OK: 'success',
  ATTENTION: 'warning',
  PROBLEM: 'danger',
  DEAD: 'muted',
};

export async function VisitReportView({
  report,
  locale,
  photoSrc,
}: {
  readonly report: Omit<CareVisitReportDto, 'customerName'>;
  readonly locale: SupportedLocale;
  /** Indirizzo di una foto (miniatura o intera): privata nell'app, col token nella pagina pubblica. */
  readonly photoSrc: (photoId: string, thumb: boolean) => string;
}) {
  const t = await getTranslations({ locale, namespace: 'care.report' });
  const format = await getFormatter({ locale });
  const day = format.dateTime(calendarDate(report.date), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const time = (at: Date) =>
    format.dateTime(at, { hour: '2-digit', minute: '2-digit', timeZone: report.timezone });
  const summary =
    report.status === 'NOT_DONE'
      ? t('notDone', { day })
      : report.startedAt && report.finishedAt
        ? t('doneAt', { day, from: time(report.startedAt), to: time(report.finishedAt) })
        : t('done', { day });
  const tally = (
    [
      ['OK', report.tally.ok],
      ['ATTENTION', report.tally.attention],
      ['PROBLEM', report.tally.problem],
      ['DEAD', report.tally.dead],
    ] as const
  ).filter(([, count]) => count > 0);
  const loosePhotos = report.photos.filter((photo) => photo.plantId === null);
  const photoNotice = report.photosDeleted
    ? t('photosDeleted')
    : report.photosDeleteOn
      ? t('photosDeleteOn', {
          date: format.dateTime(calendarDate(report.photosDeleteOn), {
            dateStyle: 'long',
            timeZone: 'UTC',
          }),
        })
      : t('photosDeleteLater');

  const thumbnails = (ids: readonly string[]) =>
    ids.length > 0 ? (
      <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {ids.map((id) => (
          <li key={id} className="overflow-hidden rounded-lg border bg-muted">
            <a href={photoSrc(id, false)} target="_blank" rel="noreferrer" className="block">
              <PrivateImage
                src={photoSrc(id, true)}
                alt={t('photoAlt')}
                className="aspect-square w-full object-cover"
              />
            </a>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div className="grid gap-5 text-sm">
      <div className="space-y-1">
        <p className="font-medium first-letter:uppercase">{summary}</p>
        {report.visitedBy ? (
          <p className="text-muted-foreground">{t('by', { name: report.visitedBy })}</p>
        ) : null}
      </div>

      {report.status === 'DONE' && tally.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label={t('tallyLabel')}>
          {tally.map(([condition, count]) => (
            <Badge key={condition} variant={CONDITION_BADGE[condition]}>
              {t(`tally.${condition}`, { count })}
            </Badge>
          ))}
        </div>
      ) : null}

      {report.note ? (
        <p className="rounded-xl border bg-muted/40 p-3 whitespace-pre-line">{report.note}</p>
      ) : null}

      {report.services.length > 0 ? (
        <section className="space-y-2">
          <h3 className="font-semibold">{t('servicesTitle')}</h3>
          <ul className="grid gap-1.5">
            {report.services.map((service) => (
              <li key={service.name} className="flex items-start gap-2">
                {service.outcome === 'DONE' ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="min-w-0 break-words">
                  {service.name}
                  {service.outcome === 'SKIPPED' ? (
                    <span className="text-muted-foreground">
                      {' '}
                      · {service.note ? t('skippedWhy', { note: service.note }) : t('skipped')}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.plants.length > 0 ? (
        <section className="space-y-2">
          <h3 className="font-semibold">{t('plantsTitle')}</h3>
          <ul className="divide-y rounded-xl border">
            {report.plants.map((plant) => (
              <li key={plant.plantId} className="space-y-1 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 font-medium break-words">
                    <span className="tabular-nums">{plant.quantity}</span> × {plant.name}
                  </span>
                  <Badge variant={CONDITION_BADGE[plant.condition]}>
                    {plant.affected !== null && plant.condition !== 'OK'
                      ? t('affected', {
                          condition: t(`conditions.${plant.condition}`),
                          count: plant.affected,
                        })
                      : t(`conditions.${plant.condition}`)}
                  </Badge>
                </div>
                {plant.note ? <p className="text-muted-foreground">{plant.note}</p> : null}
                {thumbnails(plant.photoIds)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loosePhotos.length > 0 ? (
        <section className="space-y-2">
          <h3 className="font-semibold">{t('photosTitle')}</h3>
          {thumbnails(loosePhotos.map((photo) => photo.id))}
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">{photoNotice}</p>
    </div>
  );
}
