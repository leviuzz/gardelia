'use client';

import { Check, CheckCheck, Download, Plus, Trash, TriangleExclamationPoint } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export type LineWarning = 'LIMITED' | 'ON_REQUEST' | 'UNAVAILABLE';

export interface QuoteLineView {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  /** Prezzo unitario già formattato (es. "$45.00 por tallo"). */
  readonly unitPriceLabel: string;
  readonly lineTotalLabel: string;
  readonly recipeSummary: string | null;
  readonly warning: LineWarning | null;
  /** Righe del Builder: link al disegno di origine. */
  readonly designHref: string | null;
  /** Righe del Builder: immagine del ramo agganciata alla riga (ADR-035). */
  readonly image: {
    readonly url: string;
    readonly downloadUrl: string;
    readonly verified: boolean;
    readonly simulated: boolean;
  } | null;
  readonly updateAction?: Action;
  readonly removeAction?: Action;
}

export type QuotableGroup = 'BOUQUET' | 'INGREDIENTS' | 'OTHER';

export interface QuotableOptionView {
  readonly id: string;
  readonly label: string;
  readonly group: QuotableGroup;
}

const GROUPS: readonly QuotableGroup[] = ['BOUQUET', 'INGREDIENTS', 'OTHER'];

function QuantityForm({
  action,
  lineId,
  quantity,
  label,
}: {
  action: Action;
  lineId: string;
  quantity: number;
  label: string;
}) {
  const t = useTranslations('quotes.editor');
  const [state, formAction] = useToastActionState(action);
  const inputId = `qty-${lineId}`;
  const err = fieldError(state, 'quantity');
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-1">
      <div className="flex items-center gap-1.5">
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <Input
          {...controlProps(inputId, err)}
          name="quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={999}
          defaultValue={quantity}
          required
          className="h-9 w-20"
        />
        <SubmitButton size="icon-sm" variant="outline" aria-label={t('update')}>
          <Check />
        </SubmitButton>
      </div>
      {err ? (
        <p id={`${inputId}-error`} className="text-sm text-destructive">
          {err}
        </p>
      ) : null}
    </form>
  );
}

function RemoveLineButton({ action, label }: { action: Action; label: string }) {
  const [, formAction] = useToastActionState(action);
  return (
    <form action={formAction}>
      <SubmitButton size="icon-sm" variant="ghost" aria-label={label}>
        <Trash />
      </SubmitButton>
    </form>
  );
}

