import { ImageOff, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { PrivateImage } from '@/components/common/private-image';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/action-state';
import { cn } from '@/lib/utils';

export interface MessageThreadItem {
  readonly id: string;
  /** Dalla parte di chi guarda (a destra) o dell'altra (a sinistra). */
  readonly side: 'own' | 'other';
  readonly author: string;
  readonly body: string;
  readonly photo: { readonly thumbUrl: string; readonly fullUrl: string } | null;
  readonly photoGone: boolean;
  readonly at: Date;
  /** Da leggere per la fioreria, nuovo per la persona: prima del primo va il separatore. */
  readonly highlight: boolean;
  /** "Quitar foto" (chi gestisce), già legato al messaggio. */
  readonly removePhoto: ((prev: ActionState, formData: FormData) => Promise<ActionState>) | null;
}

/**
 * Il filo dei messaggi di un contratto (ADR-084), per la fioreria e per il portale: i messaggi di
 * chi guarda a destra, quelli dell'altra parte a sinistra; prima del primo da leggere, il
 * separatore. Il testo resta com'è stato scritto (a capo compresi).
 */
export function MessageThread({
  items,
  timeZone,
  dividerLabel,
}: {
  readonly items: readonly MessageThreadItem[];
  readonly timeZone: string;
  readonly dividerLabel: string;
}) {
  const t = useTranslations('care.messages');
  const format = useFormatter();
  const firstHighlight = items.findIndex((item) => item.highlight);
  return (
    <ol className="space-y-3" data-testid="message-thread">
      {items.map((item, index) => (
        <li key={item.id} className="space-y-3">
          {index === firstHighlight ? (
            <div
              role="separator"
              className="flex items-center gap-3 text-xs font-medium text-primary"
            >
              <span className="h-px flex-1 bg-primary/30" />
              {dividerLabel}
              <span className="h-px flex-1 bg-primary/30" />
            </div>
          ) : null}
          <article
            data-testid="message"
            className={cn(
              'flex max-w-[85%] flex-col gap-1',
              item.side === 'own' ? 'ml-auto items-end' : 'items-start',
            )}
          >
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{item.author}</span>
              {' · '}
              <time dateTime={item.at.toISOString()}>
                {format.dateTime(item.at, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone,
                })}
              </time>
            </p>
            {item.body ? (
              <p
                className={cn(
                  'rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap',
                  item.side === 'own' ? 'bg-primary/10' : 'bg-muted',
                )}
              >
                {item.body}
              </p>
            ) : null}
            {item.photo ? (
              <a href={item.photo.fullUrl} target="_blank" rel="noopener noreferrer">
                <PrivateImage
                  src={item.photo.thumbUrl}
                  alt={t('photoAlt')}
                  className="size-32 rounded-xl border bg-muted object-cover"
                />
              </a>
            ) : item.photoGone ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground italic">
                <ImageOff className="size-3.5" aria-hidden="true" />
                {t('photoGone')}
              </p>
            ) : null}
            {item.photo && item.removePhoto ? (
              <ConfirmActionDialog
                action={item.removePhoto}
                trigger={
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs">
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    {t('removePhoto')}
                  </Button>
                }
                title={t('removePhotoTitle')}
                description={t('removePhotoBody')}
                confirmLabel={t('removePhoto')}
              />
            ) : null}
          </article>
        </li>
      ))}
    </ol>
  );
}
