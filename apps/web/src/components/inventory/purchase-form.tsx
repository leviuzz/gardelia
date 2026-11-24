'use client';

import { Plus, ShoppingBasket, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  PURCHASE_LIMITS,
  formatMoney,
  parseMoneyInput,
  parsePackQuantity,
  type CurrencyCode,
} from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Un prodotto controllato fra cui scegliere, con le etichette già tradotte. */
export interface PurchaseProductOption {
  readonly id: string;
  readonly label: string;
  readonly groupLabel: string;
  /** Unità al singolare per "13,00 por tallo". */
  readonly unitLabel: string;
}

export interface SupplierOption {
  readonly id: string;
  readonly name: string;
}

interface LineState {
  readonly key: number;
  readonly inventoryItemId: string;
  readonly quantity: string;
  readonly total: string;
}

const NEW_SUPPLIER = '__new__';

/**
 * "Nueva compra" (ADR-061): proveedor (esistente, nuovo o nessuno), data, nota e una riga per
 * prodotto con quantità ("100" o "4x25") e totale pagato. Costo per unità e totale della compra si
 * vedono mentre si scrive; il server ricalcola tutto.
 */
export function PurchaseForm({
  action,
  products,
  suppliers,
  today,
  currency,
  locale,
  initialSupplierId = '',
  initialProductIds = [],
}: {
  readonly action: Action;
  readonly products: readonly PurchaseProductOption[];
  readonly suppliers: readonly SupplierOption[];
  readonly today: string;
  readonly currency: CurrencyCode;
  readonly locale: string;
  /** Da "Por pedir" (ADR-081): il proveedor e i prodotti da comprare, già scelti. */
  readonly initialSupplierId?: string;
  readonly initialProductIds?: readonly string[];
}) {
  const t = useTranslations('inventory.purchases.form');
  const [state, formAction] = useToastActionState(action);
  const [supplier, setSupplier] = useState(
    suppliers.some((option) => option.id === initialSupplierId) ? initialSupplierId : '',
  );
  const [lines, setLines] = useState<readonly LineState[]>(() => {
    const known = initialProductIds.filter((id) => products.some((option) => option.id === id));
    return known.length > 0
      ? known.map((id, index) => ({ key: index, inventoryItemId: id, quantity: '', total: '' }))
      : [{ key: 0, inventoryItemId: '', quantity: '', total: '' }];
  });
  const [nextKey, setNextKey] = useState(() => Math.max(lines.length, 1));

  const groups = new Map<string, PurchaseProductOption[]>();
  for (const product of products) {
    groups.set(product.groupLabel, [...(groups.get(product.groupLabel) ?? []), product]);
  }
  const amount = (minor: number) => formatMoney(minor, currency, locale);
  const totals = lines.map((line) => {
    const parsed = parseMoneyInput(line.total, currency);
    return parsed.ok ? parsed.minor : null;
  });
  const purchaseTotal = totals.reduce<number>((sum, value) => sum + (value ?? 0), 0);

  function update(key: number, patch: Partial<LineState>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  const supplierError = fieldError(state, 'supplierId');
  const newSupplierError = fieldError(state, 'newSupplierName');
  const dateError = fieldError(state, 'purchasedOn');
  const referenceError = fieldError(state, 'reference');
  const linesError = fieldError(state, 'lines');

  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="space-y-6">
      <div className="grid gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-2">
        <Field id="purchase-supplier" label={t('supplier')} error={supplierError}>
          <NativeSelect
            {...controlProps('purchase-supplier', supplierError)}
            value={supplier}
            onChange={(event) => setSupplier(event.target.value)}
          >
            <option value="">{t('supplierNone')}</option>
            {suppliers.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
            <option value={NEW_SUPPLIER}>{t('supplierNew')}</option>
          </NativeSelect>
        </Field>
        <input type="hidden" name="supplierId" value={supplier === NEW_SUPPLIER ? '' : supplier} />
        {supplier === NEW_SUPPLIER ? (
          <Field id="purchase-new-supplier" label={t('newSupplierName')} error={newSupplierError}>
            <Input
              {...controlProps('purchase-new-supplier', newSupplierError)}
              name="newSupplierName"
              maxLength={PURCHASE_LIMITS.supplierName}
              autoComplete="off"
              required
            />
          </Field>
        ) : null}
        <Field id="purchase-date" label={t('date')} error={dateError}>
          <Input
            {...controlProps('purchase-date', dateError)}
            type="date"
            name="purchasedOn"
            defaultValue={today}
            max={today}
          />
        </Field>
        <Field
          id="purchase-reference"
          label={t('reference')}
          hint={t('referenceHint')}
          error={referenceError}
        >
          <Input
            {...controlProps('purchase-reference', referenceError, true)}
            name="reference"
            maxLength={PURCHASE_LIMITS.reference}
            autoComplete="off"
          />
        </Field>
      </div>

      {linesError ? (
        <Alert variant="destructive">
          <AlertDescription>{linesError}</AlertDescription>
        </Alert>
      ) : null}

      <ul className="space-y-3">
        {lines.map((line, index) => {
          const product = products.find((option) => option.id === line.inventoryItemId);
          const quantity = parsePackQuantity(line.quantity);
          const total = totals[index] ?? null;
          const unitCost =
            product && quantity && quantity > 0 && total !== null
              ? t('unitCost', {
                  amount: amount(Math.round(total / quantity)),
                  unit: product.unitLabel,
                })
              : null;
          const ids = {
            product: `line-${line.key}-product`,
            quantity: `line-${line.key}-quantity`,
            total: `line-${line.key}-total`,
          };
          const errors = {
            product: fieldError(state, `lines.${index}.inventoryItemId`),
            quantity: fieldError(state, `lines.${index}.quantity`),
            total: fieldError(state, `lines.${index}.total`),
          };
          return (
            <li
              key={line.key}
              className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start"
            >
              <Field id={ids.product} label={t('product')} error={errors.product}>
                <NativeSelect
                  {...controlProps(ids.product, errors.product)}
                  name={`lines.${index}.inventoryItemId`}
                  value={line.inventoryItemId}
                  onChange={(event) => update(line.key, { inventoryItemId: event.target.value })}
                  required
                >
                  <option value="">{t('choose')}</option>
                  {[...groups].map(([group, options]) => (
                    <optgroup key={group} label={group}>
                      {options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                id={ids.quantity}
                label={t('quantity')}
                hint={index === 0 ? t('quantityHint') : undefined}
                error={errors.quantity}
              >
                <Input
                  {...controlProps(ids.quantity, errors.quantity, index === 0)}
                  name={`lines.${index}.quantity`}
                  autoComplete="off"
                  value={line.quantity}
                  onChange={(event) => update(line.key, { quantity: event.target.value })}
                  required
                />
              </Field>
              <Field
                id={ids.total}
                label={t('total')}
                hint={unitCost ?? undefined}
                error={errors.total}
              >
                <Input
                  {...controlProps(ids.total, errors.total, unitCost !== null)}
                  name={`lines.${index}.total`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={line.total}
                  onChange={(event) => update(line.key, { total: event.target.value })}
                  required
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="sm:mt-7"
                aria-label={t('removeLine')}
                disabled={lines.length === 1}
                onClick={() =>
                  setLines((current) => current.filter((item) => item.key !== line.key))
                }
              >
                <Trash2 />
              </Button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={lines.length >= PURCHASE_LIMITS.lines}
          onClick={() => {
            setLines((current) => [
              ...current,
              { key: nextKey, inventoryItemId: '', quantity: '', total: '' },
            ]);
            setNextKey((key) => key + 1);
          }}
        >
          <Plus />
          {t('addLine')}
        </Button>
        <p className="text-sm font-medium tabular-nums" aria-live="polite">
          {t('purchaseTotal', { amount: amount(purchaseTotal) })}
        </p>
      </div>

      <SubmitButton icon={<ShoppingBasket />} className="w-full sm:w-auto">
        {t('submit')}
      </SubmitButton>
    </form>
  );
}
