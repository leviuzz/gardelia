import { CircleCheck, Flower2 } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { describeUnsubscribe } from '@floral/core';
import { BRAND, DEFAULT_LOCALE } from '@floral/domain';
import { SubmitButton } from '@/components/form/submit-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { serverEnv } from '@/lib/env';
import { unsubscribeAction } from './actions';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * Pagina del link "non voglio più ricevere promozioni" delle email ai clienti (ADR-047). Parla la
 * lingua del mercato della fioreria, come l'email; disiscrive solo dopo un clic sul pulsante
 * (un'anteprima automatica del link non deve togliere il consenso).
 */
export default async function UnsubscribePage({ params }: PageProps<'/unsubscribe/[token]'>) {
  const { token } = await params;
  const info = await describeUnsubscribe(serverEnv().BETTER_AUTH_SECRET, token);
  const t = await getTranslations({
    locale: info?.locale ?? DEFAULT_LOCALE,
    namespace: 'unsubscribe',
  });

  let content: React.ReactNode;
  if (!info) {
    content = (
      <>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t('invalidTitle')}</h1>
        <Alert variant="warning">
          <AlertDescription>{t('invalid')}</AlertDescription>
        </Alert>
      </>
    );
  } else if (!info.subscribed) {
    content = (
      <>
        <CircleCheck className="size-10 text-primary" aria-hidden="true" />
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t('doneTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('done', { shop: info.shopName })}</p>
      </>
    );
  } else {
    content = (
      <>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {t('question', { shop: info.shopName })}
        </h1>
        <p className="text-sm text-muted-foreground">{t('explanation')}</p>
        <form action={unsubscribeAction.bind(null, token)}>
          <SubmitButton className="w-full">{t('confirm')}</SubmitButton>
        </form>
      </>
    );
  }

  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.025_150),transparent_60%)]">
      <main className="mx-auto w-full max-w-md px-4 pt-12 pb-16">
        <p className="mb-6 flex items-center gap-2 text-sm font-medium tracking-wide text-primary uppercase">
          <Flower2 className="size-4" aria-hidden="true" />
          {info?.shopName ?? BRAND.productName}
        </p>
        <div className="space-y-5 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">{content}</div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          {t('poweredBy', { brand: BRAND.productName })}
        </p>
      </main>
    </div>
  );
}
