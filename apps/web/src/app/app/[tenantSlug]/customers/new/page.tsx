import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { hasPermission } from '@floral/core';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { getTenantContext } from '@/lib/tenant';
import { createCustomerAction } from '../actions';
import { CustomerForm } from '../customer-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('customers.form');
  return { title: t('createTitle') };
}

export default async function NewCustomerPage({
  params,
}: PageProps<'/app/[tenantSlug]/customers/new'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'customers:write')) return <Forbidden />;
  const t = await getTranslations();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/app/${ctx.tenantSlug}/customers`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>
      <PageHeader
        title={t('customers.form.createTitle')}
        description={t('customers.form.createSubtitle')}
      />
      <CustomerForm mode="create" action={createCustomerAction.bind(null, ctx.tenantSlug)} />
    </div>
  );
}
