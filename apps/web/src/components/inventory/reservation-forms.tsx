'use client';

import { CalendarClock, PackageCheck, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  INVENTORY_LIMITS,
  RESERVATION_LIMITS,
  missingQuantity,
  parsePackQuantity,
  type SaleUnit,
} from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Un prodotto controllato fra cui scegliere, con quanto è disponibile oggi. */
export interface ReservableProduct {
  readonly id: string;
  readonly label: string;
  readonly groupLabel: string;
  readonly saleUnit: SaleUnit;
  /** Giacenza meno gli altri apartados: può essere negativo. */
  readonly available: number;
}

/** Le date ammesse per la scadenza ("AAAA-MM-GG"): da oggi a 90 giorni, con la proposta. */
export interface ExpiryRange {
  readonly min: string;
  readonly max: string;
  readonly suggested: string;
}

interface LineState {
  readonly key: number;
  readonly inventoryItemId: string;
  readonly quantity: string;
}

/**
 * "Nuevo apartado" (ADR-062): per chi, fino a quando, nota e una riga per prodotto. Mentre si
 * scrive si vede quanto è disponibile e quanto manca; se manca qualcosa il pulsante diventa
 * "Apartar de todos modos", che è la conferma esplicita (il server ricontrolla tutto).
 */
export function ReservationForm({
  action,
  products,
  expiry,
  initialItemId,
}: {
  readonly action: Action;
  readonly products: readonly ReservableProduct[];
  readonly expiry: ExpiryRange;
  readonly initialItemId?: string | undefined;
}) {
  const t = useTranslations('inventory');
  const [state, formAction] = useToastActionState(action);
  const [lines, setLines] = useState<readonly LineState[]>([
    { key: 0, inventoryItemId: initialItemId ?? '', quantity: '' },
  ]);
  const [nextKey, setNextKey] = useState(1);

  const groups = new Map<string, ReservableProduct[]>();
  for (const product of products) {
    groups.set(product.groupLabel, [...(groups.get(product.groupLabel) ?? []), product]);
  }
  // Lo stesso prodotto in più righe si somma, come fa il server.
  const requested = new Map<string, number>();
  for (const line of lines) {
    const quantity = parsePackQuantity(line.quantity);
    if (line.inventoryItemId && quantity !== null && quantity > 0) {
      requested.set(line.inventoryItemId, (requested.get(line.inventoryItemId) ?? 0) + quantity);
    }
  }
  const missingOf = (product: ReservableProduct) =>
    missingQuantity(requested.get(product.id) ?? 0, product.available);
  const shortage = products.some((product) => missingOf(product) > 0);

  function update(key: number, patch: Partial<LineState>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  const errors = {
    label: fieldError(state, 'label'),
    expiresOn: fieldError(state, 'expiresOn'),
    note: fieldError(state, 'note'),
    lines: fieldError(state, 'lines'),
  };

  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="space-y-6">
      <div className="grid gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-2">
        <Field
          id="reservation-label"
          label={t('reservations.form.label')}
          hint={t('reservations.form.labelHint')}
          error={errors.label}
          required
        >
          <Input
            {...controlProps('reservation-label', errors.label, true)}
            name="label"
            maxLength={RESERVATION_LIMITS.label}
            autoComplete="off"
            required
          />
        </Field>
        <Field
          id="reservation-expires"
          label={t('reservations.form.expiresOn')}
          hint={t('reservations.form.expiresOnHint')}
          error={errors.expiresOn}
          required
        >
          <Input
            {...controlProps('reservation-expires', errors.expiresOn, true)}
            type="date"
            name="expiresOn"
            defaultValue={expiry.suggested}
            min={expiry.min}
            max={expiry.max}
            required
          />
        </Field>
        <Field
          id="reservation-note"
          label={t('reservations.form.note')}
          error={errors.note}
          className="sm:col-span-2"
        >
          <Input
            {...controlProps('reservation-note', errors.note)}
            name="note"
            maxLength={RESERVATION_LIMITS.note}
            autoComplete="off"
          />
        </Field>
      </div>

      {errors.lines ? (
        <Alert variant="destructive">
          <AlertDescription>{errors.lines}</AlertDescription>
        </Alert>
      ) : null}

      <ul className="space-y-3">
        {lines.map((line, index) => {
          const product = products.find((option) => option.id === line.inventoryItemId);
          const amount = (count: number) =>
            product ? t('quantity', { unit: product.saleUnit, count }) : String(count);
          const missing = product ? missingOf(product) : 0;
          const ids = {
            product: `reservation-line-${line.key}-product`,
            quantity: `reservation-line-${line.key}-quantity`,
          };
          const lineErrors = {
            product: fieldError(state, `lines.${index}.inventoryItemId`),
            quantity: fieldError(state, `lines.${index}.quantity`),
          };
          const hint = product ? (
            <span className={missing > 0 ? 'font-medium text-[oklch(0.42_0.1_65)]' : undefined}>
              {t('reservations.form.available', {
                quantity: amount(Math.max(product.available, 0)),
              })}
              {missing > 0
                ? ` · ${t('reservations.form.missing', { quantity: amount(missing) })}`
                : ''}
            </span>
          ) : index === 0 ? (
            t('reservations.form.quantityHint')
          ) : undefined;
          return (
            <li
              key={line.key}
              className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-start"
            >
              <Field
                id={ids.product}
                label={t('reservations.form.product')}
                error={lineErrors.product}
              >
                <NativeSelect
                  {...controlProps(ids.product, lineErrors.product)}
                  name={`lines.${index}.inventoryItemId`}
                  value={line.inventoryItemId}
                  onChange={(event) => update(line.key, { inventoryItemId: event.target.value })}
                  required
                >
                  <option value="">{t('reservations.form.choose')}</option>
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
                label={t('reservations.form.quantity')}
                hint={hint}
                error={lineErrors.quantity}
              >
                <Input
                  {...controlProps(ids.quantity, lineErrors.quantity, hint !== undefined)}
                  name={`lines.${index}.quantity`}
                  autoComplete="off"
                  value={line.quantity}
                  onChange={(event) => update(line.key, { quantity: event.target.value })}
                  required
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="sm:mt-7"
                aria-label={t('reservations.form.removeLine')}
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

      <Button
        type="button"
        variant="outline"
        disabled={lines.length >= RESERVATION_LIMITS.lines}
        onClick={() => {
          setLines((current) => [...current, { key: nextKey, inventoryItemId: '', quantity: '' }]);
          setNextKey((key) => key + 1);
        }}
      >
        <Plus />
        {t('reservations.form.addLine')}
      </Button>

      {shortage ? (
        <>
          <Alert variant="warning">
            <AlertDescription>{t('reservations.form.shortage')}</AlertDescription>
          </Alert>
          <input type="hidden" name="confirmShortage" value="on" />
        </>
      ) : null}

      <SubmitButton icon={<CalendarClock />} className="w-full sm:w-auto">
        {shortage ? t('reservations.form.submitShortage') : t('reservations.form.submit')}
      </SubmitButton>
    </form>
  );
}

/** Una riga dell'apartado come la vede "Usar". */
export interface ConsumableLine {
  readonly id: string;
  readonly name: string;
  readonly saleUnit: SaleUnit;
  readonly quantity: number;
  /** Quanto c'è per questo apartado (giacenza meno gli altri apartados). */
  readonly availableForThis: number;
  /** false: il prodotto non si controlla più; la riga non si usa. */
  readonly tracked: boolean;
}

/** Intero scritto nel campo, o null se non è (ancora) un numero intero non negativo. */
function wholeNumber(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * "Usar": quanto si è usato davvero di ogni prodotto (proposta: quanto era apartado). Se non basta
 * la merce compare l'avviso e il pulsante diventa "Registrar de todos modos" (conferma esplicita).
 */
export function ConsumeReservationDialog({
  action,
  label,
  lines,
}: {
  readonly action: Action;
  readonly label: string;
  readonly lines: readonly ConsumableLine[];
}) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const tracked = lines.filter((line) => line.tracked);
  const initial = () => Object.fromEntries(tracked.map((line) => [line.id, String(line.quantity)]));
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Readonly<Record<string, string>>>(initial);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const missingOf = (line: ConsumableLine) =>
    missingQuantity(wholeNumber(quantities[line.id] ?? '') ?? 0, line.availableForThis);
  const shortage = tracked.some((line) => missingOf(line) > 0);
  const linesError = fieldError(state, 'lines');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuantities(initial());
      }}
    >
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto">
          <PackageCheck />
          {t('reservations.actions.use')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('reservations.actions.useTitle', { label })}</DialogTitle>
          <DialogDescription>{t('reservations.actions.useBody')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          {linesError ? (
            <Alert variant="destructive">
              <AlertDescription>{linesError}</AlertDescription>
            </Alert>
          ) : null}
          {tracked.map((line, index) => {
            const id = `consume-line-${line.id}`;
            const error = fieldError(state, `lines.${index}.quantity`);
            const missing = missingOf(line);
            const amount = (count: number) => t('quantity', { unit: line.saleUnit, count });
            return (
              <Field
                key={line.id}
                id={id}
                label={`${line.name} (${t(`unitName.${line.saleUnit}`)})`}
                error={error}
                hint={
                  missing > 0 ? (
                    <span className="font-medium text-[oklch(0.42_0.1_65)]">
                      {t('reservations.form.missing', { quantity: amount(missing) })}
                    </span>
                  ) : (
                    t('reservations.form.available', {
                      quantity: amount(Math.max(line.availableForThis, 0)),
                    })
                  )
                }
              >
                <input type="hidden" name={`lines.${index}.lineId`} value={line.id} />
                <Input
                  {...controlProps(id, error, true)}
                  name={`lines.${index}.quantity`}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={String(INVENTORY_LIMITS.quantity).length}
                  value={quantities[line.id] ?? ''}
                  onChange={(event) =>
                    setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                  }
                  required
                />
              </Field>
            );
          })}
          {shortage ? (
            <>
              <Alert variant="warning">
                <AlertDescription>{t('reservations.actions.useShortage')}</AlertDescription>
              </Alert>
              <input type="hidden" name="confirmShortage" value="on" />
            </>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">
              {shortage
                ? t('reservations.actions.useSubmitShortage')
                : t('reservations.actions.useSubmit')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Extender": nuova scadenza, da oggi a 90 giorni. */
export function ExtendReservationDialog({
  action,
  label,
  expiry,
  current,
}: {
  readonly action: Action;
  readonly label: string;
  readonly expiry: ExpiryRange;
  /** Scadenza proposta: quella di adesso, o la proposta se è già passata. */
  readonly current: string;
}) {
  const t = useTranslations('inventory.reservations');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const error = fieldError(state, 'expiresOn');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <CalendarClock />
          {t('actions.extend')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('actions.extendTitle', { label })}</DialogTitle>
          <DialogDescription>{t('actions.extendBody')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <Field id="extend-expires" label={t('form.expiresOn')} error={error} required>
            <Input
              {...controlProps('extend-expires', error)}
              type="date"
              name="expiresOn"
              defaultValue={current}
              min={expiry.min}
              max={expiry.max}
              required
            />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{t('actions.extendSubmit')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
