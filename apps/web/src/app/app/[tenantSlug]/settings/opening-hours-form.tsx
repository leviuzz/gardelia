'use client';

import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useId, useRef, useState } from 'react';
import { OPENING_HOURS_LIMITS, openingDayField, type Weekday } from '@floral/domain';
import { SubmitButton } from '@/components/form/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { useActionToast } from '@/lib/use-action-toast';
import { cn } from '@/lib/utils';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const TIME_INPUT =
  'px-2 max-sm:[&::-webkit-calendar-picker-indicator]:hidden sm:w-[8.5rem] sm:px-3';

interface Range {
  /** Chiave stabile della riga (React), non va al server. */
  readonly key: number;
  readonly start: string;
  readonly end: string;
}

interface DayState {
  readonly weekday: Weekday;
  readonly label: string;
  readonly ranges: readonly Range[];
}

/** Proposta per un giorno che si apre: le fasce del giorno aperto più vicino prima, o 09:00–19:00. */
function proposedRanges(
  days: readonly DayState[],
  index: number,
): { start: string; end: string }[] {
  for (let i = index - 1; i >= 0; i -= 1) {
    const ranges = days[i]?.ranges ?? [];
    if (ranges.length > 0) return ranges.map(({ start, end }) => ({ start, end }));
  }
  for (const day of days) {
    if (day.ranges.length > 0) return day.ranges.map(({ start, end }) => ({ start, end }));
  }
  return [{ start: '09:00', end: '19:00' }];
}

/**
 * "Horario de atención": per ogni giorno (da lunedì) l'interruttore "Abierto" e quante fasce
 * servono. Le fasce viaggiano come `d1.start`/`d1.end` ripetuti, nello stesso ordine; un giorno
 * chiuso non manda nulla. Gli errori arrivano per fascia (`d1.0`) o per giorno (`d1`).
 */
export function OpeningHoursForm({
  action,
  days: initialDays,
}: {
  action: Action;
  /** Da lunedì a domenica, con le fasce in "HH:MM". */
  days: readonly {
    readonly weekday: Weekday;
    readonly label: string;
    readonly ranges: readonly { readonly start: string; readonly end: string }[];
  }[];
}) {
  const t = useTranslations('settings.hours');
  const tc = useTranslations('common');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const baseId = useId();
  // Le righe iniziali hanno chiavi per giorno e posizione; quelle aggiunte, dal contatore.
  const keyCounter = useRef(10_000);
  const [days, setDays] = useState<DayState[]>(() =>
    initialDays.map((day) => ({
      ...day,
      ranges: day.ranges.map((range, i) => ({ ...range, key: day.weekday * 100 + i })),
    })),
  );

  function freshKeys(count: number): number[] {
    return Array.from({ length: count }, () => keyCounter.current++);
  }

  function updateDay(index: number, change: (day: DayState) => DayState) {
    setDays((current) => current.map((day, i) => (i === index ? change(day) : day)));
  }

  function toggleDay(index: number, open: boolean) {
    if (!open) {
      updateDay(index, (day) => ({ ...day, ranges: [] }));
      return;
    }
    const proposed = proposedRanges(days, index);
    const keys = freshKeys(proposed.length);
    updateDay(index, (day) => ({
      ...day,
      ranges: proposed.map((range, i) => ({ ...range, key: keys[i] ?? i })),
    }));
  }

  function addRange(index: number) {
    const [key = 0] = freshKeys(1);
    updateDay(index, (day) => {
      const last = day.ranges[day.ranges.length - 1];
      // La nuova fascia parte dopo l'ultima: chi chiude a pranzo scrive solo il pomeriggio.
      return {
        ...day,
        ranges: [...day.ranges, { key, start: last ? last.end : '09:00', end: '' }],
      };
    });
  }

  function removeRange(index: number, key: number) {
    updateDay(index, (day) => ({
      ...day,
      ranges: day.ranges.filter((range) => range.key !== key),
    }));
  }

  function setTime(index: number, key: number, field: 'start' | 'end', value: string) {
    updateDay(index, (day) => ({
      ...day,
      ranges: day.ranges.map((range) => (range.key === key ? { ...range, [field]: value } : range)),
    }));
  }

  return (
    <form action={formAction} className="grid gap-5">
      <ul className="divide-y sm:rounded-xl sm:border">
        {days.map((day, index) => {
          const field = openingDayField(day.weekday);
          const open = day.ranges.length > 0;
          const dayError = fieldError(state, field);
          const switchId = `${baseId}-${field}-open`;
          return (
            <li
              key={day.weekday}
              className="grid gap-3 py-4 first:pt-0 sm:grid-cols-[9rem_1fr] sm:p-4 sm:first:pt-4"
            >
              <div className="flex items-center justify-between gap-3 sm:items-start sm:pt-1.5">
                <span className="font-medium">{day.label}</span>
              </div>
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <DaySwitch
                    id={switchId}
                    on={open}
                    label={t('openDay', { day: day.label })}
                    onChange={(value) => toggleDay(index, value)}
                  />
                  <span className="text-sm text-muted-foreground">
                    {open ? t('open') : t('closed')}
                  </span>
                </div>
                {day.ranges.map((range, position) => {
                  const error = fieldError(state, `${field}.${position}`);
                  const errorId = `${baseId}-${field}-${range.key}-error`;
                  const n = position + 1;
                  return (
                    <div key={range.key} className="grid gap-1">
                      {/* Su telefono le due ore occupano tutta la riga (senza l'icona dell'orologio:
                          il selettore si apre toccando il campo). */}
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-1.5 sm:flex sm:gap-2">
                        <Input
                          type="time"
                          name={`${field}.start`}
                          value={range.start}
                          onChange={(event) =>
                            setTime(index, range.key, 'start', event.target.value)
                          }
                          aria-label={t('from', { day: day.label, n })}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? errorId : undefined}
                          className={TIME_INPUT}
                        />
                        <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
                          –
                        </span>
                        <Input
                          type="time"
                          name={`${field}.end`}
                          value={range.end}
                          onChange={(event) => setTime(index, range.key, 'end', event.target.value)}
                          aria-label={t('to', { day: day.label, n })}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? errorId : undefined}
                          className={TIME_INPUT}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeRange(index, range.key)}
                          aria-label={t('removeRange', { day: day.label, n })}
                        >
                          <X />
                        </Button>
                      </div>
                      {error ? (
                        <p id={errorId} className="text-sm text-destructive">
                          {error}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                {open && day.ranges.length < OPENING_HOURS_LIMITS.rangesPerDay ? (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => addRange(index)}
                      aria-label={t('addRangeFor', { day: day.label })}
                    >
                      <Plus />
                      {t('addRange')}
                    </Button>
                  </div>
                ) : null}
                {dayError ? <p className="text-sm text-destructive">{dayError}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div>
        <SubmitButton>{tc('saveChanges')}</SubmitButton>
      </div>
    </form>
  );
}

function DaySwitch({
  id,
  on,
  label,
  onChange,
}: {
  id: string;
  on: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        // Area di tocco di 44 px attorno all'interruttore.
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none before:absolute before:-inset-2.5 focus-visible:ring-[3px] focus-visible:ring-ring/40',
        on ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'block size-5 rounded-full bg-card shadow-sm transition-transform',
          on ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
