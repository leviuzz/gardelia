'use client';

import { Ban, RotateCcw, UserPlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import type { MembershipRole } from '@floral/domain';
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
import { Input, NativeSelect } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function InviteForm({ action, roles }: { action: Action; roles: readonly MembershipRole[] }) {
  const t = useTranslations();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.status === 'success') formRef.current?.reset();
    return result;
  }, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);

  return (
    <form ref={formRef} action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
      <Field id="invite-email" label={t('team.inviteEmail')} error={err('email')}>
        <Input {...controlProps('invite-email', err('email'))} name="email" type="email" autoComplete="off" required />
      </Field>
      <Field id="invite-role" label={t('team.inviteRole')} error={err('role')}>
        <NativeSelect {...controlProps('invite-role', err('role'))} name="role" defaultValue={roles.includes('STAFF') ? 'STAFF' : roles[0]}>
          {roles.map((role) => (
            <option key={role} value={role}>
              {t(`roles.${role}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <SubmitButton pendingLabel={t('team.inviting')}>
        <UserPlus />
        {t('team.inviteButton')}
      </SubmitButton>
    </form>
  );
}

export function RoleSelect({
  action,
  currentRole,
  label,
}: {
  action: Action;
  currentRole: MembershipRole;
  label: string;
}) {
  const t = useTranslations();
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={formAction} onSubmit={preserveOnSubmit(formAction)}>
      <label className="sr-only" htmlFor={`role-${label}`}>
        {t('team.changeRole')}
      </label>
      <NativeSelect
        id={`role-${label}`}
        name="role"
        defaultValue={currentRole}
        className="h-9 w-36 text-sm"
        onChange={() => formRef.current?.requestSubmit()}
      >
        {(['OWNER', 'MANAGER', 'STAFF'] as const).map((role) => (
          <option key={role} value={role}>
            {t(`roles.${role}`)}
          </option>
        ))}
      </NativeSelect>
    </form>
  );
}

export function MemberStatusControl({
  action,
  active,
  memberName,
}: {
  action: Action;
  active: boolean;
  memberName: string;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  useEffect(() => {
    if (state.status !== 'idle') setOpen(false);
  }, [state]);

  if (!active) {
    return (
      <form action={formAction}>
        <SubmitButton size="sm" variant="outline">
          <RotateCcw />
          {t('team.reactivate')}
        </SubmitButton>
      </form>
    );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Ban />
          {t('team.deactivate')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('team.deactivateTitle', { name: memberName })}</DialogTitle>
          <DialogDescription>{t('team.deactivateBody')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t('common.cancel')}</Button>
          </DialogClose>
          <form action={formAction}>
            <SubmitButton variant="destructive" className="w-full sm:w-auto">
              {t('team.deactivate')}
            </SubmitButton>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RevokeInvitationButton({ action }: { action: Action }) {
  const t = useTranslations('team');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  return (
    <form action={formAction}>
      <SubmitButton size="sm" variant="ghost">
        <X />
        {t('revoke')}
      </SubmitButton>
    </form>
  );
}
