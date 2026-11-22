'use client';

import { Archive, ArchiveArrowUp } from 'lucide-react';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { ActionButton } from '@/components/form/action-button';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/action-state';

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
  if (archived) {
    return (
      <ActionButton action={restoreAction} variant="outline" icon={<ArchiveArrowUp />}>
        {labels.restore}
      </ActionButton>
    );
  }
  return (
    <ConfirmActionDialog
      action={archiveAction}
      trigger={
        <Button variant="outline">
          <Archive />
          {labels.archive}
        </Button>
      }
      title={labels.confirmTitle}
      description={labels.confirmBody}
      confirmLabel={labels.archive}
    />
  );
}
