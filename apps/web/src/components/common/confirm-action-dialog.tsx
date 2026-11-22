'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
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
import type { ActionState } from '@/lib/action-state';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Azione da confermare (archiviare, annullare una cotización, disattivare un membro, usare un
 * credito): il pulsante apre la finestra con "Cancelar" e la conferma (in rosso se toglie qualcosa). La finestra si chiude solo se
 * l'azione riesce; se fallisce resta aperta e il toast spiega perché.
 */
export function ConfirmActionDialog({
  action,
  trigger,
  title,
  description,
  confirmLabel,
  confirmVariant = 'destructive',
  fields,
}: {
  readonly action: Action;
  /** Il pulsante che apre la finestra. */
  readonly trigger: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  /** Rosso per le azioni che tolgono qualcosa; normale per quelle che costano (es. un credito). */
  readonly confirmVariant?: 'destructive' | 'default';
  /** Valori nascosti inviati con la conferma (es. lo stato richiesto). */
  readonly fields?: Readonly<Record<string, string>>;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [, formAction] = useToastActionState(action, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t('cancel')}</Button>
          </DialogClose>
          <form action={formAction}>
            {Object.entries(fields ?? {}).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <SubmitButton variant={confirmVariant} className="w-full sm:w-auto">
              {confirmLabel}
            </SubmitButton>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
