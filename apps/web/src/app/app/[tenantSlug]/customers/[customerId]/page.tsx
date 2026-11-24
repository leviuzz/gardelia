import {
  ArrowLeft,
  CircleCheck,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  Receipt,
  TriangleExclamationPoint,
  Undo2,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  PlanRequiredError,
  canRedeemPromoDiscounts,
  getCustomer,
  hasPermission,
  listCustomerCareContracts,
  listCustomerOrders,
  listCustomerPromoDiscounts,
  listCustomerQuotes,
  type CareContractListItemDto,
  type CustomerDetailDto,
  type TenantContext,
} from '@floral/core';
import { MX_REGIONS, whatsappLink } from '@floral/domain';
import { AddressBook } from '@/components/addresses/address-book';
import { ContractStatusBadge } from '@/components/care/care-ui';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { OrderStatusBadge, QuoteStatusBadge } from '@/components/common/status-badges';
import { ArchiveControl } from '@/components/archive-control';
import { PageHeader } from '@/components/page-header';
import { DiscountCard } from '@/components/promotions/discount-card';
import { discountTextBuilder } from '@/components/promotions/discount-text';
import { RedeemDiscountDialog } from '@/components/promotions/redeem-discount-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CustomerTimeline } from '@/components/customers/customer-timeline';
import { money, phoneForInput } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import {
  addAddressAction,
  addOccasionAction,
  archiveAddressAction,
  removeOccasionAction,
  setCustomerArchivedAction,
  updateAddressAction,
  updateCustomerAction,
} from '../actions';
import { CustomerForm } from '../customer-form';
import { OccasionSection } from './occasion-section';
import { redeemPromoDiscountAction, undoPromoRedemptionAction } from '../../promotions/actions';

