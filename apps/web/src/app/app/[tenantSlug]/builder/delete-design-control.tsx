'use client';

import { Trash } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
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

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface DeleteDesignLabels {
  readonly delete: string;
  readonly confirmTitle: string;
  readonly confirmBody: string;
  readonly inUseTitle: string;
  readonly inUseBody: string;
}

/**
 * "Eliminar" di un disegno (ADR-051): con conferma, via il disegno e le sue foto generate. Se un
 * preventivo o un ordine lo usa la stessa finestra spiega perché non si può e che resta "Archivar".
 */
export function DeleteDesignControl({
  action,
  inUse,
  labels,
}: {
  readonly action: Action;
  readonly inUse: boolean;
  readonly labels: DeleteDesignLabels;
}) {
  const t = useTranslations('common');
  const trigger = (
    <Button variant="outline" className="text-destructive hover:text-destructive">
      <Trash />
      {labels.delete}
    </Button>
  );
  if (!inUse) {
    return (
      <ConfirmActionDialog
        action={action}
        trigger={trigger}
        title={labels.confirmTitle}
        description={labels.confirmBody}
        confirmLabel={labels.delete}
      />
    );
  }
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{labels.inUseTitle}</DialogTitle>
          <DialogDescription>{labels.inUseBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('close')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
