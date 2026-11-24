import { ArrowLeft, MapPinPlus, Settings } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  PlanRequiredError,
  getCareContractForm,
  hasPermission,
  type CareContractFormDto,
  type TenantContext,
} from '@floral/core';
import { isUuid } from '@floral/domain';
import { CareContractForm } from '@/components/care/contract-forms';
import { CareUpsell } from '@/components/care/care-upsell';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { createCareContractAction } from '../actions';
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

/**
 * "Nuevo contrato de Floral Care" dalla scheda del cliente (`?customer=`): sede, frequenza e fasce,
 * primo giorno, servizi. Dopo si aggiungono le piante della diagnosi e si conferma il prezzo.
 */
export default async function NewCareContractPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/subscriptions/new'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:write')) return <Forbidden />;
  const customerId = single((await searchParams).customer);
  if (!customerId || !isUuid(customerId)) notFound();
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
  // Senza offerta, fasce o sedi non si può fare un contratto: si dice cosa manca e dove.
  const missingOffer = !form.configured || form.slots.length === 0 || form.frequencies.length === 0;
  if (missingOffer || form.addresses.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-3">
          {back}
          {header}
        </div>
        {missingOffer ? (
          <EmptyState
            icon={<Settings />}
            title={t('care.contractForm.needsOfferTitle')}
            body={t('care.contractForm.needsOfferBody')}
            action={
              <Button asChild>
                <Link href={routes.settings.care}>{t('care.contractForm.needsOfferAction')}</Link>
              </Button>
            }
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
