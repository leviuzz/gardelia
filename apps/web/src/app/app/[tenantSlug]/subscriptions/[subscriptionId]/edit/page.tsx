import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  PlanRequiredError,
  getCareContract,
  getCareContractForm,
  hasPermission,
} from '@floral/core';
import { CareContractForm } from '@/components/care/contract-forms';
import { CareUpsell } from '@/components/care/care-upsell';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { phoneForInput } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { updateCareContractDraftAction } from '../../actions';
import { contractFormOptions, siteContactFor } from '../../care-form-data';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.contractForm');
  return { title: t('editTitle') };
}

/** Modifica della bozza: lo stesso modulo della creazione, con i valori salvati. */
export default async function EditCareContractPage({
  params,
}: PageProps<'/app/[tenantSlug]/subscriptions/[subscriptionId]/edit'>) {
  const { tenantSlug, subscriptionId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:write')) return <Forbidden />;
  const t = await getTranslations();
  const routes = tenantRoutes(ctx.tenantSlug);
  let contract;
  try {
    contract = await getCareContract(ctx, subscriptionId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof PlanRequiredError) {
      return (
        <div className="mx-auto max-w-3xl space-y-6">
          <CareUpsell ctx={ctx} />
        </div>
      );
    }
    throw error;
  }
  // Solo la bozza si cambia tutta: un contratto confermato ha i suoi passi nella scheda.
  if (contract.status !== 'DRAFT') redirect(routes.subscriptions.detail(contract.id));
  const form = await getCareContractForm(ctx, contract.customer.id);
  const options = await contractFormOptions(form);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={routes.subscriptions.detail(contract.id)}>
            <ArrowLeft aria-hidden="true" />
            {t('care.contractForm.backToContract', { number: contract.numberLabel })}
          </Link>
        </Button>
        <PageHeader
          title={t('care.contractForm.editTitle')}
          description={t('care.contractForm.newSubtitle', { name: contract.customer.name })}
        />
      </div>
      <CareContractForm
        action={updateCareContractDraftAction.bind(null, ctx.tenantSlug, contract.id)}
        currency={form.currency}
        addresses={options.addresses}
        frequencies={form.frequencies}
        slots={options.slots}
        services={options.services}
        start={{ min: form.startMin, max: form.startMax }}
        submitLabel={t('care.contractForm.save')}
        defaults={{
          customerAddressId: contract.address?.id ?? '',
          frequency: contract.frequency ?? form.frequencies[0] ?? 'MONTHLY_2',
          slotIds: contract.slots.map((slot) => slot.id),
          startDate: contract.startDate < form.startMin ? form.startDefault : contract.startDate,
          seats: contract.seats > 1 ? String(contract.seats) : '',
          serviceIds: contract.services.map((service) => service.serviceId),
          contactName: contract.contactName ?? '',
          contactPhone: phoneForInput(contract.contactPhone),
          useCustomerContact: siteContactFor(form, contract.address?.id ?? null, contract)
            .useCustomerContact,
          accessNotes: contract.accessNotes ?? '',
          notes: contract.notes ?? '',
          outOfRangeConfirmed: contract.outOfRange,
        }}
      />
    </div>
  );
}
