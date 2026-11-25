'use client';

/**
 * La visita dal telefono (ADR-078): ogni riga è un piccolo form che salva da sola (sul posto il
 * segnale può mancare: quello già salvato resta). La pagina si ricarica dal server dopo ogni passo,
 * quindi le righe mostrano sempre lo stato salvato; durante l'invio la riga è in attesa.
 */
import { Check, CheckCheck, Flag, Plus, ScanSearch, Send, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  CARE_FOLLOW_UP_KINDS,
  CARE_LIMITS,
  CARE_NOT_DONE_CAUSES,
  CARE_PLANT_CONDITIONS,
  CARE_VISIT_LIMITS,
  type CareFollowUpKind,
  type CarePlantCondition,
  type CareServiceOutcome,
} from '@floral/domain';
import { ActionButton } from '@/components/form/action-button';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Badge } from '@/components/ui/badge';
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
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';
import { cn } from '@/lib/utils';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const toggle = 'min-w-0 flex-1 justify-center sm:flex-none';

// -----------------------------------------------------------------------------
// Servizi
// -----------------------------------------------------------------------------

export interface ChecklistItemView {
  readonly serviceId: string;
  readonly name: string;
  readonly outcome: CareServiceOutcome | null;
  readonly note: string | null;
}

/** Un servizio della checklist: "Hecho" o "No se hizo"; toccare di nuovo la scelta la toglie. */
export function ServiceChecklistItem({
  action,
  item,
  disabled = false,
}: {
  readonly action: Action;
  readonly item: ChecklistItemView;
  readonly disabled?: boolean;
}) {
  const t = useTranslations('care.visitWork');
  const [state, formAction, pending] = useToastActionState(action);
  const noteError = fieldError(state, 'note');
  const noteId = `service-${item.serviceId}-note`;
  return (
    <li className="grid gap-2 px-4 py-3" aria-busy={pending}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 font-medium break-words">{item.name}</p>
        <form action={formAction} className="flex gap-1.5">
          <input type="hidden" name="serviceId" value={item.serviceId} />
          <Button
            type="submit"
            name="outcome"
            value={item.outcome === 'DONE' ? '' : 'DONE'}
            size="sm"
            variant={item.outcome === 'DONE' ? 'default' : 'outline'}
            aria-pressed={item.outcome === 'DONE'}
            disabled={pending || disabled}
            className={toggle}
          >
            <Check />
            {t('serviceDone')}
          </Button>
          <Button
            type="submit"
            name="outcome"
            value={item.outcome === 'SKIPPED' ? '' : 'SKIPPED'}
            size="sm"
            variant={item.outcome === 'SKIPPED' ? 'secondary' : 'outline'}
            aria-pressed={item.outcome === 'SKIPPED'}
            disabled={pending || disabled}
            className={toggle}
          >
            <X />
            {t('serviceSkipped')}
          </Button>
        </form>
      </div>
      {item.outcome === 'SKIPPED' ? (
        <form
          action={formAction}
          onSubmit={preserveOnSubmit(formAction)}
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
        >
          <input type="hidden" name="serviceId" value={item.serviceId} />
          <input type="hidden" name="outcome" value="SKIPPED" />
          <Field id={noteId} label={t('skippedWhy')} error={noteError} className="min-w-0">
            <Input
              {...controlProps(noteId, noteError)}
              name="note"
              defaultValue={item.note ?? ''}
              maxLength={CARE_VISIT_LIMITS.resultNote}
            />
          </Field>
          <SubmitButton variant="secondary" size="sm" className="sm:mt-6" disabled={disabled}>
            {t('save')}
          </SubmitButton>
        </form>
      ) : null}
    </li>
  );
}

// -----------------------------------------------------------------------------
// Piante
// -----------------------------------------------------------------------------

