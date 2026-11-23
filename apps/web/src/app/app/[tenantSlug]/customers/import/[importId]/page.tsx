import { ArrowLeft, CircleCheck, FileX, ShieldCheck, Upload } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  getCustomerImport,
  hasPermission,
  type CustomerImportPreview,
  type CustomerImportProblem,
  type TenantContext,
} from '@floral/core';
import { CUSTOMER_IMPORT_FIELDS } from '@floral/domain';
import { CustomerImportMappingForm } from '@/components/customers/customer-import-forms';
import { Forbidden } from '@/components/forbidden';
import { ActionButton } from '@/components/form/action-button';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { translateFieldErrors } from '@/lib/actions';
import { phoneForInput } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import {
  cancelCustomerImportAction,
  confirmCustomerImportAction,
  updateCustomerImportMappingAction,
} from '../../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('customers.import');
  return { title: t('previewTitle') };
}

async function loadImport(ctx: TenantContext, importId: string): Promise<CustomerImportPreview> {
  try {
    return await getCustomerImport(ctx, importId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/**
 * Anteprima di un import di clienti (ADR-070): colonne riconosciute e correggibili, conti delle
 * righe pronte, non valide e duplicate, le righe con problemi e qualche esempio; poi "Importar".
 * Concluso, la stessa pagina mostra il risultato.
 */
export default async function CustomerImportDetailPage({
  params,
}: PageProps<'/app/[tenantSlug]/customers/import/[importId]'>) {
  const { tenantSlug, importId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'customers:write')) return <Forbidden />;
  const data = await loadImport(ctx, importId);
  const t = await getTranslations('customers.import');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);

  const back = (
    <Link
      href={routes.customers.import.new}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {t('backToImport')}
    </Link>
  );

  if (data.status === 'CANCELLED') {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {back}
        <EmptyState
          icon={<FileX />}
          title={t('cancelledTitle')}
          body={t('cancelledBody', { name: data.fileName })}
          action={
            <Button asChild>
              <Link href={routes.customers.import.new}>{t('startAgain')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (data.status === 'DONE') {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title={t('doneTitle')}
          description={t('doneSubtitle', {
            name: data.fileName,
            date: format.dateTime(data.completedAt ?? data.createdAt, {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: ctx.timezone,
            }),
          })}
        />
        <Alert variant="success">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>
            {t('doneBody', { imported: data.importedCount, skipped: data.skippedCount })}
          </AlertDescription>
        </Alert>
        <Alert>
          <ShieldCheck aria-hidden="true" />
          <AlertDescription>{t('consentNote')}</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={routes.customers.list()}>{t('seeCustomers')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={routes.customers.import.new}>{t('importAnother')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Codici di validazione → testi (anche quelli del modulo clienti, `customers_import_*`).
  const mappingErrors = await translateFieldErrors(data.mappingErrors ?? {});
  const problemErrors = await Promise.all(
    data.problems.map((problem) =>
      problem.errors ? translateFieldErrors(problem.errors) : Promise.resolve(null),
    ),
  );

  /** "Teléfono: …" per ogni campo con un errore. */
  function describeErrors(errors: Readonly<Record<string, string>>): string[] {
    return Object.entries(errors).map(([key, text]) => {
      const field = key.split('.')[0] ?? key;
      const label = (CUSTOMER_IMPORT_FIELDS as readonly string[]).includes(field)
        ? t(`fields.${field}`)
        : field;
      return `${label}: ${text}`;
    });
  }

  function describeProblem(problem: CustomerImportProblem, index: number) {
    const errors = problemErrors[index];
    if (errors) return { reasons: describeErrors(errors), link: null };
    const duplicate = problem.duplicate;
    if (duplicate?.reason === 'existing') {
      return {
        reasons: [t('duplicateExisting', { name: duplicate.customerName })],
        link: routes.customers.detail(duplicate.customerId),
      };
    }
    if (duplicate?.reason === 'file') {
      return { reasons: [t('duplicateInFile', { line: duplicate.firstLine })], link: null };
    }
    return { reasons: [], link: null };
  }

  const ready = data.summary?.ready ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {back}
      <PageHeader
        title={t('previewTitle')}
        description={t('previewSubtitle', { name: data.fileName, rows: data.rowCount })}
      />

      {data.summary ? (
        <dl className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['ready', data.summary.ready],
              ['invalid', data.summary.invalid],
              ['duplicates', data.summary.duplicates],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="rounded-2xl border bg-card p-4">
              <dt className="text-sm text-muted-foreground">{t(`summary.${key}`)}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <section aria-labelledby="import-columns" className="space-y-3">
        <div>
          <h2 id="import-columns" className="text-lg font-semibold">
            {t('columnsTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('columnsBody')}</p>
        </div>
        <CustomerImportMappingForm
          action={updateCustomerImportMappingAction.bind(null, ctx.tenantSlug, data.id)}
          columns={data.columns}
          initialErrors={mappingErrors}
        />
      </section>

      {data.problems.length > 0 ? (
        <section aria-labelledby="import-problems" className="space-y-3">
          <div>
            <h2 id="import-problems" className="text-lg font-semibold">
              {t('problemsTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('problemsBody')}</p>
          </div>
          <ul className="divide-y rounded-2xl border bg-card">
            {data.problems.map((problem, index) => {
              const { reasons, link } = describeProblem(problem, index);
              return (
                <li key={problem.line} className="space-y-1 p-4 text-sm">
                  <p className="font-medium break-words">
                    {t('line', { line: problem.line })} · {problem.displayName || t('noName')}
                  </p>
                  {reasons.map((reason) =>
                    link ? (
                      <Link
                        key={reason}
                        href={link}
                        className="block break-words text-primary hover:underline"
                      >
                        {reason}
                      </Link>
                    ) : (
                      <p key={reason} className="break-words text-muted-foreground">
                        {reason}
                      </p>
                    ),
                  )}
                </li>
              );
            })}
          </ul>
          {data.summary && data.problems.length < data.summary.invalid + data.summary.duplicates ? (
            <p className="text-sm text-muted-foreground">
              {t('moreProblems', {
                count: data.summary.invalid + data.summary.duplicates - data.problems.length,
              })}
            </p>
          ) : null}
        </section>
      ) : null}

      {data.samples.length > 0 ? (
        <section aria-labelledby="import-samples" className="space-y-3">
          <h2 id="import-samples" className="text-lg font-semibold">
            {t('samplesTitle')}
          </h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {data.samples.map((sample) => (
              <li key={sample.line} className="space-y-1 p-4 text-sm">
                <p className="font-medium break-words">{sample.displayName}</p>
                {sample.phone || sample.email ? (
                  <p className="break-words text-muted-foreground">
                    {[phoneForInput(sample.phone), sample.email].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
                {sample.tags.length > 0 || sample.occasions > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {sample.tags.map((tag) => (
                      <Badge key={tag} variant="muted">
                        {tag}
                      </Badge>
                    ))}
                    {sample.occasions > 0 ? (
                      <Badge variant="outline">
                        {t('sampleDates', { count: sample.occasions })}
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Alert>
        <ShieldCheck aria-hidden="true" />
        <AlertDescription>{t('consentNote')}</AlertDescription>
      </Alert>

      {data.summary && ready === 0 ? (
        <p className="text-sm text-muted-foreground">{t('nothingToImport')}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          action={confirmCustomerImportAction.bind(null, ctx.tenantSlug, data.id)}
          icon={<Upload />}
          pendingLabel={t('importing')}
          disabled={ready === 0}
        >
          {t('confirm', { count: ready })}
        </ActionButton>
        <ActionButton
          action={cancelCustomerImportAction.bind(null, ctx.tenantSlug, data.id)}
          variant="ghost"
        >
          {t('cancel')}
        </ActionButton>
      </div>
    </div>
  );
}
