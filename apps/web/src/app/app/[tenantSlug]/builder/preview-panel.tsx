'use client';

import {
  CheckCheck,
  FlaskConical,
  ImageIcon,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import type { ActionState } from '@/lib/action-state';
import { useToastActionState } from '@/lib/use-action-toast';
import { PrivateImage } from '@/components/common/private-image';

export interface PreviewPanelData {
  readonly simulated: boolean;
  readonly outdated: boolean;
  /** Modalità della prossima richiesta: EXACT = dal boceto, con i numeri verificati. */
  readonly mode: 'EXACT' | 'PROMPT' | null;
  /** Troppe foto scartate per numeri diversi: niente nuovi tentativi per questo ramo. */
  readonly retryLimitReached: boolean;
  /** L'ultima "otra versión" non è riuscita: si vede ancora la precedente, senza credito usato. */
  readonly anotherVersionFailed: boolean;
  readonly quota: {
    readonly includedLimit: number;
    readonly includedRemaining: number;
    readonly extraRemaining: number;
    readonly remaining: number;
    /** Data di rinnovo già formattata ("1 de diciembre"). */
    readonly renewsOn: string;
  };
  readonly preview: {
    readonly jobId: string;
    readonly status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
    readonly reused: boolean;
    /** L'immagine ha usato lo stile di "Mis ramos" (descritto a parole). */
    readonly styled: boolean;
    readonly mode: 'EXACT' | 'PROMPT';
    /** Numero di fiori ricontrollato (true), non verificato (null). */
    readonly verified: boolean | null;
    readonly errorCode: string | null;
    readonly imageUrl: string | null;
    /** Foto scartata: cosa ha contato il controllo nell'ultima foto (fiore, trovati, attesi). */
    readonly countCheck: {
      readonly lines: readonly {
        readonly name: string;
        readonly expected: number;
        readonly found: number;
      }[];
      readonly other: number;
    } | null;
  } | null;
  /** Boceto esatto (ADR-034): immagine se disegnabile, altrimenti cosa manca. */
  readonly sketch: {
    readonly url: string | null;
    readonly reason:
      'no_counted_flowers' | 'too_many_stems' | 'missing_cutouts' | 'outdated' | null;
    readonly maxStems: number;
    readonly missing: readonly { readonly name: string; readonly href: string }[];
  };
  /** Fiori senza specie e con un nome generico: la foto realistica potrebbe disegnarne altri. */
  readonly withoutSpecies: readonly { readonly name: string; readonly href: string }[];
  readonly designName: string;
  readonly productName: string;
  readonly requestAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** "Generar otra versión" (1 credito, con conferma). */
  readonly anotherAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}

/**
 * Anteprima del disegno SALVATO (ADR-024/025/034). Con le foto senza fondo di ogni fiore si vede
 * subito il boceto esatto (gratis, senza IA); su richiesta l'IA lo rende fotografico e un
 * controllo ricontrolla il numero di fiori. Senza foto, anteprima descritta a parole con
 * l'avvertenza. Se il provider è simulato lo dice chiaro.
 */
export function PreviewPanel({ data, dirty }: { data: PreviewPanelData; dirty: boolean }) {
  const t = useTranslations('builder.preview');
  const router = useRouter();
  const [, formAction, pending] = useToastActionState(data.requestAction);
  const status = data.preview?.status ?? null;
  const inProgress = status === 'QUEUED' || status === 'RUNNING';
  const exact = data.mode === 'EXACT';
  const sketchUrl = data.sketch.url;
  const mismatch = status === 'FAILED' && data.preview?.errorCode === 'count_mismatch';

  // Mentre il job è in coda o in corso, aggiorna la pagina finché cambia stato.
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [inProgress, router]);

  const showButton = (status === null || status === 'FAILED') && !data.retryLimitReached;
  const blocked = dirty || data.outdated || data.quota.remaining === 0;
  const sketchImage = (className: string) =>
    sketchUrl ? (
      <PrivateImage
        src={sketchUrl}
        alt={t('sketchAlt', { name: data.designName })}
        loading="eager"
        className={className}
      />
    ) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent-foreground" aria-hidden="true" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.simulated ? (
          <Alert variant="warning">
            <FlaskConical aria-hidden="true" />
            <AlertDescription>{t('simulated')}</AlertDescription>
          </Alert>
        ) : null}

        {status === 'SUCCEEDED' && data.preview?.imageUrl ? (
          <figure className="space-y-2">
            <PrivateImage
              src={data.preview.imageUrl}
              alt={t('alt', { name: data.designName })}
              loading="eager"
              className="aspect-square w-full rounded-xl border bg-muted object-cover"
            />
            <figcaption className="space-y-1 text-xs text-muted-foreground">
              <span className="flex flex-wrap gap-1.5">
                {data.simulated ? (
                  <Badge variant="warning">
                    <FlaskConical aria-hidden="true" />
                    {t('ready')}
                  </Badge>
                ) : null}
                {data.preview.verified ? (
                  <Badge variant="success">
                    <CheckCheck aria-hidden="true" />
                    {t('verified')}
                  </Badge>
                ) : null}
              </span>
              <span className="block">
                {data.preview.mode === 'EXACT' && data.preview.verified
                  ? t('disclaimerExact')
                  : t('disclaimer')}
              </span>
              {data.preview.styled ? <span className="block">{t('styled')}</span> : null}
              {data.preview.reused ? <span className="block">{t('reused')}</span> : null}
            </figcaption>
            {sketchUrl ? (
              <a
                href={sketchUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-xl border p-2 text-sm hover:bg-muted/50"
              >
                {sketchImage('size-14 shrink-0 rounded-lg border bg-muted object-cover')}
                <span>{t('viewSketch')}</span>
              </a>
            ) : null}
            {data.anotherVersionFailed ? (
              <p className="text-sm text-muted-foreground" role="status">
                {t('anotherFailed')}
              </p>
            ) : null}
            {!data.retryLimitReached ? (
              <div className="space-y-1">
                <ConfirmActionDialog
                  action={data.anotherAction}
                  trigger={
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={dirty || data.outdated || data.quota.remaining === 0}
                    >
                      <RefreshCw aria-hidden="true" />
                      {t('another')}
                    </Button>
                  }
                  title={t('anotherTitle')}
                  description={t('anotherBody', { remaining: data.quota.remaining })}
                  confirmLabel={t('anotherConfirm')}
                  confirmVariant="default"
                />
                {dirty ? <p className="text-xs text-muted-foreground">{t('saveFirst')}</p> : null}
              </div>
            ) : null}
          </figure>
        ) : inProgress ? (
          <div className="relative" role="status">
            {sketchImage('aspect-square w-full rounded-xl border bg-muted object-cover opacity-60')}
            <div
              className={
                sketchUrl
                  ? 'absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-lg bg-card/95 p-3 text-sm shadow'
                  : 'flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground'
              }
            >
              <LoaderCircle className="size-5 shrink-0 animate-spin" aria-hidden="true" />
              {status === 'QUEUED'
                ? t('queued')
                : data.preview?.mode === 'EXACT'
                  ? t('runningExact')
                  : t('running')}
            </div>
          </div>
        ) : sketchUrl ? (
          <figure className="space-y-2">
            {sketchImage('aspect-square w-full rounded-xl border bg-muted object-cover')}
            <figcaption className="space-y-1 text-xs text-muted-foreground">
              <Badge variant="secondary">{t('sketchTitle')}</Badge>
              <span className="block">{t('sketchCaption')}</span>
              {exact && !data.retryLimitReached ? (
                <span className="block">{t('sketchNext')}</span>
              ) : null}
            </figcaption>
          </figure>
        ) : (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            <ImageIcon className="size-6" aria-hidden="true" />
            {status === 'FAILED' && !mismatch ? (
              <span className="text-destructive" role="alert">
                {t('failed')}
              </span>
            ) : null}
          </div>
        )}

        {mismatch ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t('countMismatch')}
          </p>
        ) : null}
        {mismatch && data.preview?.countCheck ? (
          <div className="space-y-1.5 rounded-xl border bg-muted/30 p-3 text-sm">
            <p>{t('countCheck.title')}</p>
            <ul className="space-y-0.5">
              {data.preview.countCheck.lines.map((line, index) => (
                <li
                  key={index}
                  className={
                    line.found === line.expected
                      ? 'break-words text-muted-foreground'
                      : 'font-medium break-words'
                  }
                >
                  {t('countCheck.line', {
                    name: line.name,
                    found: line.found,
                    expected: line.expected,
                  })}
                </li>
              ))}
              {data.preview.countCheck.other > 0 ? (
                <li className="font-medium">
                  {t('countCheck.other', { count: data.preview.countCheck.other })}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
        {data.retryLimitReached ? (
          <p className="text-sm text-muted-foreground">{t('retryLimit')}</p>
        ) : null}

        {!sketchUrl && data.sketch.reason === 'missing_cutouts' ? (
          <div className="space-y-1.5 rounded-xl border bg-muted/30 p-3 text-sm">
            <p>{t('missingPhotos')}</p>
            <ItemLinks items={data.sketch.missing} />
            <p className="text-xs text-muted-foreground">{t('missingPhotosHint')}</p>
          </div>
        ) : null}
        {!sketchUrl && data.sketch.reason === 'too_many_stems' ? (
          <p className="text-sm text-muted-foreground">
            {t('tooManyStems', { max: data.sketch.maxStems })}
          </p>
        ) : null}
        {data.withoutSpecies.length > 0 ? (
          <div className="space-y-1.5 rounded-xl border bg-muted/30 p-3 text-sm">
            <p>{t('withoutSpecies')}</p>
            <ItemLinks items={data.withoutSpecies} />
            <p className="text-xs text-muted-foreground">{t('withoutSpeciesHint')}</p>
          </div>
        ) : null}

        {showButton ? (
          <form action={formAction} className="space-y-2">
            <Button
              type="submit"
              className="w-full"
              disabled={blocked || pending}
              aria-busy={pending}
            >
              {pending ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : status === 'FAILED' ? (
                <RefreshCw />
              ) : (
                <Sparkles />
              )}
              {pending
                ? t('generating')
                : status === 'FAILED'
                  ? t('retry')
                  : exact
                    ? t('generateExact')
                    : t('generate')}
            </Button>
            {dirty ? <p className="text-sm text-muted-foreground">{t('saveFirst')}</p> : null}
            {data.outdated ? (
              <p className="text-sm text-muted-foreground">{t('outdated')}</p>
            ) : null}
          </form>
        ) : null}

        <div className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
          {data.quota.remaining > 0 ? (
            <p>
              {t('quota', {
                remaining: data.quota.includedRemaining,
                limit: data.quota.includedLimit,
              })}
              {data.quota.extraRemaining > 0
                ? ` · ${t('quotaExtra', { count: data.quota.extraRemaining })}`
                : ''}
            </p>
          ) : (
            <>
              <p className="font-medium text-foreground">{t('quotaEmpty')}</p>
              <p>{t('quotaEmptyHint', { product: data.productName })}</p>
            </>
          )}
          <p>{t('renews', { date: data.quota.renewsOn })}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Articoli del catalogo da sistemare, come etichette che portano alla scheda. */
function ItemLinks({
  items,
}: {
  items: readonly { readonly name: string; readonly href: string }[];
}) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className="inline-flex rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium hover:bg-muted"
          >
            {item.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