export interface PlantItemView {
  readonly plantId: string;
  readonly name: string;
  readonly quantity: number;
  /** "Mediana · Pothos · Recepción": già formattato. */
  readonly details: string;
  readonly instructions: string | null;
  readonly condition: CarePlantCondition | null;
  readonly affected: number | null;
  readonly note: string | null;
  /** Pianta del cambio di stagione (ADR-078). */
  readonly seasonal?: boolean;
  /** «Preguntar al asistente» (ADR-085) se la pianta non sta bene; null senza assistente. */
  readonly assistantHref?: string | null;
}

const CONDITION_STYLE: Record<CarePlantCondition, string> = {
  OK: 'aria-pressed:border-success aria-pressed:bg-success-soft aria-pressed:font-semibold',
  ATTENTION: 'aria-pressed:border-warning aria-pressed:bg-warning-soft aria-pressed:font-semibold',
  PROBLEM:
    'aria-pressed:border-destructive aria-pressed:bg-danger-soft aria-pressed:font-semibold aria-pressed:text-destructive',
  DEAD: 'aria-pressed:border-foreground aria-pressed:bg-muted aria-pressed:font-semibold',
};

/** Una pianta (o un gruppo): come sta; se non sta bene, quante sono toccate e una nota. */
export function PlantChecklistItem({
  action,
  plant,
}: {
  readonly action: Action;
  readonly plant: PlantItemView;
}) {
  const t = useTranslations('care.visitWork');
  const tAssistant = useTranslations('assistant.card');
  const [state, formAction, pending] = useToastActionState(action);
  const affectedError = fieldError(state, 'affected');
  const noteError = fieldError(state, 'note');
  const prefix = `plant-${plant.plantId}`;
  const showDetails = plant.condition !== null && plant.condition !== 'OK';
  return (
    <li className="grid gap-2.5 px-4 py-3" aria-busy={pending}>
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium break-words">
          <span className="tabular-nums">{plant.quantity}</span> × {plant.name}
          {plant.seasonal ? (
            <Badge variant="accent" className="ml-2 align-middle">
              {t('seasonal')}
            </Badge>
          ) : null}
        </p>
        {plant.details ? <p className="text-xs text-muted-foreground">{plant.details}</p> : null}
        {plant.instructions ? (
          <p className="text-xs whitespace-pre-line">{plant.instructions}</p>
        ) : null}
      </div>
      <form
        action={formAction}
        className="grid grid-cols-2 gap-1.5 sm:grid-cols-4"
        aria-label={t('conditionLabel', { name: plant.name })}
      >
        <input type="hidden" name="plantId" value={plant.plantId} />
        {CARE_PLANT_CONDITIONS.map((condition) => (
          <Button
            key={condition}
            type="submit"
            name="condition"
            value={condition}
            size="sm"
            variant="outline"
            aria-pressed={plant.condition === condition}
            disabled={pending}
            className={cn('justify-center', CONDITION_STYLE[condition])}
          >
            {t(`conditions.${condition}`)}
          </Button>
        ))}
      </form>
      {plant.assistantHref && (plant.condition === 'ATTENTION' || plant.condition === 'PROBLEM') ? (
        <Button asChild size="sm" variant="secondary" className="justify-self-start">
          <Link href={plant.assistantHref}>
            <ScanSearch aria-hidden="true" />
            {tAssistant('askVisitPlant')}
          </Link>
        </Button>
      ) : null}
      {showDetails ? (
        <form
          action={formAction}
          onSubmit={preserveOnSubmit(formAction)}
          className="grid gap-2 rounded-xl border bg-muted/30 p-3"
        >
          <input type="hidden" name="plantId" value={plant.plantId} />
          <input type="hidden" name="condition" value={plant.condition ?? ''} />
          {plant.quantity > 1 ? (
            <Field
              id={`${prefix}-affected`}
              label={t('affected', { count: plant.quantity })}
              error={affectedError}
            >
              <Input
                {...controlProps(`${prefix}-affected`, affectedError)}
                name="affected"
                type="number"
                inputMode="numeric"
                min={1}
                max={plant.quantity}
                defaultValue={plant.affected ?? ''}
                className="w-28"
              />
            </Field>
          ) : null}
          <Field id={`${prefix}-note`} label={t('plantNote')} error={noteError}>
            <Input
              {...controlProps(`${prefix}-note`, noteError)}
              name="note"
              defaultValue={plant.note ?? ''}
              maxLength={CARE_VISIT_LIMITS.resultNote}
            />
          </Field>
          <SubmitButton variant="secondary" size="sm" className="justify-self-start">
            {t('save')}
          </SubmitButton>
        </form>
      ) : null}
    </li>
  );
}

