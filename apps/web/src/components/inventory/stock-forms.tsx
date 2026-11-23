'use client';

import { Bell, ClipboardCheck, PackageMinus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { INVENTORY_LIMITS, type SaleUnit, type StockOutKind } from '@floral/domain';
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

/** Il prodotto come lo vede il form: nome, unità e quanto ce n'è adesso. */
export interface StockFormItem {
  readonly name: string;
  readonly saleUnit: SaleUnit;
  readonly onHand: number;
  readonly available: number;
  readonly minQuantity: number | null;
}

/** Intero scritto nel campo, o null se non è (ancora) un numero intero non negativo. */
function wholeNumber(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * Uso o merma. Mentre si scrive la quantità, se la merce non basta compare l'avviso con la
 * giacenza che resterebbe e il pulsante diventa "Registrar de todos modos": è la conferma esplicita
 * (il server la ricontrolla con la giacenza di quel momento).
 */
export function StockOutDialog({
  action,
  kind,
  item,
}: {
  readonly action: Action;
  readonly kind: StockOutKind;
  readonly item: StockFormItem;
}) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [state, formAction] = useToastActionState(action, () => {
    setOpen(false);
    setQuantity('');
  });
  const prefix = kind === 'USE' ? 'use' : 'waste';
  const requested = wholeNumber(quantity);
  const shortage = requested !== null && requested > Math.max(item.available, 0);
  const quantityId = `${prefix}-quantity`;
  const noteId = `${prefix}-note`;
  const quantityError = fieldError(state, 'quantity');
  const noteError = fieldError(state, 'note');
  const amount = (count: number) => t('quantity', { unit: item.saleUnit, count });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={kind === 'USE' ? 'default' : 'outline'} className="w-full sm:w-auto">
          {kind === 'USE' ? <PackageMinus /> : <Trash2 />}
          {t(`actions.${prefix}`)}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t(`forms.${prefix}Title`, { name: item.name })}</DialogTitle>
          <DialogDescription>{t(`forms.${prefix}Body`)}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <Field
            id={quantityId}
            label={t('forms.quantity', { unit: t(`unitName.${item.saleUnit}`) })}
            error={quantityError}
            required
          >
            <Input
              {...controlProps(quantityId, quantityError)}
              name="quantity"
              inputMode="numeric"
              autoComplete="off"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
            />
          </Field>
          {shortage ? (
            <>
              <Alert variant="warning">
                <AlertDescription>
                  {t('forms.shortage', {
                    available: amount(Math.max(item.available, 0)),
                    after: amount(item.onHand - requested),
                  })}
                </AlertDescription>
              </Alert>
              <input type="hidden" name="confirmShortage" value="on" />
            </>
          ) : null}
          <Field
            id={noteId}
            label={t('forms.note')}
            hint={t(`forms.${prefix}NoteHint`)}
            error={noteError}
          >
            <Input
              {...controlProps(noteId, noteError, true)}
              name="note"
              maxLength={INVENTORY_LIMITS.note}
              autoComplete="off"
            />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">
              {shortage ? t('forms.submitShortage') : t('forms.submit')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Conteggio fisico: quanti ce ne sono davvero; il server registra la differenza. */
export function StockCountDialog({
  action,
  item,
}: {
  readonly action: Action;
  readonly item: StockFormItem;
}) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const countError = fieldError(state, 'countedQuantity');
  const noteError = fieldError(state, 'note');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <ClipboardCheck />
          {t('actions.count')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('forms.countTitle', { name: item.name })}</DialogTitle>
          <DialogDescription>
            {t('forms.countBody', {
              current: t('quantity', { unit: item.saleUnit, count: item.onHand }),
            })}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <Field
            id="count-quantity"
            label={t('forms.counted', { unit: t(`unitName.${item.saleUnit}`) })}
            error={countError}
            required
          >
            <Input
              {...controlProps('count-quantity', countError)}
              name="countedQuantity"
              inputMode="numeric"
              autoComplete="off"
              required
            />
          </Field>
          <Field id="count-note" label={t('forms.note')} error={noteError}>
            <Input
              {...controlProps('count-note', noteError)}
              name="note"
              maxLength={INVENTORY_LIMITS.note}
              autoComplete="off"
            />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{t('forms.countSubmit')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Avísame cuando queden": vuoto = nessun avviso. */
export function MinimumDialog({
  action,
  item,
}: {
  readonly action: Action;
  readonly item: StockFormItem;
}) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const error = fieldError(state, 'minQuantity');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="w-full sm:w-auto">
          <Bell />
          {t('actions.minimum')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('forms.minimumTitle', { name: item.name })}</DialogTitle>
          <DialogDescription>{t('forms.minimumBody')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <Field
            id="minimum-quantity"
            label={t('forms.minimumLabel', { unit: t(`unitName.${item.saleUnit}`) })}
            error={error}
          >
            <Input
              {...controlProps('minimum-quantity', error)}
              name="minQuantity"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={item.minQuantity ?? ''}
            />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{tc('save')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
