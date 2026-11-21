import { ChevronLeft, ChevronRight, Images, Plus, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getEntitlements, listBouquetConfigurations } from '@floral/core';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { BuilderUpsell } from './builder-ui';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('builder');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BuilderPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/builder'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const t = await getTranslations();
  const base = `/app/${ctx.tenantSlug}/builder`;
  const entitlements = await getEntitlements(ctx);

  if (!entitlements.bouquetBuilder) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('builder.title')} description={t('builder.subtitle')} />
        <BuilderUpsell ctx={ctx} />
      </div>
    );
  }

  const raw = await searchParams;
  const archived = single(raw.archived) === '1';
  const page = Number(single(raw.page) ?? '1');
  const result = await listBouquetConfigurations(ctx, {
    page: Number.isFinite(page) ? page : 1,
    status: archived ? 'ARCHIVED' : 'ACTIVE',
  });
  const format = await getFormatter();
  const listHref = (next: number) => {
    const search = new URLSearchParams();
    if (archived) search.set('archived', '1');
    if (next > 1) search.set('page', String(next));
    const qs = search.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const newButton = (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline">
        <Link href={`${base}/references`}>
          <Images />
          {t('styleReferences.link')}
        </Link>
      </Button>
      <Button asChild>
        <Link href={`${base}/new`}>
          <Plus />
          {t('builder.newDesign')}
        </Link>
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('builder.title')}
        description={t('builder.subtitle')}
        actions={newButton}
      />

      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{t('builder.designs')}</h2>
        <Link
          href={archived ? base : `${base}?archived=1`}
          className="text-sm font-medium text-primary hover:underline"
        >
          {archived ? t('builder.showActive') : t('builder.showArchived')}
        </Link>
      </div>

      {result.items.length === 0 ? (
        archived ? (
          <p className="text-sm text-muted-foreground">{t('builder.archivedEmpty')}</p>
        ) : (
          <EmptyState
            icon={<Sparkles />}
            title={t('builder.emptyTitle')}
            body={t('builder.emptyBody')}
            action={newButton}
          />
        )
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {result.items.map((design) => (
              <li key={design.id}>
                <Link
                  href={`${base}/${design.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{design.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {t('builder.flowerCount', { count: design.flowerCount })} ·{' '}
                      {t('builder.updatedOn', {
                        date: format.dateTime(design.updatedAt, {
                          dateStyle: 'medium',
                          timeZone: ctx.timezone,
                        }),
                      })}
                    </span>
                  </span>
                  {design.style ? (
                    <Badge variant="secondary">{t(`builder.editor.styles.${design.style}`)}</Badge>
                  ) : null}
                  <span className="w-28 text-right font-semibold tabular-nums">
                    {money(design.totalMinor, design.currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {result.pageCount > 1 ? (
            <nav
              className="flex items-center justify-between"
              aria-label={t('common.pageOf', { page: result.page, pageCount: result.pageCount })}
            >
              <Button
                asChild
                variant="outline"
                size="sm"
                className={cn(result.page <= 1 && 'pointer-events-none opacity-50')}
              >
                <Link href={listHref(result.page - 1)} aria-disabled={result.page <= 1}>
                  <ChevronLeft />
                  {t('common.previous')}
                </Link>
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('common.pageOf', { page: result.page, pageCount: result.pageCount })}
              </span>
              <Button
                asChild
                variant="outline"
                size="sm"
                className={cn(result.page >= result.pageCount && 'pointer-events-none opacity-50')}
              >
                <Link
                  href={listHref(result.page + 1)}
                  aria-disabled={result.page >= result.pageCount}
                >
                  {t('common.next')}
                  <ChevronRight />
                </Link>
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
