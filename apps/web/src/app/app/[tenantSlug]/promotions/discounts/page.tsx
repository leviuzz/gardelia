import { ArrowLeft, TicketPercent, Undo2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { hasPermission, listPromoDiscounts } from '@floral/core';
import { PROMO_DISCOUNT_STATUSES, promoDiscountFiltersSchema } from '@floral/domain';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { DiscountCard } from '@/components/promotions/discount-card';
import { discountTextBuilder } from '@/components/promotions/discount-text';
import { RedeemDiscountDialog } from '@/components/promotions/redeem-discount-dialog';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { redeemPromoDiscountAction, undoPromoRedemptionAction } from '../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('promotions.discounts');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Registro degli sconti della promo (ADR-048): quando un cliente scrive "ho questo codice", qui
 * si cerca (codice, nome, email o telefono), si vede se vale ancora e si segna come usato.
 */
export default async function PromoDiscountsPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/promotions/discounts'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'promotions:manage')) return <Forbidden />;
  const raw = await searchParams;
  const query = { q: single(raw.q), status: single(raw.status), page: single(raw.page) };
  const filters = promoDiscountFiltersSchema.parse(query);
  const result = await listPromoDiscounts(ctx, query);
  const t = await getTranslations('promotions.discounts');
  const tc = await getTranslations('common');
  const routes = tenantRoutes(ctx.tenantSlug);
  const textFor = await discountTextBuilder(ctx.timezone);
  const hasFilters = Boolean(filters.q || filters.status);
  const slug = ctx.tenantSlug;

  function pageHref(page: number): string {
    return routes.promotions.discounts({
      q: filters.q,
      status: filters.status,
      page: page > 1 ? page : undefined,
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={routes.promotions.home}>
            <ArrowLeft aria-hidden="true" />
            {t('back')}
          </Link>
        </Button>
        <PageHeader title={t('title')} description={t('subtitle')} />
      </div>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {PROMO_DISCOUNT_STATUSES.map((status) => (
          <span key={status}>{t(`counts.${status}`, { count: result.counts[status] })}</span>
        ))}
      </p>

      <FilterBar
        action={routes.promotions.discounts()}
        search={{ defaultValue: filters.q, placeholder: t('searchPlaceholder') }}
        hasFilters={hasFilters}
        className="sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
      >
        <NativeSelect name="status" defaultValue={filters.status ?? ''} aria-label={tc('filter')}>
          <option value="">{t('allStatuses')}</option>
          {PROMO_DISCOUNT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`statuses.${status}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>

      <ListResults
        isEmpty={result.items.length === 0}
        hasFilters={hasFilters}
        noResults={{ title: t('noResultsTitle'), body: t('noResultsBody') }}
        empty={
          <EmptyState icon={<TicketPercent />} title={t('emptyTitle')} body={t('emptyBody')} />
        }
        count={t('results', { count: result.total })}
      >
        <div className="space-y-2">
          {result.items.map((discount) => {
            const text = textFor(discount);
            return (
              <DiscountCard
                key={discount.id}
                discount={discount}
                text={text}
                customerHref={routes.customers.detail(discount.customerId)}
                actions={
                  discount.status === 'USED' ? (
                    <ConfirmActionDialog
                      action={undoPromoRedemptionAction.bind(null, slug, discount.id)}
                      trigger={
                        <Button variant="ghost" size="sm">
                          <Undo2 aria-hidden="true" />
                          {t('undo')}
                        </Button>
                      }
                      title={t('undoTitle', { code: discount.code })}
                      description={t('undoBody')}
                      confirmLabel={t('confirmUndo')}
                      confirmVariant="default"
                    />
                  ) : (
                    <RedeemDiscountDialog
                      action={redeemPromoDiscountAction.bind(null, slug, discount.id)}
                      code={discount.code}
                      customerName={discount.customerName}
                      discount={text.discount}
                    />
                  )
                }
              />
            );
          })}
        </div>
        <ListPagination page={result.page} pageCount={result.pageCount} href={pageHref} />
      </ListResults>
    </div>
  );
}