export function QuoteLineList({
  lines,
  editable,
}: {
  lines: readonly QuoteLineView[];
  editable: boolean;
}) {
  const t = useTranslations('quotes.editor');
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{editable ? t('emptyLines') : t('noLines')}</p>
    );
  }
  return (
    <ul className="divide-y">
      {lines.map((line) => (
        <li key={line.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="font-medium break-words">{line.description}</p>
              {line.designHref ? (
                <p className="flex flex-wrap items-center gap-2">
                  <Badge variant="accent">{t('builderLine')}</Badge>
                  <Link
                    href={line.designHref}
                    className="text-sm font-medium text-primary hover:underline print:hidden"
                  >
                    {t('viewDesign')}
                  </Link>
                </p>
              ) : null}
              {line.recipeSummary ? (
                <p className="text-sm text-muted-foreground">
                  {t('recipeOf')} {line.recipeSummary}
                </p>
              ) : null}
              {line.warning ? (
                <Badge variant={line.warning === 'UNAVAILABLE' ? 'danger' : 'warning'}>
                  <TriangleExclamationPoint aria-hidden="true" />
                  {t(`availabilityWarning.${line.warning}`)}
                </Badge>
              ) : null}
              {line.image ? (
                <figure className="flex break-inside-avoid flex-col items-start gap-2 pt-1 sm:flex-row sm:gap-3 print:flex-row">
                  {/* eslint-disable-next-line @next/next/no-img-element -- immagine privata servita da una route autenticata */}
                  <img
                    src={line.image.url}
                    alt={t('bouquetImageAlt', { name: line.description })}
                    className="size-28 shrink-0 rounded-xl border bg-muted object-cover sm:size-36 print:size-56"
                  />
                  <figcaption className="min-w-0 space-y-1.5 text-xs text-muted-foreground">
                    <span className="flex flex-wrap gap-1.5">
                      {line.image.simulated ? (
                        <Badge variant="warning">{t('imageSimulated')}</Badge>
                      ) : null}
                      {line.image.verified ? (
                        <Badge variant="success" className="h-auto text-left whitespace-normal">
                          <CheckCheck aria-hidden="true" />
                          {t('imageVerified')}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="block">
                      {line.image.verified ? t('imageNoteVerified') : t('imageNote')}
                    </span>
                    <a
                      href={line.image.downloadUrl}
                      download
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline print:hidden"
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                      {t('downloadImage')}
                    </a>
                  </figcaption>
                </figure>
              ) : null}
            </div>
            <p className="shrink-0 font-semibold tabular-nums">{line.lineTotalLabel}</p>
          </div>
          {editable && line.updateAction && line.removeAction ? (
            <div className="flex items-start gap-2 print:hidden">
              <QuantityForm
                key={`${line.id}-${line.quantity}`}
                action={line.updateAction}
                lineId={line.id}
                quantity={line.quantity}
                label={t('quantityOf', { name: line.description })}
              />
              <span className="pt-2 text-sm text-muted-foreground tabular-nums">
                × {line.unitPriceLabel}
              </span>
              <div className="ml-auto">
                <RemoveLineButton
                  action={line.removeAction}
                  label={t('remove', { name: line.description })}
                />
              </div>
            </div>
          ) : null}
          <p
            className={
              editable
                ? 'hidden text-sm text-muted-foreground tabular-nums print:block'
                : 'text-sm text-muted-foreground tabular-nums'
            }
          >
            {line.quantity} × {line.unitPriceLabel}
          </p>
        </li>
      ))}
    </ul>
  );
}

function AddCatalogLineForm({
  action,
  options,
}: {
  action: Action;
  options: readonly QuotableOptionView[];
}) {
  const t = useTranslations('quotes.editor');
  // Dopo un'aggiunta riuscita si rimonta il form per tornare ai valori iniziali.
  const [formKey, setFormKey] = useState(0);
  const [state, formAction] = useToastActionState(action, () => setFormKey((key) => key + 1));
  const err = (field: string) => fieldError(state, field);

  return (
    <form
      key={formKey}
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_auto] sm:items-start"
    >
      <Field id="add-item" label={t('product')} error={err('catalogItemId')} required>
        <NativeSelect
          {...controlProps('add-item', err('catalogItemId'))}
          name="catalogItemId"
          defaultValue=""
          required
        >
          <option value="" disabled>
            {t('chooseProduct')}
          </option>
          {GROUPS.map((group) => {
            const groupOptions = options.filter((option) => option.group === group);
            if (groupOptions.length === 0) return null;
            return (
              <optgroup key={group} label={t(`groups.${group}`)}>
                {groupOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </NativeSelect>
      </Field>
      <Field id="add-qty" label={t('quantity')} error={err('quantity')} required>
        <Input
          {...controlProps('add-qty', err('quantity'))}
          name="quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={999}
          defaultValue={1}
          required
        />
      </Field>
      <div className="sm:pt-7">
        <SubmitButton className="w-full sm:w-auto">
          <Plus />
          {t('add')}
        </SubmitButton>
      </div>
    </form>
  );
}

function AddCustomLineForm({
  action,
  currency,
  onDone,
}: {
  action: Action;
  currency: string;
  onDone: () => void;
}) {
  const t = useTranslations('quotes.editor');
  const tc = useTranslations('common');
  const [state, formAction] = useToastActionState(action, onDone);
  const err = (field: string) => fieldError(state, field);

  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-[minmax(0,1fr)_6rem_9rem]"
    >
      <Field
        id="custom-description"
        label={t('customDescription')}
        error={err('description')}
        required
      >
        <Input
          {...controlProps('custom-description', err('description'))}
          name="description"
          placeholder={t('customDescriptionPlaceholder')}
          maxLength={160}
          required
        />
      </Field>
      <Field id="custom-qty" label={t('quantity')} error={err('quantity')} required>
        <Input
          {...controlProps('custom-qty', err('quantity'))}
          name="quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={999}
          defaultValue={1}
          required
        />
      </Field>
      <Field
        id="custom-price"
        label={t('unitPrice', { currency })}
        error={err('unitPrice')}
        required
      >
        <Input
          {...controlProps('custom-price', err('unitPrice'))}
          name="unitPrice"
          inputMode="decimal"
          autoComplete="off"
          required
        />
      </Field>
      <div className="flex gap-2 sm:col-span-3">
        <SubmitButton size="sm">{t('add')}</SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}

export function QuoteLineComposer({
  addCatalogAction,
  addCustomAction,
  options,
  currency,
  catalogHref,
}: {
  addCatalogAction: Action;
  addCustomAction: Action;
  options: readonly QuotableOptionView[];
  currency: string;
  catalogHref: string;
}) {
  const t = useTranslations('quotes.editor');
  const [customOpen, setCustomOpen] = useState(false);
  return (
    <div className="space-y-4 border-t pt-5 print:hidden">
      <h3 className="text-sm font-semibold">{t('addFromCatalog')}</h3>
      {options.length > 0 ? (
        <AddCatalogLineForm action={addCatalogAction} options={options} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('noQuotableItems')}{' '}
          <Link href={catalogHref} className="font-medium text-primary hover:underline">
            {t('goToCatalog')}
          </Link>
        </p>
      )}
      {customOpen ? (
        <AddCustomLineForm
          action={addCustomAction}
          currency={currency}
          onDone={() => setCustomOpen(false)}
        />
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setCustomOpen(true)}>
          <Plus />
          {t('addCustom')}
        </Button>
      )}
    </div>
  );
}
