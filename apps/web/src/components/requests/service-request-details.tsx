import { CalendarDays, ImageOff, MapPin, MessageSquareText, Wallet } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ServiceRequestDetailDto } from '@floral/core';
import { formatTimeOfDay } from '@floral/domain';
import { PrivateImage } from '@/components/common/private-image';
import { money } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';

/**
 * Quello che ha scritto chi compra in una richiesta (M5): data, indirizzo, budget, le risposte del
 * modulo per tipo, il messaggio e le foto di ispirazione. Lo stesso blocco nel conto di chi compra e
 * nell'app della fioreria, nella lingua di chi guarda; i testi di chi compra restano come li ha
 * scritti.
 */
export async function ServiceRequestDetails({
  request,
  photoSrc,
}: {
  readonly request: ServiceRequestDetailDto;
  readonly photoSrc: (photoId: string, thumb: boolean) => string;
}) {
  const t = await getTranslations('serviceRequest');
  const tDetails = await getTranslations('requestDetails');
  const format = await getFormatter();
  const answers = request.answers;
  const facts: { readonly label: string; readonly value: string }[] = [];
  if (answers?.eventType)
    facts.push({ label: t('eventType'), value: t(`eventTypes.${answers.eventType}`) });
  if (answers?.guests) facts.push({ label: t('guests'), value: String(answers.guests) });
  if (answers?.place) facts.push({ label: t('place'), value: answers.place });
  if (answers?.venueType)
    facts.push({ label: t('venueType'), value: t(`venueTypes.${answers.venueType}`) });
  if (answers?.recurrence) {
    facts.push({ label: t('recurrence'), value: t(`recurrences.${answers.recurrence}`) });
  }
  if (answers?.weekday !== undefined) {
    facts.push({ label: t('weekday'), value: t(`weekdays.${answers.weekday}`) });
  }
  if (answers?.windowStartMinutes !== undefined && answers.windowEndMinutes !== undefined) {
    facts.push({
      label: t('window'),
      value: t('windowOption', {
        start: formatTimeOfDay(answers.windowStartMinutes),
        end: formatTimeOfDay(answers.windowEndMinutes),
      }),
    });
  }
  if (answers?.duration)
    facts.push({ label: t('duration'), value: t(`durations.${answers.duration}`) });
  if (answers?.plants) facts.push({ label: t('plants'), value: String(answers.plants) });
  if (answers?.frequency) {
    facts.push({ label: t('frequency'), value: t(`frequencies.${answers.frequency}`) });
  }
  const address = request.address;

  return (
    <div className="space-y-5" data-testid="service-request-details">
      <ul className="grid gap-3 text-sm sm:grid-cols-2">
        {request.preferredDate ? (
          <li className="flex items-start gap-2">
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <span className="block text-muted-foreground">{tDetails('date')}</span>
              <span className="first-letter:uppercase">
                {format.dateTime(calendarDate(request.preferredDate), {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                })}
              </span>
            </span>
          </li>
        ) : null}
        {request.budgetMinor !== null ? (
          <li className="flex items-start gap-2">
            <Wallet className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <span className="block text-muted-foreground">{tDetails('budget')}</span>
              <span className="tabular-nums">{money(request.budgetMinor, request.currency)}</span>
            </span>
          </li>
        ) : null}
        {address ? (
          <li className="flex items-start gap-2 sm:col-span-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <span className="block text-muted-foreground">{tDetails('address')}</span>
              <span className="break-words">
                {[address.addressLine1, address.addressLine2, address.neighborhood, address.city]
                  .filter(Boolean)
                  .join(', ')}
                {` (${address.region} ${address.postalCode})`}
              </span>
              {address.notes ? (
                <span className="block text-muted-foreground">{address.notes}</span>
              ) : null}
            </span>
          </li>
        ) : null}
      </ul>

      {facts.length > 0 ? (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.label} className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{fact.label}:</dt>
              <dd className="font-medium break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {request.message ? (
        <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-4 text-sm">
          <MessageSquareText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="break-words whitespace-pre-line">{request.message}</p>
        </div>
      ) : null}

      {request.photos.length > 0 ? (
        <ul
          className="grid grid-cols-3 gap-2 sm:max-w-md"
          data-testid="service-request-photos-list"
        >
          {request.photos.map((photo, index) => (
            <li key={photo.id}>
              {photo.deleted ? (
                <div className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border bg-muted text-center text-xs text-muted-foreground">
                  <ImageOff className="size-5" aria-hidden="true" />
                  {tDetails('photoDeleted')}
                </div>
              ) : (
                <a href={photoSrc(photo.id, false)} target="_blank" rel="noreferrer">
                  <PrivateImage
                    src={photoSrc(photo.id, true)}
                    alt={tDetails('photoAlt', { index: index + 1 })}
                    className="aspect-square w-full rounded-xl border bg-muted object-cover"
                  />
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
