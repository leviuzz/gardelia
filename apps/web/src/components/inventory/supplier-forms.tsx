'use client';

import { Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { PURCHASE_LIMITS } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
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

export interface SupplierValues {
  readonly name: string;
  readonly phone: string;
  readonly notes: string;
}

function SupplierFields({
  prefix,
  state,
  defaults,
}: {
  readonly prefix: string;
  readonly state: ActionState;
  readonly defaults?: SupplierValues;
}) {
  const t = useTranslations('inventory.suppliers');
  const errors = {
    name: fieldError(state, 'name'),
    phone: fieldError(state, 'phone'),
    notes: fieldError(state, 'notes'),
  };
  return (
    <>
      <Field id={`${prefix}-name`} label={t('name')} error={errors.name} required>
        <Input
          {...controlProps(`${prefix}-name`, errors.name)}
          name="name"
          maxLength={PURCHASE_LIMITS.supplierName}
          defaultValue={defaults?.name}
          autoComplete="off"
          required
        />
      </Field>
      <Field id={`${prefix}-phone`} label={t('phone')} error={errors.phone}>
        <Input
          {...controlProps(`${prefix}-phone`, errors.phone)}
          name="phone"
          type="tel"
          defaultValue={defaults?.phone}
          autoComplete="off"
        />
      </Field>
      <Field id={`${prefix}-notes`} label={t('notes')} error={errors.notes}>
        <Input
          {...controlProps(`${prefix}-notes`, errors.notes)}
          name="notes"
          maxLength={PURCHASE_LIMITS.supplierNotes}
          defaultValue={defaults?.notes}
          autoComplete="off"
        />
      </Field>
    </>
  );
}

/** "Agregar proveedor": il form si svuota solo se il proveedor è stato aggiunto. */
export function SupplierAddForm({ action }: { readonly action: Action }) {
  const t = useTranslations('inventory.suppliers');
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useToastActionState(action, () => formRef.current?.reset());
  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start"
    >
      <SupplierFields prefix="new-supplier" state={state} />
      <SubmitButton icon={<Plus />} className="sm:mt-7">
        {t('add')}
      </SubmitButton>
    </form>
  );
}

export function SupplierEditDialog({
  action,
  values,
}: {
  readonly action: Action;
  readonly values: SupplierValues;
}) {
  const t = useTranslations('inventory.suppliers');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil aria-hidden="true" />
          {t('edit')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{values.name}</DialogTitle>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <SupplierFields prefix="edit-supplier" state={state} defaults={values} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{t('save')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