/** "Todas bien": segna "Bien" le piante ancora senza stato. */
export function AllPlantsOkButton({
  action,
  className,
}: {
  readonly action: Action;
  readonly className?: string;
}) {
  const t = useTranslations('care.visitWork');
  return (
    <ActionButton action={action} variant="secondary" icon={<CheckCheck />} className={className}>
      {t('allOk')}
    </ActionButton>
  );
}

// -----------------------------------------------------------------------------
// Materiali
// -----------------------------------------------------------------------------

export interface MaterialView {
  readonly catalogItemId: string;
  readonly name: string;
  readonly quantity: number;
}

export interface MaterialOptionView {
  readonly catalogItemId: string;
  /** "Fertilizante líquido · 3 en existencia": già formattato. */
  readonly label: string;
}

/** I materiali usati: escono dall'inventario tutti insieme a "Terminar visita". */
export function MaterialsEditor({
  action,
  materials,
  options,
}: {
  readonly action: Action;
  readonly materials: readonly MaterialView[];
  readonly options: readonly MaterialOptionView[];
}) {
  const t = useTranslations('care.visitWork');
  const [state, formAction] = useToastActionState(action);
  const itemError = fieldError(state, 'catalogItemId');
  const quantityError = fieldError(state, 'quantity');
  return (
    <div className="grid gap-4">
      {materials.length > 0 ? (
        <ul className="divide-y rounded-xl border text-sm">
          {materials.map((material) => (
            <li
              key={material.catalogItemId}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
            >
              <span className="min-w-0 break-words">
                <span className="tabular-nums">{material.quantity}</span> × {material.name}
              </span>
              <form action={formAction}>
                <input type="hidden" name="catalogItemId" value={material.catalogItemId} />
                <input type="hidden" name="quantity" value="0" />
                <SubmitButton
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('materialRemove', { name: material.name })}
                  title={t('materialRemove', { name: material.name })}
                  icon={<Trash2 />}
                />
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('materialsNone')}</p>
      ) : (
        <form
          action={formAction}
          onSubmit={preserveOnSubmit(formAction)}
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end"
        >
          <Field id="material-item" label={t('materialItem')} error={itemError} className="min-w-0">
            <NativeSelect
              {...controlProps('material-item', itemError)}
              name="catalogItemId"
              defaultValue=""
            >
              <option value="" disabled>
                {t('materialPick')}
              </option>
              {options.map((option) => (
                <option key={option.catalogItemId} value={option.catalogItemId}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="material-quantity" label={t('materialQuantity')} error={quantityError}>
            <Input
              {...controlProps('material-quantity', quantityError)}
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={CARE_VISIT_LIMITS.materialQuantity}
              defaultValue="1"
            />
          </Field>
          <SubmitButton variant="secondary" icon={<Plus />}>
            {t('materialAdd')}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Nota per il cliente e avvisi per chi gestisce
// -----------------------------------------------------------------------------

/** La nota che il cliente legge nel resoconto. */
export function VisitNoteForm({
  action,
  note,
}: {
  readonly action: Action;
  readonly note: string | null;
}) {
  const t = useTranslations('care.visitWork');
  const [state, formAction] = useToastActionState(action);
  const error = fieldError(state, 'note');
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-3">
      <Field id="visit-note" label={t('noteLabel')} hint={t('noteHint')} error={error}>
        <Textarea
          {...controlProps('visit-note', error)}
          name="note"
          rows={3}
          defaultValue={note ?? ''}
          maxLength={CARE_LIMITS.notes}
        />
      </Field>
      <SubmitButton variant="secondary" className="justify-self-start">
        {t('noteSave')}
      </SubmitButton>
    </form>
  );
}

export interface PlantOptionView {
  readonly plantId: string;
  readonly name: string;
}

/** Un avviso per chi gestisce: una pianta da reponer, un extra chiesto dal cliente, altro. */
export function FollowUpForm({
  action,
  plants,
}: {
  readonly action: Action;
  readonly plants: readonly PlantOptionView[];
}) {
  const t = useTranslations('care.followUps');
  const [kind, setKind] = useState<CareFollowUpKind>('EXTRA');
  const [state, formAction] = useToastActionState(action);
  const noteError = fieldError(state, 'note');
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="follow-up-kind" label={t('kind')}>
          <NativeSelect
            id="follow-up-kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as CareFollowUpKind)}
          >
            {CARE_FOLLOW_UP_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`kinds.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {kind === 'REPLACEMENT' && plants.length > 0 ? (
          <Field id="follow-up-plant" label={t('plant')}>
            <NativeSelect id="follow-up-plant" name="plantId" defaultValue="">
              <option value="">{t('noPlant')}</option>
              {plants.map((plant) => (
                <option key={plant.plantId} value={plant.plantId}>
                  {plant.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </div>
      <Field id="follow-up-note" label={t('note')} error={noteError} required>
        <Textarea
          {...controlProps('follow-up-note', noteError, true)}
          name="note"
          rows={2}
          maxLength={CARE_VISIT_LIMITS.followUpNote}
          placeholder={t(`placeholders.${kind}`)}
        />
      </Field>
      <SubmitButton variant="secondary" icon={<Flag />} className="justify-self-start">
        {t('submit')}
      </SubmitButton>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Terminar / No se pudo
// -----------------------------------------------------------------------------

export interface ReportChannelView {
  /** La fioreria può scrivere ai clienti (LIVE). */
  readonly emailsAllowed: boolean;
  /** Il cliente ha l'email. */
  readonly customerHasEmail: boolean;
}

function ReportCheckbox({
  id,
  channel,
}: {
  readonly id: string;
  readonly channel: ReportChannelView;
}) {
  const t = useTranslations('care.visitWork');
  if (!channel.emailsAllowed) {
    return <p className="rounded-xl border bg-muted/40 p-3 text-sm">{t('reportDemoHint')}</p>;
  }
  if (!channel.customerHasEmail) {
    return <p className="rounded-xl border bg-muted/40 p-3 text-sm">{t('reportNoEmailHint')}</p>;
  }
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm">
      <Checkbox id={id} name="sendReport" value="on" defaultChecked className="mt-0.5" />
      <span>{t('sendReport')}</span>
    </label>
  );
}

/**
 * "Terminar visita": riepilogo, la casella del resoconto per email e, se ci sono materiali, quella
 * per registrarli anche se manca giacenza. Al ritiro del cambio di stagione, la casella (attiva)
 * per archiviare le piante di temporada. Se mancano piante da segnare, il server lo dice.
 */
export function FinishVisitDialog({
  action,
  allOkAction,
  summary,
  unmarked,
  hasMaterials,
  channel,
  seasonalPlants = null,
}: {
  readonly action: Action;
  readonly allOkAction: Action;
  /** "Servicios 3/4 · Plantas 10/10 · Fotos 4": già formattato. */
  readonly summary: string;
  /** Piante ancora senza stato. */
  readonly unmarked: number;
  readonly hasMaterials: boolean;
  readonly channel: ReportChannelView;
  /** Visita di ritiro: quante piante di temporada ci sono ancora (null se non è un ritiro). */
  readonly seasonalPlants?: number | null;
}) {
  const t = useTranslations('care.visitWork');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [, formAction] = useToastActionState(action, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="w-full sm:w-auto">
          <Check />
          {t('finish')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('finishTitle')}</DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>
        {unmarked > 0 ? (
          <div className="grid gap-2 rounded-xl border bg-warning-soft/60 p-3 text-sm">
            <p>{t('finishUnmarked', { count: unmarked })}</p>
            <AllPlantsOkButton action={allOkAction} className="justify-self-start" />
          </div>
        ) : null}
        <form action={formAction} className="grid gap-4">
          <ReportCheckbox id="finish-send-report" channel={channel} />
          {hasMaterials ? (
            <label
              htmlFor="finish-confirm-shortage"
              className="flex cursor-pointer items-start gap-2.5 text-sm"
            >
              <Checkbox
                id="finish-confirm-shortage"
                name="confirmShortage"
                value="on"
                className="mt-0.5"
              />
              <span>{t('confirmShortage')}</span>
            </label>
          ) : null}
          {seasonalPlants ? (
            <label
              htmlFor="finish-archive-seasonal"
              className="flex cursor-pointer items-start gap-2.5 text-sm"
            >
              <Checkbox
                id="finish-archive-seasonal"
                name="archiveSeasonal"
                value="on"
                defaultChecked
                className="mt-0.5"
              />
              <span>{t('archiveSeasonal', { count: seasonalPlants })}</span>
            </label>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton icon={<Check />} className="w-full sm:w-auto">
              {t('finishSubmit')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "No se pudo": perché (il cliente non ha aperto e la visita si paga, oppure la fioreria non è
 * potuta andare ed è un credito, ADR-082), la nota per il cliente e, se si può, il resoconto.
 */
export function NotDoneDialog({
  action,
  label,
  note,
  channel,
  compact,
}: {
  readonly action: Action;
  /** "SUS-0001 · Hotel Jardín" per il titolo. */
  readonly label: string;
  readonly note: string | null;
  readonly channel: ReportChannelView | null;
  readonly compact?: boolean;
}) {
  const t = useTranslations('care.visit');
  const tw = useTranslations('care.visitWork');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const error = fieldError(state, 'note');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={compact ? 'sm' : 'default'}
          className={compact ? undefined : 'w-full sm:w-auto'}
        >
          <X />
          {t('notDone')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('notDoneTitle', { label })}</DialogTitle>
          <DialogDescription>{t('notDoneBody')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('notDoneCause')}</legend>
            {CARE_NOT_DONE_CAUSES.map((cause) => (
              <label
                key={cause}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="cause"
                  value={cause}
                  defaultChecked={cause === 'CUSTOMER'}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  <span className="block font-medium">{t(`notDoneCauses.${cause}`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`notDoneCauseHints.${cause}`)}
                  </span>
                </span>
              </label>
            ))}
            {fieldError(state, 'cause') ? (
              <p className="text-sm text-destructive">{fieldError(state, 'cause')}</p>
            ) : null}
          </fieldset>
          <Field id="not-done-note" label={tw('notDoneNote')} error={error}>
            <Textarea
              {...controlProps('not-done-note', error)}
              name="note"
              rows={3}
              defaultValue={note ?? ''}
              maxLength={CARE_LIMITS.notes}
            />
          </Field>
          {channel ? <ReportCheckbox id="not-done-send-report" channel={channel} /> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{t('notDoneSubmit')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Enviar reporte por correo" / "Reintentar". */
export function SendReportButton({
  action,
  retry,
}: {
  readonly action: Action;
  readonly retry: boolean;
}) {
  const t = useTranslations('care.visitWork');
  return (
    <ActionButton action={action} variant="secondary" icon={<Send />}>
      {retry ? t('reportRetry') : t('reportSend')}
    </ActionButton>
  );
}
