'use client';

import { Plus, Trash } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useRef } from 'react';
import {
  RECIPE_LIMITS,
  SUBSTITUTION_POLICIES,
  type CatalogItemType,
  type SubstitutionPolicy,
} from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Badge } from '@/components/ui/badge';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { money } from '@/lib/format';
import { useActionToast } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface RecipeLineView {
  readonly id: string;
  readonly quantity: number;
  readonly name: string;
  readonly variety: string | null;
  readonly type: CatalogItemType;
  readonly unitLabel: string;
  readonly unitCostMinor: number | null;
  readonly archived: boolean;
  readonly outOfStock: boolean;
  readonly updateAction: Action;
  readonly removeAction: Action;
}

export function RecipeLineRow({
  line,
  currency,
  canEdit,
  showCosts,
}: {
  line: RecipeLineView;
  currency: string;
  canEdit: boolean;
  showCosts: boolean;
}) {
  const t = useTranslations('recipe');
  const [updateState, updateFormAction] = useActionState(line.updateAction, idleState);
  const [removeState, removeFormAction] = useActionState(line.removeAction, idleState);
  useActionToast(updateState);
  useActionToast(removeState);
  const lineCost = line.unitCostMinor !== null ? line.unitCostMinor * line.quantity : null;
  const quantityError = fieldError(updateState, 'quantity');

  return (
    <li className="flex flex-wrap items-center gap-3 py-3 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {line.name}
          {line.variety ? (
            <span className="font-normal text-muted-foreground"> · {line.variety}</span>
          ) : null}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{line.unitLabel}</span>
          {line.archived ? <Badge variant="muted">{t('archivedIngredient')}</Badge> : null}
          {line.outOfStock ? <Badge variant="danger">{t('outOfStockIngredient')}</Badge> : null}
          {showCosts && line.unitCostMinor !== null ? (
            <span>
              · {t('unitCost')} {money(line.unitCostMinor, currency)}
            </span>
          ) : null}
        </div>
      </div>
      {canEdit ? (
        <form
          action={updateFormAction}
          onSubmit={preserveOnSubmit(updateFormAction)}
          className="flex items-center gap-2"
        >
          <label htmlFor={`qty-${line.id}`} className="sr-only">
            {t('quantity')}
          </label>
          <Input
            id={`qty-${line.id}`}
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={RECIPE_LIMITS.quantityMax}
            defaultValue={line.quantity}
            aria-invalid={quantityError ? true : undefined}
            className="h-9 w-20 text-right tabular-nums"
          />
          <SubmitButton size="sm" variant="secondary">
            {t('updateQuantity')}
          </SubmitButton>
        </form>
      ) : (
        <span className="w-16 text-right font-medium tabular-nums">× {line.quantity}</span>
      )}
      {showCosts ? (
        <span className="w-24 text-right text-sm tabular-nums">
          {lineCost !== null ? money(lineCost, currency) : <Badge variant="warning">—</Badge>}
        </span>
      ) : null}
      {canEdit ? (
        <form action={removeFormAction}>
          <SubmitButton
            size="icon-sm"
            variant="ghost"
            aria-label={t('removeLine', { name: line.name })}
          >
            <Trash />
          </SubmitButton>
        </form>
      ) : null}
    </li>
  );
}

export interface IngredientChoice {
  readonly id: string;
  readonly label: string;
  readonly groupLabel: string;
}

export function AddIngredientForm({
  action,
  choices,
}: {
  action: Action;
  choices: readonly IngredientChoice[];
}) {
  const t = useTranslations('recipe');
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.status === 'success') formRef.current?.reset();
    return result;
  }, idleState);
  useActionToast(state);

  if (choices.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noIngredients')}</p>;
  }

  const groups = Array.from(new Set(choices.map((choice) => choice.groupLabel)));
  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end"
    >
      <Field
        id="ingredientItemId"
        label={t('ingredient')}
        error={fieldError(state, 'ingredientItemId')}
      >
        <NativeSelect
          {...controlProps('ingredientItemId', fieldError(state, 'ingredientItemId'))}
          name="ingredientItemId"
          defaultValue=""
          required
        >
          <option value="" disabled>
            {t('selectIngredient')}
          </option>
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {choices
                .filter((choice) => choice.groupLabel === group)
                .map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </NativeSelect>
      </Field>
      <Field id="quantity" label={t('quantity')} error={fieldError(state, 'quantity')}>
        <Input
          {...controlProps('quantity', fieldError(state, 'quantity'))}
          name="quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={RECIPE_LIMITS.quantityMax}
          defaultValue={1}
          required
        />
      </Field>
      <SubmitButton>
        <Plus />
        {t('addIngredient')}
      </SubmitButton>
    </form>
  );
}

export function RecipeDetailsForm({
  action,
  defaults,
  showLaborCost,
}: {
  action: Action;
  defaults: {
    laborCost: string;
    styleTags: string;
    notes: string;
    substitutionPolicy: SubstitutionPolicy;
  };
  showLaborCost: boolean;
}) {
  const t = useTranslations('recipe');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);

  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-5 sm:grid-cols-2"
    >
      {showLaborCost ? (
        <Field id="laborCost" label={t('laborCostField')} error={err('laborCost')}>
          <Input
            {...controlProps('laborCost', err('laborCost'))}
            name="laborCost"
            inputMode="decimal"
            defaultValue={defaults.laborCost}
            placeholder="0.00"
          />
        </Field>
      ) : (
        <input type="hidden" name="laborCost" value={defaults.laborCost} />
      )}
      <Field
        id="substitutionPolicy"
        label={t('substitutionPolicy')}
        error={err('substitutionPolicy')}
      >
        <NativeSelect
          {...controlProps('substitutionPolicy', err('substitutionPolicy'))}
          name="substitutionPolicy"
          defaultValue={defaults.substitutionPolicy}
        >
          {SUBSTITUTION_POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {t(`substitution.${policy}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        id="styleTags"
        label={t('styleTags')}
        hint={t('styleTagsHint')}
        error={err('styleTags')}
        className="sm:col-span-2"
      >
        <Input
          {...controlProps('styleTags', err('styleTags'), true)}
          name="styleTags"
          defaultValue={defaults.styleTags}
        />
      </Field>
      <Field id="notes" label={t('notes')} error={err('notes')} className="sm:col-span-2">
        <Textarea
          {...controlProps('notes', err('notes'))}
          name="notes"
          defaultValue={defaults.notes}
          rows={3}
          maxLength={2000}
        />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton variant="secondary">{t('saveDetails')}</SubmitButton>
      </div>
    </form>
  );
}
