'use client';

import { PackageMinus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { BOUQUETS_MADE_MAX, bouquetShortages, type SaleUnit } from '@floral/domain';
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
import { Input } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Un ingrediente della ricetta: quanto per un ramo e quanto è disponibile (null = non controllato). */
export interface BouquetIngredient {
  readonly name: string;
  readonly saleUnit: SaleUnit;
  readonly quantity: number;
  readonly available: number | null;
}

/** Intero scritto nel campo, o null se non è (ancora) un numero intero positivo. */
function positiveNumber(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) && Number(trimmed) > 0 ? Number(trimmed) : null;
}

/**
 * "Registrar ramos hechos" (ADR-063): quanti ramos; mentre si scrive compare cosa manca e il
 * pulsante diventa "Registrar de todos modos" (la conferma esplicita; il server ricontrolla).
 */
export function BouquetsMadeDialog({
  action,
  bouquetName,
  ingredients,
}: {
  readonly action: Action;
  readonly bouquetName: string;
  readonly ingredients: readonly BouquetIngredient[];
}) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState('1');
  const [state, formAction] = useToastActionState(action, () => {
    setOpen(false);
    setCount('1');
  });
  const requested = positiveNumber(count);
  const missing = requested === null ? [] : bouquetShortages(ingredients, requested);
  const short = ingredients
    .map((ingredient, index) => ({ ingredient, missing: missing[index] ?? null }))
    .filter((entry): entry is { ingredient: BouquetIngredient; missing: number } =>
      Boolean(entry.missing && entry.missing > 0),
    );
  const error = fieldError(state, 'count');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PackageMinus aria-hidden="true" />
          {t('bouquet.record')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('bouquet.recordTitle', { name: bouquetName })}</DialogTitle>
          <DialogDescription>{t('bouquet.recordBody')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <Field id="bouquets-made-count" label={t('bouquet.count')} error={error} required>
            <Input
              {...controlProps('bouquets-made-count', error)}
              name="count"
              inputMode="numeric"
              autoComplete="off"
              maxLength={String(BOUQUETS_MADE_MAX).length}
              value={count}
              onChange={(event) => setCount(event.target.value)}
              required
            />
          </Field>
          {short.length > 0 ? (
            <>
              <Alert variant="warning">
                <AlertDescription className="space-y-1">
                  <p>{t('bouquet.shortage')}</p>
                  <ul className="list-disc pl-5">
                    {short.map(({ ingredient, missing: amount }) => (
                      <li key={ingredient.name}>
                        {t('bouquet.missing', {
                          quantity: t('quantity', { unit: ingredient.saleUnit, count: amount }),
                          name: ingredient.name,
                        })}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
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
              {short.length > 0 ? t('bouquet.submitShortage') : t('bouquet.submit')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
