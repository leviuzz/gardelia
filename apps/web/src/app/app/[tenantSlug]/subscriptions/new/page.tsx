import { ArrowLeft, MapPinPlus, Search, UserPlus, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  PlanRequiredError,
  getCareContractForm,
  getCareSetupStatus,
  hasPermission,
  listCustomers,
  type CareContractFormDto,
  type CareSetupStatusDto,
  type TenantContext,
} from '@floral/core';
import { customerListFiltersSchema, isUuid } from '@floral/domain';
import { CareContractForm } from '@/components/care/contract-forms';
import { CareSetupChecklist } from '@/components/care/care-setup-checklist';
import { CareUpsell } from '@/components/care/care-upsell';
import { SearchInput } from '@/components/common/list/search-input';
import { CustomerPicker } from '@/components/customers/customer-picker';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { phoneForInput } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { chooseCareContractCustomerAction, createCareContractAction } from '../actions';
import { contractFormOptions } from '../care-form-data';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.contractForm');
  return { title: t('newTitle') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function loadForm(
  ctx: TenantContext,
  customerId: string,
): Promise<CareContractFormDto | null> {
  try {
    return await getCareContractForm(ctx, customerId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

async function loadSetup(ctx: TenantContext): Promise<CareSetupStatusDto | null> {
  try {
    return await getCareSetupStatus(ctx);
  } catch (error) {
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

/**
 * «¿Para qué cliente es el contrato?» (da «Nuevo contrato» dell'elenco dei contratti): prima i
 * passi che mancano all'offerta, se mancano; poi la ricerca e l'elenco dei clienti attivi, come per
 * una cotización. Scelto il cliente si apre il modulo.
 */
async function CustomerStep({ ctx, q }: { readonly ctx: TenantContext; readonly q?: string }) {
  const t = await getTranslations();
  const routes = tenantRoutes(ctx.tenantSlug);
  const header = (
    <div className="space-y-3">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={routes.subscriptions.list()}>
          <ArrowLeft aria-hidden="true" />
          {t('care.contractForm.pick.back')}
        </Link>
      </Button>
      <PageHeader
        title={t('care.contractForm.newTitle')}
        description={t('care.contractForm.pick.subtitle')}
      />
    </div>
  );
  const setup = await loadSetup(ctx);
  if (!setup) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {header}
        <CareUpsell ctx={ctx} />
      </div>
    );
  }
  // Senza offerta pronta il modulo non si potrebbe usare: prima i passi che mancano.
  if (!setup.ready) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {header}
        <CareSetupChecklist status={setup} settingsHref={routes.settings.care} />
      </div>
    );
  }
  const query = { q, status: 'ACTIVE' };
  const filters = customerListFiltersSchema.parse(query);
  const result = await listCustomers(ctx, query);
  const createCustomer = (
    <Button asChild variant={result.items.length === 0 && !filters.q ? 'default' : 'outline'}>
      <Link href={routes.customers.new}>
        <UserPlus aria-hidden="true" />
        {t('care.contractForm.pick.createCustomer')}
      </Link>
    </Button>
  );
  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid="care-pick-customer">
      {header}
      <form method="get" action={routes.subscriptions.new()} className="flex gap-2">
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
          action={createCustomer}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {result.total > result.items.length
              ? t('quotes.new.refineSearch', { shown: result.items.length, total: result.total })
              : t('care.contractForm.pick.hint')}
          </p>
          <CustomerPicker
            action={chooseCareContractCustomerAction.bind(null, ctx.tenantSlug)}
            configurationId={null}
            customers={result.items.map((customer) => ({
              id: customer.id,
              displayName: customer.displayName,
              detail:
                [phoneForInput(customer.phone), customer.email].filter(Boolean).join(' · ') || null,
              pickLabel: t('care.contractForm.pick.contractFor', { name: customer.displayName }),
            }))}
          />
          <Link
            href={routes.customers.new}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <UserPlus className="size-4" aria-hidden="true" />
            {t('care.contractForm.pick.createCustomer')}
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * "Nuevo contrato de Floral Care": senza cliente (`?customer=`) si sceglie il cliente; con il
 * cliente, il modulo (sede, frequenza e fasce, primo giorno, servizi). Dopo si aggiungono le piante
 * della diagnosi e si conferma il prezzo.
 */
export default async function NewCareContractPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/subscriptions/new'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:write')) return <Forbidden />;
  const query = await searchParams;
  const customerId = single(query.customer);
  if (!customerId) return <CustomerStep ctx={ctx} q={single(query.q)} />;
  if (!isUuid(customerId)) notFound();
  const t = await getTranslations();
  const routes = tenantRoutes(ctx.tenantSlug);
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={routes.customers.detail(customerId)}>
        <ArrowLeft aria-hidden="true" />
        {t('care.contractForm.backToCustomer')}
      </Link>
    </Button>
  );
  const form = await loadForm(ctx, customerId);
  if (!form) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {back}
        <CareUpsell ctx={ctx} />
      </div>
    );
  }
  const header = (
    <PageHeader
      title={t('care.contractForm.newTitle')}
      description={t('care.contractForm.newSubtitle', { name: form.customer.name })}
    />
  );
  // Senza offerta, fasce o sedi non si può fare un contratto: si dice quale passo manca e dove.
  const missingOffer = !form.configured || form.slots.length === 0 || form.frequencies.length === 0;
  if (missingOffer || form.addresses.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-3">
          {back}
          {header}
        </div>
        {missingOffer ? (
          <CareSetupChecklist
            status={{
              tariffsSaved: form.configured,
              activeSlots: form.slots.length,
              frequencies: form.frequencies.length,
              ready: false,
              canWrite: true,
            }}
            settingsHref={routes.settings.care}
          />
        ) : (
          <EmptyState
            icon={<MapPinPlus />}
            title={t('care.contractForm.needsAddressTitle')}
            body={t('care.contractForm.needsAddressBody')}
            action={
              <Button asChild>
                <Link href={routes.customers.detail(customerId)}>
                  {t('care.contractForm.needsAddressAction')}
                </Link>
              </Button>
            }
          />
        )}
      </div>
    );
  }
  const options = await contractFormOptions(form);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        {back}
        {header}
      </div>
      <CareContractForm
        action={createCareContractAction.bind(null, ctx.tenantSlug, form.customer.id)}
        currency={form.currency}
        addresses={options.addresses}
        frequencies={form.frequencies}
        slots={options.slots}
        services={options.services}
        start={{ min: form.startMin, max: form.startMax }}
        submitLabel={t('care.contractForm.create')}
        defaults={{
          customerAddressId: form.addresses[0]?.id ?? '',
          frequency: form.frequencies[0] ?? 'MONTHLY_2',
          slotIds: [],
          startDate: form.startDefault,
          seats: '',
          // I servizi inclusi nella tariffa partono scelti: li fa a ogni visita.
          serviceIds: form.services
            .filter((service) => service.pricing === 'INCLUDED')
            .map((service) => service.serviceId),
          contactName: '',
          contactPhone: '',
          accessNotes: '',
          notes: '',
          outOfRangeConfirmed: false,
        }}
      />
    </div>
  );
}
