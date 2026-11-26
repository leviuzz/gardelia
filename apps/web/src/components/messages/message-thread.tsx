import { Check, CircleHelp, ImageOff, Trash2, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
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
  /**
   * Ordini online (M3-2): una domanda «sì / no» della fioreria. `label` va sopra il testo, `footer`
   * sotto (la risposta, l'attesa o i pulsanti «Sí» / «No» per chi compra).
   */
  readonly question?: { readonly label: string; readonly footer: ReactNode } | null;
  /** Ordini online (M3-2): la risposta di chi compra a una domanda, al posto del testo. */
  readonly answer?: { readonly label: string; readonly yes: boolean } | null;
}

/**
 * Il filo dei messaggi di un contratto di Floral Care (ADR-084) o di un ordine online (ADR-088),
 * per la fioreria e per chi è dall'altra parte: i messaggi di chi guarda a destra, quelli
 * dell'altra parte a sinistra; prima del primo da leggere, il separatore. Il testo resta com'è
 * stato scritto (a capo compresi).
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
  const t = useTranslations('thread');
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
            {item.question ? (
              <p className="flex items-center gap-1 text-xs font-medium text-primary">
                <CircleHelp className="size-3.5" aria-hidden="true" />
                {item.question.label}
              </p>
            ) : null}
            {item.body ? (
              <p
                className={cn(
                  'rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap',
                  item.side === 'own' ? 'bg-primary/10' : 'bg-muted',
                  item.question ? 'border border-primary/30' : null,
                )}
              >
                {item.body}
              </p>
            ) : null}
            {item.answer ? (
              <p
                data-testid="message-answer"
                className={cn(
                  'flex items-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-medium',
                  item.side === 'own' ? 'bg-primary/10' : 'bg-muted',
                )}
              >
                {item.answer.yes ? (
                  <Check className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <X className="size-4 text-destructive" aria-hidden="true" />
                )}
                {item.answer.label}
              </p>
            ) : null}
            {item.question?.footer ?? null}
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
