'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PROMO_REDEMPTION_NOTE_MAX } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
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
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * "Marcar como usado" di uno sconto della promo (ADR-048): conferma con una nota facoltativa
 * (es. il preventivo o cosa ha comprato). La finestra si chiude solo se l'azione riesce.
 */
export function RedeemDiscountDialog({
  action,
  code,
  customerName,
  discount,
}: {
  action: Action;
  code: string;
  customerName: string;
  discount: string;
}) {
  const t = useTranslations('promotions.discounts');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const id = `note-${code}`;
  const error = fieldError(state, 'note');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">{t('markUsed')}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('markUsedTitle', { code })}</DialogTitle>
          <DialogDescription>
            {t('markUsedBody', { customer: customerName, discount })}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-5">
          <Field id={id} label={t('noteLabel')} hint={t('noteHint')} error={error}>
            <Input
              {...controlProps(id, error, true)}
              name="note"
              maxLength={PROMO_REDEMPTION_NOTE_MAX}
            />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{tc('cancel')}</Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{t('confirmUse')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
