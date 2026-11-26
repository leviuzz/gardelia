'use client';

import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ORDER_CHANGE_LIMITS } from '@floral/domain';
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
import { Textarea } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * «No, gracias» ai cambi della fioreria (M3-2), con un motivo facoltativo che la fioreria legge.
 * `round` è la richiesta che la persona ha davanti: se la fioreria l'ha cambiata ancora, il
 * servizio rifiuta e il toast lo dice.
 */
export function DeclineOrderChangeDialog({
  action,
  round,
  shop,
}: {
  readonly action: Action;
  readonly round: number;
  readonly shop: string;
}) {
  const t = useTranslations('account.orderPage.changes');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const reasonErr = fieldError(state, 'reason');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <X />
          {t('decline')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('declineTitle')}</DialogTitle>
          <DialogDescription>{t('declineBody', { shop })}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <input type="hidden" name="round" value={round} />
          <Field
            id="decline-change-reason"
            label={t('declineReason')}
            hint={t('declineReasonHint')}
            error={reasonErr}
          >
            <Textarea
              {...controlProps('decline-change-reason', reasonErr, true)}
              name="reason"
              maxLength={ORDER_CHANGE_LIMITS.declineReason}
              rows={3}
            />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{t('declineConfirm')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Sí» e «No» sotto una domanda della fioreria (M3-2): un tocco, una risposta per domanda. Se due
 * schede rispondono insieme, la seconda riceve l'errore «ya respondiste».
 */
export function QuestionAnswerButtons({
  action,
  messageId,
}: {
  readonly action: Action;
  readonly messageId: string;
}) {
  const t = useTranslations('thread.question');
  const [, formAction] = useToastActionState(action);
  return (
    <form action={formAction} className="flex flex-wrap gap-2" data-testid="question-answer">
      <input type="hidden" name="messageId" value={messageId} />
      <SubmitButton
        name="answer"
        value="YES"
        size="sm"
        variant="outline"
        icon={<Check aria-hidden="true" />}
      >
        {t('yes')}
      </SubmitButton>
      <SubmitButton
        name="answer"
        value="NO"
        size="sm"
        variant="outline"
        icon={<X aria-hidden="true" />}
      >
        {t('no')}
      </SubmitButton>
    </form>
  );
}
