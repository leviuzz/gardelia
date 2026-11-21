'use client';

import {
  FileText,
  LoaderCircle,
  Minus,
  Plus,
  Search,
  Trash,
  TriangleExclamationPoint,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useState } from 'react';
import {
  BUILDER_LIMITS,
  BUILDER_SIZES,
  BUILDER_STYLES,
  checkComposition,
  isCurrencyCode,
  parseMoneyInput,
  priceBouquet,
  type Availability,
  type BuilderRole,
  type CatalogColor,
} from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { COLOR_SWATCH_CLASS } from '@/lib/catalog-ui';
import { money } from '@/lib/format';
import { useActionToast } from '@/lib/use-action-toast';
import { cn } from '@/lib/utils';
import { PreviewPanel, type PreviewPanelData } from './preview-panel';

export interface BuilderColorView {
  readonly value: string;
  /** Nome del colore già tradotto ("Lila"). */
  readonly label: string;
  /** Miniatura della foto di quel colore, se il fiorista l'ha caricata. */
  readonly photoSrc: string | null;
}

export interface BuilderOptionView {
  readonly id: string;
  readonly name: string;
  readonly role: BuilderRole;
  readonly priceMinor: number;
  readonly costMinor: number | null;
  readonly availability: Availability;
  /** Unità di vendita già tradotta ("tallo", "manojo", "pieza"). */
  readonly unitLabel: string;
  /** Colori dell'articolo; per carta, vaso e nastro si sceglie quello del ramo (ADR-030). */
  readonly colors: readonly BuilderColorView[];
}

/** Riga salvata il cui articolo oggi non è più utilizzabile (da rimuovere per salvare). */
export interface UnusableLineView {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
}

export interface BouquetDraft {
  readonly name: string;
  readonly style: string;
  readonly size: string;
  readonly budget: string;
  readonly notes: string;
  readonly quantities: Readonly<Record<string, number>>;
  /** Colore scelto per carta, vaso e nastri (per ID articolo). */
  readonly colors: Readonly<Record<string, string>>;
}

type SaveAction = (prev: ActionState, payload: unknown) => Promise<ActionState>;

const GROUPS: readonly BuilderRole[] = ['FLOWER', 'FOLIAGE', 'ACCESSORY'];

/** Stesso ordine della distinta salvata dal server: fiori, follaje, complementi, empaque. */
const ROLE_ORDER: Readonly<Record<BuilderRole, number>> = {
  FLOWER: 0,
  FOLIAGE: 1,
  ACCESSORY: 2,
  PACKAGING: 3,
};

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('es-MX')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function draftKey(draft: BouquetDraft): string {
  const quantities = Object.entries(draft.quantities)
    .filter(([, quantity]) => quantity > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  // Solo i colori degli articoli scelti contano per "modifiche non salvate".
  const colors = Object.entries(draft.colors)
    .filter(([id]) => (draft.quantities[id] ?? 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({ ...draft, quantities, colors });
}

/** Carta, vaso e nastri con colori: si sceglie il colore del ramo. */
function choosesColor(option: BuilderOptionView): boolean {
  return (option.role === 'PACKAGING' || option.role === 'ACCESSORY') && option.colors.length > 0;
}

/**
 * Colore effettivo della riga (stessa regola del server): quello scelto se è ancora fra i
 * colori dell'articolo, altrimenti l'unico disponibile; null se manca la scelta.
 */
function colorOf(option: BuilderOptionView, colors: Readonly<Record<string, string>>) {
  if (!choosesColor(option)) return null;
  const chosen = colors[option.id];
  if (chosen && option.colors.some((color) => color.value === chosen)) return chosen;
  return option.colors.length === 1 ? (option.colors[0]?.value ?? null) : null;
}

function ColorChoice({
  option,
  value,
  onChange,
  disabled,
}: {
  option: BuilderOptionView;
  value: string | null;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations('builder.editor');
  if (option.colors.length === 1) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('colorFixed', { color: option.colors[0]?.label ?? '' })}
      </p>
    );
  }
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-sm font-medium">{t('colorOf', { name: option.name })}</legend>
      <div className="flex flex-wrap gap-2">
        {option.colors.map((color) => {
          const checked = value === color.value;
          return (
            <label
              key={color.value}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-xl border bg-card py-1.5 pr-3 pl-1.5 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40',
                checked ? 'border-primary bg-secondary/70 font-medium' : 'hover:bg-muted',
              )}
            >
              <input
                type="radio"
                name={`color-${option.id}`}
                value={color.value}
                checked={checked}
                onChange={() => onChange(color.value)}
                className="sr-only"
              />
              {color.photoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element -- miniatura privata servita da una route autenticata
                <img
                  src={color.photoSrc}
                  alt=""
                  className="size-8 rounded-lg border object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-6 rounded-full border border-black/10',
                    COLOR_SWATCH_CLASS[color.value as CatalogColor],
                  )}
                />
              )}
              {color.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(BUILDER_LIMITS.quantityMax, Math.max(0, Math.trunc(value)));
}

function Stepper({
  option,
  quantity,
  onChange,
}: {
  option: BuilderOptionView;
  quantity: number;
  onChange: (next: number) => void;
}) {
  const t = useTranslations('builder.editor');
  const soldOut = option.availability === 'OUT_OF_STOCK';
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label={t('decrease', { name: option.name })}
        disabled={quantity === 0}
        onClick={() => onChange(quantity - 1)}
      >
        <Minus />
      </Button>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={BUILDER_LIMITS.quantityMax}
        value={quantity}
        aria-label={t('quantityOf', { name: option.name })}
        disabled={soldOut && quantity === 0}
        onChange={(event) => onChange(clampQuantity(Number(event.target.value)))}
        className="h-8 w-14 px-1 text-center tabular-nums"
      />
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label={t('increase', { name: option.name })}
        disabled={soldOut || quantity >= BUILDER_LIMITS.quantityMax}
        onClick={() => onChange(quantity + 1)}
      >
        <Plus />
      </Button>
    </div>
  );
}

