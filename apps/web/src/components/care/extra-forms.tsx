'use client';

/**
 * Visita extra di un contratto (ADR-078, blocco 2b): perché, in un orario di visita (conta i posti)
 * o a un'ora libera (decisione del founder: non tocca i posti e i clienti non la possono scegliere),
 * quanto costa (lo calcola il server: qui solo la scelta), nota e persona. Da un avviso di pianta
 * morta arriva già come "Reposición sin costo".
 */
import { CalendarPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import {
  CARE_EXTRA_KINDS,
  CARE_EXTRA_LIMITS,
  type CareExtraFee,
  type CareExtraKind,
} from '@floral/domain';
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
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const choice =
  'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60';

export interface ExtraOptionView {
  /** "AAAA-MM-GG_idFascia". */
  readonly value: string;
  /** "jue 3 dic · 09:00–12:00 · 2 lugares", già formattato. */
  readonly label: string;
}

export interface ExtraQuoteView {
  readonly id: string;
  /** "COT-0012 · Cambio de temporada", già formattato. */
  readonly label: string;
}

export interface ExtraVisitDefaults {
  readonly kind: CareExtraKind;
  readonly fee: CareExtraFee;
  /** L'avviso di una pianta morta che questa visita risolve ("Reposición sin costo"). */
  readonly followUpId: string | null;
}

export function ExtraVisitDialog({
  action,
  idPrefix,
  options,
  quotes,
  assignees,
  visitFeeLabel,
  dates,
  defaults,
  defaultOpen = false,
  trigger,
}: {
  readonly action: Action;
  readonly idPrefix: string;
  readonly options: readonly ExtraOptionView[];
  readonly quotes: readonly ExtraQuoteView[];
  readonly assignees: readonly { readonly membershipId: string; readonly name: string }[];
  /** La tariffa per visita del contratto con il viaggio, già formattata. */
  readonly visitFeeLabel: string;
  readonly dates: { readonly first: string; readonly last: string };
  readonly defaults: ExtraVisitDefaults;
  /** Si apre da solo (arrivando da un avviso). */
  readonly defaultOpen?: boolean;
  readonly trigger?: ReactNode;
}) {
  const t = useTranslations('care.extra');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(defaultOpen);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const err = (field: string) => fieldError(state, field);
  const id = (name: string) => `${idPrefix}-${name}`;
  const fromFollowUp = defaults.followUpId !== null;
  const [placement, setPlacement] = useState<'SLOT' | 'TIME'>(options.length > 0 ? 'SLOT' : 'TIME');
  const [fee, setFee] = useState<CareExtraFee>(
    defaults.fee === 'QUOTE' && quotes.length === 0 ? 'VISIT_FEE' : defaults.fee,
  );
  const optionError = err('date') ?? err('slotId') ?? err('option');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" className="w-full sm:w-auto">
            <CalendarPlus />
            {t('open')}
          </Button>
        )}
      </DialogTrigger>
      {/* Un modulo lungo: sul telefono (e negli schermi bassi) il dialogo scorre. */}
      <DialogContent closeLabel={tc('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{fromFollowUp ? t('replacementTitle') : t('title')}</DialogTitle>
          <DialogDescription>{fromFollowUp ? t('replacementBody') : t('body')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          {fromFollowUp ? (
            <>
              <input type="hidden" name="followUpId" value={defaults.followUpId ?? ''} />
              <input type="hidden" name="kind" value="REPLACEMENT" />
              <input type="hidden" name="fee" value="FREE" />
            </>
          ) : (
            <Field id={id('kind')} label={t('kind')} error={err('kind')} required>
              <NativeSelect
                {...controlProps(id('kind'), err('kind'))}
                name="kind"
                defaultValue={defaults.kind}
                required
              >
                {CARE_EXTRA_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`kinds.${kind}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('when')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={choice}>
                <input
                  type="radio"
                  name="placement"
                  value="SLOT"
                  checked={placement === 'SLOT'}
                  onChange={() => setPlacement('SLOT')}
                  disabled={options.length === 0}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>{t('inSlot')}</span>
              </label>
              <label className={choice}>
                <input
                  type="radio"
                  name="placement"
                  value="TIME"
                  checked={placement === 'TIME'}
                  onChange={() => setPlacement('TIME')}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>{t('atTime')}</span>
              </label>
            </div>
            {options.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('noOptions')}</p>
            ) : null}
          </fieldset>
          {placement === 'SLOT' ? (
            <Field id={id('option')} label={t('slot')} error={optionError} required>
              <NativeSelect
                {...controlProps(id('option'), optionError)}
                name="option"
                defaultValue=""
                required
              >
                <option value="">{t('chooseSlot')}</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : (
            <div className="grid gap-3">
              <Field
                id={id('date')}
                label={t('date')}
                hint={t('atTimeHint')}
                error={err('date')}
                required
              >
                <Input
                  {...controlProps(id('date'), err('date'), true)}
                  type="date"
                  name="date"
                  min={dates.first}
                  max={dates.last}
                  defaultValue={dates.first}
                  required
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id={id('start')} label={t('start')} error={err('start')} required>
                  <Input
                    {...controlProps(id('start'), err('start'))}
                    type="time"
                    name="start"
                    step={300}
                    required
                  />
                </Field>
                <Field id={id('end')} label={t('end')} error={err('end')} required>
                  <Input
                    {...controlProps(id('end'), err('end'))}
                    type="time"
                    name="end"
                    step={300}
                    required
                  />
                </Field>
              </div>
            </div>
          )}

          {fromFollowUp ? (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm">{t('fees.FREE')}</p>
          ) : (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">{t('fee')}</legend>
              <label className={choice}>
                <input
                  type="radio"
                  name="fee"
                  value="VISIT_FEE"
                  checked={fee === 'VISIT_FEE'}
                  onChange={() => setFee('VISIT_FEE')}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>{t('feeVisit', { price: visitFeeLabel })}</span>
              </label>
              <label className={choice}>
                <input
                  type="radio"
                  name="fee"
                  value="FREE"
                  checked={fee === 'FREE'}
                  onChange={() => setFee('FREE')}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>{t('fees.FREE')}</span>
              </label>
              <label className={choice}>
                <input
                  type="radio"
                  name="fee"
                  value="QUOTE"
                  checked={fee === 'QUOTE'}
                  onChange={() => setFee('QUOTE')}
                  disabled={quotes.length === 0}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  {t('fees.QUOTE')}
                  {quotes.length === 0 ? (
                    <span className="block text-xs text-muted-foreground">{t('noQuotes')}</span>
                  ) : null}
                </span>
              </label>
              {err('fee') ? <p className="text-sm text-destructive">{err('fee')}</p> : null}
            </fieldset>
          )}
          {fee === 'QUOTE' && !fromFollowUp ? (
            <Field id={id('quote')} label={t('quote')} error={err('quoteId')} required>
              <NativeSelect
                {...controlProps(id('quote'), err('quoteId'))}
                name="quoteId"
                defaultValue={quotes[0]?.id ?? ''}
                required
              >
                {quotes.map((quote) => (
                  <option key={quote.id} value={quote.id}>
                    {quote.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          <Field id={id('note')} label={t('note')} hint={t('noteHint')} error={err('note')}>
            <Textarea
              {...controlProps(id('note'), err('note'), true)}
              name="note"
              rows={2}
              maxLength={CARE_EXTRA_LIMITS.note}
            />
          </Field>
          {assignees.length > 0 ? (
            <Field id={id('assignee')} label={t('assignee')} error={err('assignee')}>
              <NativeSelect
                {...controlProps(id('assignee'), err('assignee'))}
                name="assignee"
                defaultValue=""
              >
                <option value="">{t('nobody')}</option>
                {assignees.map((member) => (
                  <option key={member.membershipId} value={member.membershipId}>
                    {member.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          {err('followUpId') ? (
            <p className="text-sm text-destructive">{err('followUpId')}</p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{t('submit')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
