'use client';

import { FlaskConical, ImageIcon, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActionState } from '@/lib/action-state';
import { useToastActionState } from '@/lib/use-action-toast';

export interface PreviewPanelData {
  readonly simulated: boolean;
  readonly outdated: boolean;
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
    readonly imageUrl: string | null;
  } | null;
  readonly designName: string;
  readonly productName: string;
  readonly requestAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}

/**
 * Anteprima AI del disegno SALVATO (ADR-024/025): solo su richiesta, stato visibile,
 * immagine sempre accompagnata dall'avvertenza. Se il provider è simulato lo dice chiaro.
 */
export function PreviewPanel({ data, dirty }: { data: PreviewPanelData; dirty: boolean }) {
  const t = useTranslations('builder.preview');
  const router = useRouter();
  const [, formAction, pending] = useToastActionState(data.requestAction);
  const status = data.preview?.status ?? null;
  const inProgress = status === 'QUEUED' || status === 'RUNNING';

  // Mentre il job è in coda o in corso, aggiorna la pagina finché cambia stato.
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [inProgress, router]);

  const showButton = status === null || status === 'FAILED';
  const blocked = dirty || data.outdated || data.quota.remaining === 0;

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
            {/* eslint-disable-next-line @next/next/no-img-element -- immagine privata servita da una route autenticata */}
            <img
              src={data.preview.imageUrl}
              alt={t('alt', { name: data.designName })}
              className="aspect-square w-full rounded-xl border bg-muted object-cover"
            />
            <figcaption className="space-y-1 text-xs text-muted-foreground">
              {data.simulated ? (
                <Badge variant="warning" className="mb-1">
                  <FlaskConical aria-hidden="true" />
                  {t('ready')}
                </Badge>
              ) : null}
              <span className="block">{t('disclaimer')}</span>
              {data.preview.reused ? <span className="block">{t('reused')}</span> : null}
            </figcaption>
          </figure>
        ) : inProgress ? (
          <div
            className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground"
            role="status"
          >
            <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
            {status === 'QUEUED' ? t('queued') : t('running')}
          </div>
        ) : (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            <ImageIcon className="size-6" aria-hidden="true" />
            {status === 'FAILED' ? (
              <span className="text-destructive" role="alert">
                {t('failed')}
              </span>
            ) : null}
          </div>
        )}

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
              {pending ? t('generating') : status === 'FAILED' ? t('retry') : t('generate')}
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
