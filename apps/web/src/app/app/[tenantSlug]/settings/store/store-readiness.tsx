import { Check, CircleAlert, CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { OnlineStoreSettingsDto } from '@floral/core';
import { STORE_READINESS_MIN_ITEMS, type StoreReadinessStep } from '@floral/domain';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';

/**
 * «Completa la tua vetrina» (M1-2, ADR-087): gli otto passi che rendono la vetrina utile a chi
 * compra, ognuno fatto o con il link al punto dove si fa. Non blocca la pubblicazione; quando è
 * tutto fatto resta una riga sola.
 */
export async function StoreReadinessCard({
  slug,
  settings,
}: {
  readonly slug: string;
  readonly settings: Pick<
    OnlineStoreSettingsDto,
    'readiness' | 'onlineItems' | 'onlineWithoutPhoto'
  >;
}) {
  const t = await getTranslations('store.readiness');
  const tStore = await getTranslations('store');
  const { readiness } = settings;
  if (readiness.missing === 0) {
    return (
      <Alert variant="success" data-testid="store-readiness">
        <CircleCheck aria-hidden="true" />
        <AlertDescription>{t('complete')}</AlertDescription>
      </Alert>
    );
  }
  const routes = tenantRoutes(slug);
  const links: Record<StoreReadinessStep, string | null> = {
    images: '#store-images',
    description: '#store-info',
    products: routes.catalog.list({ online: 'no' }),
    // Senza prodotti online il passo si fa accendendone qualcuno (riga sopra).
    photos: settings.onlineWithoutPhoto > 0 ? routes.catalog.list({ online: 'no_photo' }) : null,
    featured: routes.catalog.list({ online: 'yes' }),
    deliveryFee: `${routes.settings.general}#delivery`,
    payment: '#store-info',
    policies: '#store-policies',
  };
  const label = (step: StoreReadinessStep) => {
    if (step === 'products') {
      return t('steps.products', { min: STORE_READINESS_MIN_ITEMS, count: settings.onlineItems });
    }
    if (step === 'photos' && settings.onlineWithoutPhoto > 0) {
      return `${t('steps.photos')} · ${t('steps.photosMissing', { count: settings.onlineWithoutPhoto })}`;
    }
    return t(`steps.${step}`);
  };

  return (
    <Card data-testid="store-readiness">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle', { missing: readiness.missing })}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          {readiness.steps.map(({ step, done }) => {
            const href = links[step];
            return (
              <li
                key={step}
                data-step={step}
                data-done={done}
                className="flex items-start gap-3 rounded-xl border p-3 text-sm"
              >
                {done ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                )}
                {/* Il link sotto il testo: a 320 px il testo non va a capo parola per parola. */}
                <div className="min-w-0 flex-1">
                  <p className={done ? 'text-muted-foreground' : undefined}>
                    {label(step)}
                    <span className="sr-only">
                      {done ? ` · ${tStore('done')}` : ` · ${tStore('missing')}`}
                    </span>
                  </p>
                  {done || !href ? null : (
                    <Link
                      href={href}
                      className="mt-1 inline-block font-medium text-primary hover:underline"
                    >
                      {t(`actions.${step}`)}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
