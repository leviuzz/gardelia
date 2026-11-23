import { Archive, ArchiveRestore, ArrowLeft, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getEntitlements, hasPermission, listSuppliers } from '@floral/core';
import { ActionButton } from '@/components/form/action-button';
import { Forbidden } from '@/components/forbidden';
import { InventoryUpsell } from '@/components/inventory/inventory-upsell';
import { SupplierAddForm, SupplierEditDialog } from '@/components/inventory/supplier-forms';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { phoneForInput } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { createSupplierAction, setSupplierArchivedAction, updateSupplierAction } from '../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('inventory.suppliers');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Proveedores (ADR-061): si aggiungono, si modificano e si archiviano; mai cancellati. */
export default async function SuppliersPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/inventory/suppliers'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'inventory:write')) return <Forbidden />;
  const t = await getTranslations('inventory.suppliers');
  const routes = tenantRoutes(ctx.tenantSlug);
  const slug = ctx.tenantSlug;
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={routes.inventory.purchases()}>
        <ArrowLeft aria-hidden="true" />
        {t('back')}
      </Link>
    </Button>
  );
  if (!(await getEntitlements(ctx)).inventory) {
    return (
      <div className="space-y-6">
        {back}
        <InventoryUpsell ctx={ctx} />
      </div>
    );
  }
  const showArchived = single((await searchParams).archived) === '1';
  const suppliers = await listSuppliers(ctx, { includeArchived: showArchived });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3">
        {back}
        <PageHeader title={t('title')} description={t('subtitle')} />
      </div>
      <SupplierAddForm action={createSupplierAction.bind(null, slug)} />
      {suppliers.length === 0 ? (
        <EmptyState icon={<Truck />} title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {suppliers.map((supplier) => (
            <li
              key={supplier.id}
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {supplier.name}
                  {supplier.status === 'ARCHIVED' ? (
                    <Badge variant="muted">{t('archived')}</Badge>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('purchases', { count: supplier.purchases })}
                  {supplier.phone ? ` · ${phoneForInput(supplier.phone)}` : ''}
                  {supplier.notes ? ` · ${supplier.notes}` : ''}
                </p>
              </div>
              <div className="flex gap-1">
                <SupplierEditDialog
                  action={updateSupplierAction.bind(null, slug, supplier.id)}
                  values={{
                    name: supplier.name,
                    phone: phoneForInput(supplier.phone),
                    notes: supplier.notes ?? '',
                  }}
                />
                <ActionButton
                  action={setSupplierArchivedAction.bind(
                    null,
                    slug,
                    supplier.id,
                    supplier.status === 'ACTIVE',
                  )}
                  variant="ghost"
                  size="sm"
                  icon={supplier.status === 'ACTIVE' ? <Archive /> : <ArchiveRestore />}
                >
                  {supplier.status === 'ACTIVE' ? t('archive') : t('restore')}
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Link
        href={routes.inventory.suppliers({ archived: !showArchived })}
        className="inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {showArchived ? t('hideArchived') : t('showArchived')}
      </Link>
    </div>
  );
}
