import { ArrowLeft, Download, FileClock, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { findOpenCustomerImport, hasPermission } from '@floral/core';
import {
  CUSTOMER_IMPORT_FIELDS,
  CUSTOMER_IMPORT_LIMITS,
  customerImportTemplate,
  type CustomerImportField,
} from '@floral/domain';
import { CustomerImportUploadForm } from '@/components/customers/customer-import-forms';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { createCustomerImportAction } from '../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('customers.import');
  return { title: t('title') };
}

/**
 * "Importar clientes" (CRM-01, ADR-070 blocco 3): come preparare il file, il modello da scaricare
 * nella lingua di chi lo usa e il caricamento. L'anteprima è la pagina successiva.
 */
export default async function CustomerImportPage({
  params,
}: PageProps<'/app/[tenantSlug]/customers/import'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'customers:write')) return <Forbidden />;
  const t = await getTranslations('customers.import');
  const tc = await getTranslations('common');
  const routes = tenantRoutes(ctx.tenantSlug);
  const open = await findOpenCustomerImport(ctx);

  const headers = Object.fromEntries(
    CUSTOMER_IMPORT_FIELDS.map((field) => [field, t(`fields.${field}`)]),
  ) as Record<CustomerImportField, string>;
  const template = customerImportTemplate(headers);
  // Con il BOM, Excel apre il modello in UTF-8 (accenti e ñ corretti).
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${template}`)}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={routes.customers.list()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {tc('back')}
      </Link>
      <PageHeader title={t('title')} description={t('subtitle')} />

      {open ? (
        <Alert>
          <FileClock aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('openDraft', { name: open.fileName })}</span>
            <Link
              href={routes.customers.import.detail(open.id)}
              className="font-medium text-primary hover:underline"
            >
              {t('continueDraft')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('prepareTitle')}</CardTitle>
          <CardDescription>{t('prepareBody')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>{t('ruleColumns')}</li>
            <li>{t('ruleDates')}</li>
            <li>{t('ruleDuplicates')}</li>
            <li>
              {t('ruleLimits', {
                rows: CUSTOMER_IMPORT_LIMITS.rows,
                kb: Math.round(CUSTOMER_IMPORT_LIMITS.bytes / 1024),
              })}
            </li>
          </ul>
          <Button asChild variant="outline">
            <a href={templateHref} download={t('templateFileName')}>
              <Download />
              {t('downloadTemplate')}
            </a>
          </Button>
        </CardContent>
      </Card>

      <Alert>
        <ShieldCheck aria-hidden="true" />
        <AlertDescription>{t('consentNote')}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{t('uploadTitle')}</CardTitle>
          <CardDescription>{t('uploadBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <CustomerImportUploadForm
            action={createCustomerImportAction.bind(null, ctx.tenantSlug)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
