import {
  ArrowLeft,
  Search,
  Sparkles,
  TriangleExclamationPoint,
  UserPlus,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  PlanRequiredError,
  getBouquetConfiguration,
  getCustomer,
  hasPermission,
  listCustomers,
  type BouquetConfigurationDto,
  type CustomerDetailDto,
  type TenantContext,
} from '@floral/core';
import { customerListFiltersSchema } from '@floral/domain';
import { SearchInput } from '@/components/common/list/search-input';
import { StepIndicator } from '@/components/common/step-indicator';
import { CreateForCustomer, CustomerPicker } from '@/components/customers/customer-picker';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { phoneForInput } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { createDraftOrderAction } from '../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orders.new');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Cliente preselezionato (link dalla scheda cliente); se non esiste si torna alla scelta. */
async function findCustomer(
  ctx: TenantContext,
  customerId: string,
): Promise<CustomerDetailDto | null> {
  try {
    return await getCustomer(ctx, customerId);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

/** Disegno del Diseñador da ordinare (link dall'editor); se non è utilizzabile si ignora. */
async function findDesign(
  ctx: TenantContext,
  configurationId: string,
): Promise<BouquetConfigurationDto | null> {
  if (!hasPermission(ctx, 'builder:use')) return null;
  try {
    const design = await getBouquetConfiguration(ctx, configurationId);
    return design.status === 'ACTIVE' ? design : null;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof PlanRequiredError) return null;
    throw error;
  }
}

/**
 * "Nuevo pedido" (ADR-054, blocco A1b): si sceglie il cliente e nasce un borrador, dove si
 * aggiungono prodotti, consegna e tarjeta prima di confermarlo.
 */
export default async function NewOrderPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/orders/new'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'orders:write')) return <Forbidden />;
  const raw = await searchParams;
  const requestedId = single(raw.customerId);
  const t = await getTranslations();
  const routes = tenantRoutes(ctx.tenantSlug);
  const action = createDraftOrderAction.bind(null, ctx.tenantSlug);
  const preselected = requestedId ? await findCustomer(ctx, requestedId) : null;
  const requestedDesign = single(raw.configurationId);
  const design = requestedDesign ? await findDesign(ctx, requestedDesign) : null;
  const designId = design?.id ?? null;

  const header = (
    <>
      <Link
        href={design ? routes.builder.design(design.id) : routes.orders.list()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>
      <PageHeader title={t('orders.new.title')} description={t('orders.new.subtitle')} />
      {/* Primo dei tre passi del pedido diretto: poi prodotti e consegna nel borrador. */}
      <StepIndicator
        steps={[
          { key: 'customer', label: t('orders.draft.stepCustomer') },
          { key: 'products', label: t('orders.draft.stepProducts') },
          { key: 'delivery', label: t('orders.draft.stepDelivery') },
        ]}
        current={0}
      />
      {design ? (
        <Alert variant="info">
          <Sparkles aria-hidden="true" />
          <AlertDescription>
            <span className="block font-medium">
              {t('orders.new.fromDesign', { name: design.name })}
            </span>
            {t('orders.new.fromDesignBody')}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );

  if (preselected) {
    const contact = [phoneForInput(preselected.phone), preselected.email]
      .filter(Boolean)
      .join(' · ');
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {header}
        <Card>
          <CardHeader>
            <CardTitle>{t('orders.new.orderFor', { name: preselected.displayName })}</CardTitle>
            {contact ? <CardDescription>{contact}</CardDescription> : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {preselected.status === 'ARCHIVED' ? (
              <Alert variant="warning">
                <TriangleExclamationPoint aria-hidden="true" />
                <AlertDescription>{t('orders.new.customerArchived')}</AlertDescription>
              </Alert>
            ) : (
              <CreateForCustomer
                action={action}
                customerId={preselected.id}
                configurationId={designId}
                labels={{ create: t('orders.new.create'), creating: t('orders.new.creating') }}
              />
            )}
            <Link
              href={routes.orders.new({ configurationId: designId })}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              {t('quotes.new.chooseAnother')}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const query = { q: single(raw.q), status: 'ACTIVE' };
  const filters = customerListFiltersSchema.parse(query);
  const result = await listCustomers(ctx, query);
  const createCustomerLink = (
    <Button asChild variant={filters.q ? 'outline' : 'default'}>
      <Link href={routes.customers.new}>
        <UserPlus />
        {t('quotes.new.createCustomer')}
      </Link>
    </Button>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {header}
      <form method="get" action={routes.orders.new()} className="flex gap-2">
        {designId ? <input type="hidden" name="configurationId" value={designId} /> : null}
        <SearchInput
          defaultValue={filters.q}
          placeholder={t('quotes.new.searchCustomersPlaceholder')}
          label={t('quotes.new.searchCustomers')}
          className="flex-1"
        />
        <Button type="submit" variant="secondary">
          {t('common.search')}
        </Button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState
          icon={filters.q ? <Search /> : <Users />}
          title={filters.q ? t('quotes.new.noMatches') : t('quotes.new.noCustomers')}
          action={createCustomerLink}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {result.total > result.items.length
              ? t('quotes.new.refineSearch', { shown: result.items.length, total: result.total })
              : t('orders.new.pickHint')}
          </p>
          <CustomerPicker
            action={action}
            configurationId={designId}
            customers={result.items.map((customer) => ({
              id: customer.id,
              displayName: customer.displayName,
              detail:
                [phoneForInput(customer.phone), customer.email].filter(Boolean).join(' · ') || null,
              pickLabel: t('orders.new.orderFor', { name: customer.displayName }),
            }))}
          />
          <Link
            href={routes.customers.new}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <UserPlus className="size-4" />
            {t('quotes.new.createCustomer')}
          </Link>
        </div>
      )}
    </div>
  );
}
