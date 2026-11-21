'use client';

import { Archive, ArchiveArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
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
import { idleState, type ActionState } from '@/lib/action-state';
import { useActionToast } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface ArchiveControlLabels {
  readonly archive: string;
  readonly restore: string;
  readonly confirmTitle: string;
  readonly confirmBody: string;
}

/** Archivia (con conferma) o ripristina un record: nessuna cancellazione fisica. */
export function ArchiveControl({
  archived,
  archiveAction,
  restoreAction,
  labels,
}: {
  archived: boolean;
  archiveAction: Action;
  restoreAction: Action;
  labels: ArchiveControlLabels;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [archiveState, archiveFormAction] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await archiveAction(prev, formData);
      if (result.status === 'success') setOpen(false);
      return result;
    },
    idleState,
  );
  const [restoreState, restoreFormAction] = useActionState(restoreAction, idleState);
  useActionToast(archiveState);
  useActionToast(restoreState);

  if (archived) {
    return (
      <form action={restoreFormAction}>
        <SubmitButton variant="outline">
          <ArchiveArrowUp />
          {labels.restore}
        </SubmitButton>
      </form>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Archive />
          {labels.archive}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{labels.confirmTitle}</DialogTitle>
          <DialogDescription>{labels.confirmBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t('common.cancel')}</Button>
          </DialogClose>
          <form action={archiveFormAction}>
            <SubmitButton variant="destructive" className="w-full sm:w-auto">
              {labels.archive}
            </SubmitButton>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