function AvailabilityBadge({ availability }: { availability: Availability }) {
  const t = useTranslations('builder.editor');
  if (availability === 'OUT_OF_STOCK') return <Badge variant="danger">{t('outOfStock')}</Badge>;
  if (availability === 'LIMITED')
    return <Badge variant="warning">{t('availability.LIMITED')}</Badge>;
  if (availability === 'ON_REQUEST') {
    return <Badge variant="info">{t('availability.ON_REQUEST')}</Badge>;
  }
  return null;
}

export function BouquetEditor({
  currency,
  laborFeeMinor,
  options,
  unusableLines,
  initial,
  savedTotalMinor,
  canViewCosts,
  canQuote,
  readOnly,
  saveAction,
  quoteHref,
  catalogHref,
  preview,
}: {
  currency: string;
  laborFeeMinor: number;
  options: readonly BuilderOptionView[];
  unusableLines: readonly UnusableLineView[];
  initial: BouquetDraft;
  /** Totale salvato (solo disegni esistenti): per avvisare se i prezzi sono cambiati. */
  savedTotalMinor: number | null;
  canViewCosts: boolean;
  canQuote: boolean;
  readOnly: boolean;
  saveAction: SaveAction;
  quoteHref: string | null;
  catalogHref: string;
  /** Anteprima AI del disegno salvato; null se non disponibile (nessun provider). */
  preview?: PreviewPanelData | null;
}) {
  const t = useTranslations('builder.editor');
  const tv = useTranslations('validation');
  const [draft, setDraft] = useState<BouquetDraft>(initial);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [state, formAction, pending] = useActionState(saveAction, idleState);
  useActionToast(state);
  const fmt = (minor: number) => money(minor, currency);

  const packagingOptions = options.filter((option) => option.role === 'PACKAGING');
  const selectedPackaging =
    packagingOptions.find((option) => (draft.quantities[option.id] ?? 0) > 0)?.id ?? '';
  const pendingUnusable = unusableLines.filter((line) => !removed.has(line.id));

  const selected = options
    .map((option) => ({ option, quantity: draft.quantities[option.id] ?? 0 }))
    .filter((entry) => entry.quantity > 0)
    .sort(
      (a, b) =>
        ROLE_ORDER[a.option.role] - ROLE_ORDER[b.option.role] ||
        a.option.name.localeCompare(b.option.name, 'es-MX'),
    );
  const pricing = priceBouquet({
    lines: selected.map(({ option, quantity }) => ({
      role: option.role,
      quantity,
      unitPriceMinor: option.priceMinor,
      unitCostMinor: option.costMinor,
    })),
    laborMinor: laborFeeMinor,
  });
  const composition = checkComposition(
    selected.map(({ option, quantity }) => ({ role: option.role, quantity })),
  );
  const budgetParse =
    draft.budget.trim() && isCurrencyCode(currency)
      ? parseMoneyInput(draft.budget, currency)
      : null;
  const budgetMinor = budgetParse?.ok ? budgetParse.minor : null;
  const removedCount = unusableLines.length - pendingUnusable.length;
  const dirty = draftKey(draft) !== draftKey(initial) || removedCount > 0;
  const soldOutSelected = selected.filter(({ option }) => option.availability === 'OUT_OF_STOCK');
  const missingColor = selected.filter(
    ({ option }) => choosesColor(option) && colorOf(option, draft.colors) === null,
  );
  // Mai sostituzioni silenziose: i componenti non più disponibili si tolgono a mano.
  const blocked =
    pendingUnusable.length > 0 || soldOutSelected.length > 0 || missingColor.length > 0;
  const linesError = fieldError(state, 'lines');

  const setQuantity = (id: string, quantity: number) =>
    setDraft((current) => ({
      ...current,
      quantities: { ...current.quantities, [id]: clampQuantity(quantity) },
    }));

  const setColor = (id: string, color: string) =>
    setDraft((current) => ({ ...current, colors: { ...current.colors, [id]: color } }));

  const setPackaging = (id: string) =>
    setDraft((current) => {
      const quantities = { ...current.quantities };
      for (const option of packagingOptions) delete quantities[option.id];
      if (id) quantities[id] = 1;
      return { ...current, quantities };
    });

  const save = () => {
    if (readOnly || pending) return;
    const payload = {
      name: draft.name,
      style: draft.style,
      size: draft.size,
      budget: draft.budget,
      notes: draft.notes,
      lines: selected.map(({ option, quantity }) => ({
        catalogItemId: option.id,
        quantity,
        color: colorOf(option, draft.colors),
      })),
    };
    startTransition(() => formAction(payload));
  };

  const term = normalize(query.trim());
  const visible = (option: BuilderOptionView) => !term || normalize(option.name).includes(term);
  const warnings = [
    ...selected
      .filter(
        ({ option }) => option.availability === 'LIMITED' || option.availability === 'ON_REQUEST',
      )
      .map(({ option }) =>
        t(`warnings.${option.availability as 'LIMITED' | 'ON_REQUEST'}`, { name: option.name }),
      ),
    ...soldOutSelected.map(({ option }) => t('warnings.UNAVAILABLE', { name: option.name })),
    ...pendingUnusable.map((line) => t('warnings.UNAVAILABLE', { name: line.name })),
  ];

  if (options.length === 0 && unusableLines.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/60 px-6 py-14 text-center">
        <h2 className="font-semibold">{t('noOptions')}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{t('noOptionsBody')}</p>
        <Button asChild variant="outline" className="mt-2">
          <Link href={catalogHref}>{t('goToCatalog')}</Link>
        </Button>
      </div>
    );
  }

  const summary = (
    <Card id="builder-summary" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{t('summary')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {selected.length > 0 ? (
          <ul className="space-y-1 text-sm" aria-label={t('selection')}>
            {selected.map(({ option, quantity }) => {
              const color = option.colors.find(
                (entry) => entry.value === colorOf(option, draft.colors),
              );
              return (
                <li key={option.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {color
                      ? t('lineTotalColor', { quantity, name: option.name, color: color.label })
                      : t('lineTotal', { quantity, name: option.name })}
                  </span>
                  <span className="tabular-nums">{fmt(option.priceMinor * quantity)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        )}
        {pricing.ok ? (
          <dl className="grid gap-1.5 border-t pt-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t('flowers')}</dt>
              <dd className="tabular-nums">{fmt(pricing.flowersMinor)}</dd>
            </div>
            {pricing.packagingMinor > 0 ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('packaging')}</dt>
                <dd className="tabular-nums">{fmt(pricing.packagingMinor)}</dd>
              </div>
            ) : null}
            {pricing.accessoriesMinor > 0 ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('accessories')}</dt>
                <dd className="tabular-nums">{fmt(pricing.accessoriesMinor)}</dd>
              </div>
            ) : null}
            {pricing.laborMinor > 0 ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('labor')}</dt>
                <dd className="tabular-nums">{fmt(pricing.laborMinor)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
              <dt>{t('total')}</dt>
              <dd className="tabular-nums" data-testid="builder-total">
                {fmt(pricing.totalMinor)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-destructive">{tv('amount_too_large')}</p>
        )}
        {pricing.ok && budgetMinor !== null ? (
          <p
            className={cn(
              'text-sm',
              pricing.totalMinor > budgetMinor ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {pricing.totalMinor > budgetMinor
              ? t('budgetOver', { amount: fmt(pricing.totalMinor - budgetMinor) })
              : t('budgetLeft', { amount: fmt(budgetMinor - pricing.totalMinor) })}
          </p>
        ) : null}
        {canViewCosts && pricing.ok && selected.length > 0 ? (
          <div className="space-y-1.5 rounded-xl bg-muted/40 p-3 text-sm">
            {pricing.estimatedCostMinor !== null ? (
              <dl className="grid gap-1">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t('estimatedCost')}</dt>
                  <dd className="tabular-nums">{fmt(pricing.estimatedCostMinor)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t('estimatedMargin')}</dt>
                  <dd className="font-medium tabular-nums">
                    {fmt(pricing.totalMinor - pricing.estimatedCostMinor)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-muted-foreground">{t('costIncomplete')}</p>
            )}
            <p className="text-xs text-muted-foreground">{t('costsInternal')}</p>
          </div>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="space-y-1.5">
            {warnings.map((warning) => (
              <li key={warning} className="flex gap-2 text-sm text-[oklch(0.42_0.1_65)]">
                <TriangleExclamationPoint className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
        {savedTotalMinor !== null &&
        pricing.ok &&
        !dirty &&
        savedTotalMinor !== pricing.totalMinor ? (
          <p className="text-sm text-muted-foreground">
            {t('pricesChanged', { total: fmt(savedTotalMinor) })}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-muted-foreground">{t('pricesNote')}</p>
        {missingColor.length > 0 && !readOnly ? (
          <ul className="space-y-1 text-sm text-destructive" role="alert">
            {missingColor.map(({ option }) => (
              <li key={option.id}>{t('chooseColor', { name: option.name })}</li>
            ))}
          </ul>
        ) : null}
        {linesError ? (
          <p className="text-sm text-destructive" role="alert">
            {linesError}
          </p>
        ) : null}
        {!readOnly ? (
          <div className="grid gap-2">
            <Button
              type="button"
              onClick={save}
              disabled={pending || blocked || composition === 'builder_needs_flower' || !pricing.ok}
              aria-busy={pending}
            >
              {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
              {pending ? t('saving') : quoteHref === null ? t('save') : t('saveChanges')}
            </Button>
            {composition === 'builder_needs_flower' && selected.length > 0 ? (
              <p className="text-sm text-muted-foreground">{tv('builder_needs_flower')}</p>
            ) : null}
            {canQuote && quoteHref !== null ? (
              dirty ? (
                <p className="text-sm text-muted-foreground">{t('quoteHint')}</p>
              ) : (
                <Button asChild variant="outline">
                  <Link href={quoteHref}>
                    <FileText />
                    {t('createQuote')}
                  </Link>
                </Button>
              )
            ) : null}
            {dirty && quoteHref !== null ? (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {t('unsaved')}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-6">
        {pendingUnusable.length > 0 ? (
          <Alert variant="warning">
            <TriangleExclamationPoint aria-hidden="true" />
            <AlertDescription>
              <ul className="space-y-2">
                {pendingUnusable.map((line) => (
                  <li key={line.id} className="flex items-center justify-between gap-3">
                    <span>{t('warnings.UNAVAILABLE', { name: line.name })}</span>
                    {!readOnly ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setRemoved((current) => new Set(current).add(line.id))}
                      >
                        <Trash />
                        {t('remove', { name: line.name })}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="pl-9"
          />
        </div>

        {GROUPS.map((role) => {
          const groupOptions = options.filter((option) => option.role === role && visible(option));
          if (groupOptions.length === 0) return null;
          return (
            <section key={role} aria-labelledby={`group-${role}`} className="space-y-2">
              <h2 id={`group-${role}`} className="text-sm font-semibold">
                {t(`groups.${role}`)}
              </h2>
              <ul className="divide-y rounded-2xl border bg-card">
                {groupOptions.map((option) => {
                  const quantity = draft.quantities[option.id] ?? 0;
                  return (
                    <li
                      key={option.id}
                      className={cn('space-y-2 px-4 py-3', quantity > 0 && 'bg-secondary/40')}
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium break-words">{option.name}</p>
                          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <span className="tabular-nums">
                              {t('unitPrice', {
                                price: fmt(option.priceMinor),
                                unit: option.unitLabel,
                              })}
                            </span>
                            <AvailabilityBadge availability={option.availability} />
                          </p>
                        </div>
                        {readOnly ? (
                          <span className="text-sm tabular-nums">{quantity}</span>
                        ) : (
                          <Stepper
                            option={option}
                            quantity={quantity}
                            onChange={(next) => setQuantity(option.id, next)}
                          />
                        )}
                      </div>
                      {quantity > 0 && choosesColor(option) ? (
                        <ColorChoice
                          option={option}
                          value={colorOf(option, draft.colors)}
                          onChange={(color) => setColor(option.id, color)}
                          disabled={readOnly}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        {packagingOptions.some(visible) || (!term && packagingOptions.length > 0) ? (
          <fieldset className="space-y-2" disabled={readOnly}>
            <legend className="mb-2 text-sm font-semibold">{t('groups.PACKAGING')}</legend>
            <div className="divide-y rounded-2xl border bg-card">
              <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                <input
                  type="radio"
                  name="packaging"
                  value=""
                  checked={selectedPackaging === ''}
                  onChange={() => setPackaging('')}
                  className="size-4 accent-primary"
                />
                <span className="font-medium">{t('noPackaging')}</span>
              </label>
              {packagingOptions.filter(visible).map((option) => (
                <div key={option.id}>
                  <label
                    className={cn(
                      'flex items-center gap-3 px-4 py-3',
                      option.availability === 'OUT_OF_STOCK'
                        ? 'cursor-not-allowed opacity-60'
                        : 'cursor-pointer',
                    )}
                  >
                    <input
                      type="radio"
                      name="packaging"
                      value={option.id}
                      checked={selectedPackaging === option.id}
                      disabled={option.availability === 'OUT_OF_STOCK'}
                      onChange={() => setPackaging(option.id)}
                      className="size-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium break-words">{option.name}</span>
                      <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span className="tabular-nums">{fmt(option.priceMinor)}</span>
                        <AvailabilityBadge availability={option.availability} />
                      </span>
                    </span>
                  </label>
                  {selectedPackaging === option.id && choosesColor(option) ? (
                    <div className="px-4 pb-3 pl-11">
                      <ColorChoice
                        option={option}
                        value={colorOf(option, draft.colors)}
                        onChange={(color) => setColor(option.id, color)}
                        disabled={readOnly}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </fieldset>
        ) : null}

        {term && !options.some(visible) ? (
          <p className="text-sm text-muted-foreground">{t('noMatches')}</p>
        ) : null}

        {/* Su telefono il totale resta visibile mentre si scelgono i fiori. */}
        {pricing.ok && selected.length > 0 ? (
          <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 lg:hidden">
            <a
              href="#builder-summary"
              className="flex items-center justify-between gap-3 rounded-2xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur"
            >
              <span className="text-sm text-muted-foreground">{t('total')}</span>
              <span className="font-semibold tabular-nums">{fmt(pricing.totalMinor)}</span>
            </a>
          </div>
        ) : null}
      </div>

      <div className="min-w-0 space-y-6 lg:sticky lg:top-6 lg:self-start">
        {summary}
        {preview && !readOnly ? <PreviewPanel data={preview} dirty={dirty} /> : null}
        <Card>
          <CardHeader>
            <CardTitle>{t('details')}</CardTitle>
          </CardHeader>
          <CardContent>
            <fieldset className="grid gap-4" disabled={readOnly}>
              <Field id="design-name" label={t('name')} error={fieldError(state, 'name')} required>
                <Input
                  {...controlProps('design-name', fieldError(state, 'name'))}
                  value={draft.name}
                  maxLength={BUILDER_LIMITS.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  required
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <Field id="design-style" label={t('style')} error={fieldError(state, 'style')}>
                  <NativeSelect
                    {...controlProps('design-style', fieldError(state, 'style'))}
                    value={draft.style}
                    onChange={(event) => setDraft({ ...draft, style: event.target.value })}
                  >
                    <option value="">{t('notSet')}</option>
                    {BUILDER_STYLES.map((style) => (
                      <option key={style} value={style}>
                        {t(`styles.${style}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="design-size" label={t('size')} error={fieldError(state, 'size')}>
                  <NativeSelect
                    {...controlProps('design-size', fieldError(state, 'size'))}
                    value={draft.size}
                    onChange={(event) => setDraft({ ...draft, size: event.target.value })}
                  >
                    <option value="">{t('notSet')}</option>
                    {BUILDER_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {t(`sizes.${size}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <Field
                id="design-budget"
                label={t('budget', { currency })}
                hint={t('budgetHint')}
                error={fieldError(state, 'budget')}
              >
                <Input
                  {...controlProps('design-budget', fieldError(state, 'budget'), true)}
                  value={draft.budget}
                  inputMode="decimal"
                  autoComplete="off"
                  onChange={(event) => setDraft({ ...draft, budget: event.target.value })}
                />
              </Field>
              <Field id="design-notes" label={t('notes')} error={fieldError(state, 'notes')}>
                <Textarea
                  {...controlProps('design-notes', fieldError(state, 'notes'))}
                  value={draft.notes}
                  maxLength={BUILDER_LIMITS.notes}
                  rows={3}
                  onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                />
              </Field>
            </fieldset>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
