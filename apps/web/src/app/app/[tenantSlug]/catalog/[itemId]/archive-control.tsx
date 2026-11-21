'use client';

import { Archive, ArchiveArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
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

export function ArchiveControl({
  archived,
  archiveAction,
  restoreAction,
}: {
  archived: boolean;
  archiveAction: Action;
  restoreAction: Action;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [archiveState, archiveFormAction] = useActionState(archiveAction, idleState);
  const [restoreState, restoreFormAction] = useActionState(restoreAction, idleState);
  useActionToast(archiveState);
  useActionToast(restoreState);

  useEffect(() => {
    if (archiveState.status === 'success') setOpen(false);
  }, [archiveState]);

  if (archived) {
    return (
      <form action={restoreFormAction}>
        <SubmitButton variant="outline">
          <ArchiveArrowUp />
          {t('catalog.form.restore')}
        </SubmitButton>
      </form>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Archive />
          {t('catalog.form.archive')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('catalog.form.archiveTitle')}</DialogTitle>
          <DialogDescription>{t('catalog.form.archiveBody')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t('common.cancel')}</Button>
          </DialogClose>
          <form action={archiveFormAction}>
            <SubmitButton variant="destructive" className="w-full sm:w-auto">
              {t('catalog.form.archive')}
            </SubmitButton>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
