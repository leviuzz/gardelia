import { AlertTriangle, ArrowLeft, ArrowRight, CalendarX2, Clock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  ConflictError,
  PlanRequiredError,
  ValidationError,
  hasPermission,
  listCareBlocks,
  previewCareBlock,
  type CareBlockChangeDto,
  type CareBlockPreviewDto,
  type CareBlocksDto,
  type TenantContext,
} from '@floral/core';
import { CARE_BLOCK_ACTIONS, CARE_BLOCK_LIMITS, todayInTimeZone, toIsoDate } from '@floral/domain';
import { BlockConfirmForm } from '@/components/care/block-forms';
import { CareUpsell } from '@/components/care/care-upsell';
import { Forbidden } from '@/components/forbidden';
import { Field, controlProps } from '@/components/form/field';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { translateFieldErrors } from '@/lib/actions';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { createCareBlockAction } from '../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.blocks');
  return { title: t('new') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function load(ctx: TenantContext): Promise<CareBlocksDto | null> {
  try {
    return await listCareBlocks(ctx);
  } catch (error) {
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

const choice =
  'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5';

/**
 * "Bloquear días" (ADR-083): il modulo (dal–al, orario o tutto il giorno, nome, cosa fare delle
 * visite) e, con "Ver visitas afectadas", l'anteprima calcolata dal server con le visite toccate,
 * contratto per contratto. Il salvataggio rimanda gli stessi campi con l'impronta del piano: se nel
 * frattempo le visite cambiano, il server chiede di rivedere.
 */
export default async function NewCareBlockPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/agenda/blocks/new'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:write')) return <Forbidden />;
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const query = await searchParams;
  const today = toIsoDate(todayInTimeZone(ctx.timezone));
  const values = {
    startDate: single(query.startDate) ?? today,
    endDate: single(query.endDate) ?? single(query.startDate) ?? today,
    slotId: single(query.slotId) ?? '',
    label: single(query.label) ?? '',
    action: single(query.action) ?? 'MOVE',
  };
  const data = await load(ctx);
  if (data === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title={t('care.blocks.new')} />
        <CareUpsell ctx={ctx} />
      </div>
    );
  }

  let preview: CareBlockPreviewDto | null = null;
  let errors: Record<string, string> = {};
  let conflict: string | null = null;
  if (single(query.preview) === '1') {
    try {
      preview = await previewCareBlock(ctx, values);
    } catch (error) {
      if (error instanceof ValidationError) {
        errors = await translateFieldErrors(error.fieldErrors);
      } else if (error instanceof ConflictError) {
        conflict = t(`care.conflict.${error.reason.replace(/^care_/, '')}`);
      } else {
        throw error;
      }
    }
  }

  // 22/11/2026 è una domenica (0): da lì i nomi dei giorni nella lingua di chi guarda.
  const weekdayName = (value: number) => {
    const name = format.dateTime(new Date(Date.UTC(2026, 10, 22 + value, 12)), {
      weekday: 'long',
      timeZone: 'UTC',
    });
    return name.charAt(0).toLocaleUpperCase() + name.slice(1);
  };
  const day = (iso: string) =>
    format.dateTime(calendarDate(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const when = (value: { date: string; start: string | null; end: string | null }) =>
    value.start && value.end ? `${day(value.date)} · ${value.start}–${value.end}` : day(value.date);
  const outcome = (change: CareBlockChangeDto) =>
    change.outcome === 'MOVED' && change.to
      ? t('care.blocks.movedTo', { when: when(change.to) })
      : change.outcome === 'CANCELLED'
        ? t('care.blocks.cancelledNotCharged')
        : t('care.blocks.toReschedule');
  const touched = preview
    ? preview.counts.moved + preview.counts.toReschedule + preview.counts.cancelled
    : 0;
  const withEmail = preview?.contracts.filter((contract) => contract.hasEmail).length ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={routes.agenda.blocks}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('care.blocks.back')}
      </Link>
      <PageHeader title={t('care.blocks.new')} description={t('care.blocks.newSubtitle')} />

      <Card>
        <CardContent className="pt-6">
          <form method="get" action={routes.agenda.newBlock()} className="grid gap-4">
            <input type="hidden" name="preview" value="1" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="block-start"
                label={t('care.blocks.from')}
                error={errors.startDate}
                required
              >
                <Input
                  {...controlProps('block-start', errors.startDate, true)}
                  name="startDate"
                  type="date"
                  min={today}
                  defaultValue={values.startDate}
                  required
                />
              </Field>
              <Field id="block-end" label={t('care.blocks.until')} error={errors.endDate} required>
                <Input
                  {...controlProps('block-end', errors.endDate, true)}
                  name="endDate"
                  type="date"
                  min={today}
                  defaultValue={values.endDate}
                  required
                />
              </Field>
            </div>
            <Field
              id="block-slot"
              label={t('care.blocks.slot')}
              hint={t('care.blocks.slotHint')}
              error={errors.slotId}
            >
              <NativeSelect
                {...controlProps('block-slot', errors.slotId)}
                name="slotId"
                defaultValue={values.slotId}
              >
                <option value="">{t('care.blocks.wholeDay')}</option>
                {data.slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {t('care.slots.label', {
                      day: weekdayName(slot.weekday),
                      start: slot.start,
                      end: slot.end,
                    })}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              id="block-label"
              label={t('care.blocks.label')}
              hint={t('care.blocks.labelHint')}
              error={errors.label}
              required
            >
              <Input
                {...controlProps('block-label', errors.label, true)}
                name="label"
                maxLength={CARE_BLOCK_LIMITS.label}
                defaultValue={values.label}
                required
              />
            </Field>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">{t('care.blocks.whatToDo')}</legend>
              {CARE_BLOCK_ACTIONS.map((action) => (
                <label key={action} className={choice}>
                  <input
                    type="radio"
                    name="action"
                    value={action}
                    defaultChecked={values.action === action}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>
                    <span className="block font-medium">{t(`care.blocks.actions.${action}`)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`care.blocks.actionHints.${action}`)}
                    </span>
                  </span>
                </label>
              ))}
              {errors.action ? <p className="text-sm text-destructive">{errors.action}</p> : null}
            </fieldset>
            <div>
              <Button
                type="submit"
                variant={preview ? 'outline' : 'default'}
                className="w-full sm:w-auto"
              >
                {t('care.blocks.previewSubmit')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {conflict ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{conflict}</AlertDescription>
        </Alert>
      ) : null}

      {preview ? (
        <Card data-testid="block-preview">
          <CardHeader>
            <CardTitle>{t('care.blocks.previewTitle')}</CardTitle>
            <CardDescription>
              {touched === 0
                ? t('care.blocks.previewNone')
                : t('care.blocks.previewSummary', {
                    moved: preview.counts.moved,
                    toReschedule: preview.counts.toReschedule,
                    cancelled: preview.counts.cancelled,
                    contracts: preview.contracts.length,
                  })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.overlapping.length > 0 ? (
              <Alert>
                <CalendarX2 />
                <AlertDescription>
                  {t('care.blocks.overlapping', {
                    labels: preview.overlapping.map((block) => block.label).join(', '),
                  })}
                </AlertDescription>
              </Alert>
            ) : null}
            {preview.contracts.length > 0 ? (
              <ul className="divide-y rounded-xl border" data-testid="block-affected">
                {preview.contracts.map((contract) => (
                  <li key={contract.subscriptionId} className="space-y-2 p-3">
                    <p className="flex flex-wrap items-center gap-2 font-medium break-words">
                      <span>
                        {contract.numberLabel} · {contract.customerName}
                      </span>
                      {contract.hasEmail ? null : (
                        <Badge variant="muted">{t('care.blocks.noEmail')}</Badge>
                      )}
                    </p>
                    <ul className="space-y-1 text-sm">
                      {contract.changes.map((change) => (
                        <li
                          key={change.visitId}
                          className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                        >
                          <Clock
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="first-letter:uppercase">{when(change.from)}</span>
                          <ArrowRight
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span
                            className={
                              change.outcome === 'MOVED' ? 'font-medium' : 'text-muted-foreground'
                            }
                          >
                            {outcome(change)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t(`care.blocks.futureNote.${preview.action}`)}
            </p>
            <BlockConfirmForm
              action={createCareBlockAction.bind(null, ctx.tenantSlug)}
              fields={{
                startDate: preview.startDate,
                endDate: preview.endDate,
                slotId: preview.slot?.id ?? '',
                label: preview.label,
                action: preview.action,
                plan: preview.plan,
              }}
              touched={touched}
              emailOption={
                preview.emailsAllowed
                  ? { recipients: withEmail, withoutEmail: preview.contracts.length - withEmail }
                  : null
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
