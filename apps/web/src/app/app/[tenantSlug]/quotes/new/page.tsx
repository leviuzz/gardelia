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
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { phoneForInput } from '@/lib/format';
import { getTenantContext } from '@/lib/tenant';
import { createQuoteAction } from '../actions';
import { CreateForCustomer, CustomerPicker } from './new-quote-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('quotes.new');
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

/** Disegno del Builder da quotare (link dall'editor); se non è utilizzabile si ignora. */
async function findDesign(
  ctx: TenantContext,
  configurationId: string,
): Promise<BouquetConfigurationDto | null> {
  try {
    const design = await getBouquetConfiguration(ctx, configurationId);
    return design.status === 'ACTIVE' ? design : null;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof PlanRequiredError) return null;
    throw error;
  }
}

export default async function NewQuotePage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/quotes/new'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'quotes:write')) return <Forbidden />;
  const raw = await searchParams;
  const requestedId = single(raw.customerId);
  const t = await getTranslations();
  const base = `/app/${ctx.tenantSlug}`;
  const action = createQuoteAction.bind(null, ctx.tenantSlug);
  const preselected = requestedId ? await findCustomer(ctx, requestedId) : null;
  const requestedDesign = single(raw.configurationId);
  const design = requestedDesign ? await findDesign(ctx, requestedDesign) : null;
  const designId = design?.id ?? null;
  /** Mantiene il disegno scelto mentre si cerca o si cambia cliente. */
  const withDesign = (href: string) =>
    designId ? `${href}${href.includes('?') ? '&' : '?'}configurationId=${designId}` : href;

  const header = (
    <>
      <Link
        href={design ? `${base}/builder/${design.id}` : `${base}/quotes`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>
      <PageHeader title={t('quotes.new.title')} description={t('quotes.new.subtitle')} />
      {design ? (
        <Alert variant="info">
          <Sparkles aria-hidden="true" />
          <AlertDescription>
            <span className="block font-medium">
              {t('quotes.new.fromDesign', { name: design.name })}
            </span>
            {t('quotes.new.fromDesignBody')}
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
            <CardTitle>{t('quotes.new.quoteFor', { name: preselected.displayName })}</CardTitle>
            {contact ? <CardDescription>{contact}</CardDescription> : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {preselected.status === 'ARCHIVED' ? (
              <Alert variant="warning">
                <TriangleExclamationPoint aria-hidden="true" />
                <AlertDescription>{t('quotes.new.customerArchived')}</AlertDescription>
              </Alert>
            ) : (
              <CreateForCustomer
                action={action}
                customerId={preselected.id}
                configurationId={designId}
              />
            )}
            <Link
              href={withDesign(`${base}/quotes/new`)}
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {header}
      <form method="get" action={`${base}/quotes/new`} className="flex gap-2">
        {designId ? <input type="hidden" name="configurationId" value={designId} /> : null}
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder={t('quotes.new.searchCustomersPlaceholder')}
            aria-label={t('quotes.new.searchCustomers')}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          {t('common.search')}
        </Button>
      </form>

      {result.items.length === 0 ? (
        filters.q ? (
          <EmptyState
            icon={<Search />}
            title={t('quotes.new.noMatches')}
            action={
              <Button asChild variant="outline">
                <Link href={`${base}/customers/new`}>
                  <UserPlus />
                  {t('quotes.new.createCustomer')}
                </Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Users />}
            title={t('quotes.new.noCustomers')}
            action={
              <Button asChild>
                <Link href={`${base}/customers/new`}>
                  <UserPlus />
                  {t('quotes.new.createCustomer')}
                </Link>
              </Button>
            }
          />
        )
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {result.total > result.items.length
              ? t('quotes.new.refineSearch', { shown: result.items.length, total: result.total })
              : t('quotes.new.pickHint')}
          </p>
          <CustomerPicker
            action={action}
            configurationId={designId}
            customers={result.items.map((customer) => ({
              id: customer.id,
              displayName: customer.displayName,
              detail:
                [phoneForInput(customer.phone), customer.email].filter(Boolean).join(' · ') || null,
            }))}
          />
          <Link
            href={`${base}/customers/new`}
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