async function loadCustomer(ctx: TenantContext, customerId: string): Promise<CustomerDetailDto> {
  try {
    return await getCustomer(ctx, customerId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata({
  params,
}: PageProps<'/app/[tenantSlug]/customers/[customerId]'>): Promise<Metadata> {
  const { tenantSlug, customerId } = await params;
  const customer = await loadCustomer(await getTenantContext(tenantSlug), customerId);
  return { title: customer.displayName };
}

async function loadCareContracts(
  ctx: TenantContext,
  customerId: string,
): Promise<readonly CareContractListItemDto[] | null> {
  if (!hasPermission(ctx, 'subscriptions:read')) return null;
  try {
    return await listCustomerCareContracts(ctx, customerId);
  } catch (error) {
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

const REGION_NAMES = new Map<string, string>(
  MX_REGIONS.map((region) => [region.code, region.name]),
);

export default async function CustomerPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/customers/[customerId]'>) {
  const { tenantSlug, customerId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const customer = await loadCustomer(ctx, customerId);
  const quotes = await listCustomerQuotes(ctx, customer.id);
  const orders = await listCustomerOrders(ctx, customer.id);
  // Floral Care (ADR-075): i contratti del cliente (null = funzione non nel piano).
  const careContracts = await loadCareContracts(ctx, customer.id);
  const canCare = hasPermission(ctx, 'subscriptions:write') && customer.status === 'ACTIVE';
  // Sconti della promo ricevuti dal cliente (ADR-048): quando scrive con un codice, si vede qui.
  const discounts = await listCustomerPromoDiscounts(ctx, customer.id);
  const canRedeem = canRedeemPromoDiscounts(ctx);
  const discountText = await discountTextBuilder(ctx.timezone);
  const canQuote = hasPermission(ctx, 'quotes:write') && customer.status === 'ACTIVE';
  const canOrder = hasPermission(ctx, 'orders:write') && customer.status === 'ACTIVE';
  const query = await searchParams;
  const created = query.created === '1';
  // "Ver más" della cronologia (CRM-01): quanti eventi mostrare.
  const historial = typeof query.historial === 'string' ? query.historial : undefined;
  const t = await getTranslations();
  const format = await getFormatter();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const date = (value: Date) =>
    format.dateTime(value, { dateStyle: 'medium', timeZone: ctx.timezone });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href={routes.customers.list()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>
      <PageHeader
        title={customer.displayName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t(`customers.types.${customer.type}`)}</Badge>
            <Badge variant="outline">{t(`customers.sources.${customer.acquisitionSource}`)}</Badge>
            <span>{t('customers.detail.since', { date: date(customer.createdAt) })}</span>
          </span>
        }
        actions={
          customer.canWrite ? (
            <ArchiveControl
              archived={customer.status === 'ARCHIVED'}
              archiveAction={setCustomerArchivedAction.bind(null, slug, customer.id, true)}
              restoreAction={setCustomerArchivedAction.bind(null, slug, customer.id, false)}
              labels={{
                archive: t('customers.form.archive'),
                restore: t('customers.form.restore'),
                confirmTitle: t('customers.form.archiveTitle'),
                confirmBody: t('customers.form.archiveBody'),
              }}
            />
          ) : null
        }
      />

      {created ? (
        <Alert variant="success">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>{t('customers.form.created')}</AlertDescription>
        </Alert>
      ) : null}
      {customer.status === 'ARCHIVED' ? (
        <Alert variant="warning">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>{t('customers.form.archivedNotice')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2" aria-label={t('customers.detail.contactActions')}>
        {customer.phone ? (
          <>
            <Button asChild variant="outline" size="sm">
              <a href={`tel:${customer.phone}`}>
                <Phone />
                {t('customers.detail.call')} · {phoneForInput(customer.phone)}
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={whatsappLink(customer.phone)} target="_blank" rel="noopener noreferrer">
                <MessageCircle />
                {t('customers.detail.whatsapp')}
              </a>
            </Button>
          </>
        ) : null}
        {customer.email ? (
          <Button asChild variant="outline" size="sm">
            <a href={`mailto:${customer.email}`}>
              <Mail />
              {customer.email}
            </a>
          </Button>
        ) : null}
        {!customer.phone && !customer.email ? (
          <p className="text-sm text-muted-foreground">{t('customers.detail.noContact')}</p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          {customer.canWrite ? (
            <CustomerForm
              mode="edit"
              action={updateCustomerAction.bind(null, slug, customer.id)}
              consentNote={
                customer.marketingConsentAt
                  ? t('customers.form.consentSince', { date: date(customer.marketingConsentAt) })
                  : undefined
              }
              defaults={{
                type: customer.type,
                displayName: customer.displayName,
                email: customer.email ?? '',
                phone: phoneForInput(customer.phone),
                legalName: customer.legalName ?? '',
                taxId: customer.taxId ?? '',
                notes: customer.notes ?? '',
                preferences: customer.preferences ?? '',
                restrictions: customer.restrictions ?? '',
                tags: customer.tags.join(', '),
                acquisitionChannel: customer.acquisitionChannel ?? '',
                marketingConsent: customer.marketingConsent,
              }}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{t('customers.form.sectionPreferences')}</CardTitle>
                <CardDescription>{t('customers.form.readOnly')}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-3 text-sm">
                  {[
                    [t('customers.form.preferences'), customer.preferences],
                    [t('customers.form.restrictions'), customer.restrictions],
                    [t('customers.form.notes'), customer.notes],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd>{value ?? '—'}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <CardTitle>{t('quotes.customerCard.title')}</CardTitle>
              {canQuote ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={routes.quotes.new({ customerId: customer.id })}>
                    <Plus />
                    {t('quotes.customerCard.new')}
                  </Link>
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {quotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('quotes.customerCard.empty')}</p>
              ) : (
                <ul className="-mx-2 divide-y">
                  {quotes.slice(0, 5).map((quote) => (
                    <li key={quote.id}>
                      <Link
                        href={routes.quotes.detail(quote.id)}
                        className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-muted/40"
                      >
                        <span className="font-medium tabular-nums">{quote.numberLabel}</span>
                        <QuoteStatusBadge status={quote.status} />
                        <span className="ml-auto font-medium tabular-nums">
                          {money(quote.totalMinor, quote.currency)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {quotes.length > 5 ? (
                <Link
                  href={routes.quotes.list({ q: customer.displayName })}
                  className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
                >
                  {t('quotes.customerCard.viewAll')}
                </Link>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <CardTitle>{t('orders.customerCard.title')}</CardTitle>
              {canOrder ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={routes.orders.new({ customerId: customer.id })}>
                    <Plus />
                    {t('orders.newOrder')}
                  </Link>
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('orders.customerCard.empty')}</p>
              ) : (
                <ul className="-mx-2 divide-y">
                  {orders.slice(0, 5).map((order) => (
                    <li key={order.id}>
                      <Link
                        href={routes.orders.detail(order.id)}
                        className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-muted/40"
                      >
                        <span className="font-medium tabular-nums">{order.numberLabel}</span>
                        <OrderStatusBadge status={order.status} />
                        <span className="ml-auto font-medium tabular-nums">
                          {money(order.totalMinor, order.currency)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {orders.length > 5 ? (
                <Link
                  href={routes.orders.list({ when: 'all', q: customer.displayName })}
                  className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
                >
                  {t('orders.customerCard.viewAll')}
                </Link>
              ) : null}
            </CardContent>
          </Card>
          {careContracts ? (
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <CardTitle>{t('care.customerCard.title')}</CardTitle>
                {canCare ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={routes.subscriptions.new(customer.id)}>
                      <Plus />
                      {t('care.customerCard.new')}
                    </Link>
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent>
                {careContracts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('care.customerCard.empty')}</p>
                ) : (
                  <ul className="-mx-2 divide-y">
                    {careContracts.map((contract) => (
                      <li key={contract.id}>
                        <Link
                          href={routes.subscriptions.detail(contract.id)}
                          className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-muted/40"
                        >
                          <span className="font-medium tabular-nums">{contract.numberLabel}</span>
                          <ContractStatusBadge status={contract.status} />
                          {contract.overdue ? (
                            <Badge variant="danger">{t('care.contracts.overdue')}</Badge>
                          ) : null}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {contract.frequency
                              ? t(`care.offer.frequencyNames.${contract.frequency}`)
                              : null}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Estado de cuenta (ADR-082): tutte le sedi, per chi gestisce i soldi. */}
                {hasPermission(ctx, 'subscriptions:payments') &&
                careContracts.some((contract) => contract.status !== 'DRAFT') ? (
                  <Button asChild size="sm" variant="secondary" className="mt-3 w-full">
                    <Link href={routes.customers.statement(customer.id)}>
                      <Receipt />
                      {t('care.statement.link')}
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{t('customers.addresses.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <AddressBook
                canWrite={customer.canWrite}
                addAction={addAddressAction.bind(null, slug, customer.id)}
                regions={MX_REGIONS.map(({ code, name }) => ({ code, name }))}
                addresses={customer.addresses.map((address) => ({
                  ...address,
                  regionName: REGION_NAMES.get(address.region) ?? address.region,
                  updateAction: updateAddressAction.bind(null, slug, customer.id, address.id),
                  archiveAction: archiveAddressAction.bind(null, slug, customer.id, address.id),
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('customers.occasions.title')}</CardTitle>
              <CardDescription>{t('customers.occasions.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent>
              <OccasionSection
                canWrite={customer.canWrite}
                addAction={addOccasionAction.bind(null, slug, customer.id)}
                occasions={customer.occasions.map((occasion) => ({
                  ...occasion,
                  removeAction: removeOccasionAction.bind(null, slug, customer.id, occasion.id),
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('customers.promos.title')}</CardTitle>
              <CardDescription>{t('customers.promos.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {discounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('customers.promos.empty')}</p>
              ) : (
                discounts.map((discount) => {
                  const text = discountText(discount);
                  return (
                    <DiscountCard
                      key={discount.id}
                      discount={discount}
                      text={text}
                      customerHref={null}
                      actions={
                        !canRedeem ? null : discount.status === 'USED' ? (
                          <ConfirmActionDialog
                            action={undoPromoRedemptionAction.bind(null, slug, discount.id)}
                            trigger={
                              <Button variant="ghost" size="sm">
                                <Undo2 aria-hidden="true" />
                                {t('promotions.discounts.undo')}
                              </Button>
                            }
                            title={t('promotions.discounts.undoTitle', { code: discount.code })}
                            description={t('promotions.discounts.undoBody')}
                            confirmLabel={t('promotions.discounts.confirmUndo')}
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
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <CustomerTimeline ctx={ctx} customerId={customer.id} limit={historial} />
    </div>
  );
}
