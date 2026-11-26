'use client';

import {
  Check,
  CircleHelp,
  MessageCircle,
  MessageSquare,
  TriangleExclamationPoint,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { OrderQuestionAnswer, SubstituteReason, SubstitutionMode } from '@floral/domain';
import { SubmitButton } from '@/components/form/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmitByIntent } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface SubstitutionCandidateView {
  readonly id: string;
  readonly label: string;
  readonly reason: SubstituteReason;
  /** "Pocas" / "Bajo pedido", già tradotto; null se disponibile. */
  readonly availabilityNote: string | null;
  /** WhatsApp al cliente con la proposta, nella lingua del mercato; null senza telefono. */
  readonly whatsappHref: string | null;
}

export interface SubstitutionMissingView {
  readonly itemId: string;
  readonly label: string;
  /** "24 tallos". */
  readonly quantityLabel: string;
  /** "Agotado en el catálogo" / "Faltan 7 tallos en el inventario". */
  readonly problemLabel: string;
  readonly candidates: readonly SubstitutionCandidateView[];
  /**
   * M3-2: l'ultima domanda «Chiedi nell'app» per questo fiore (il fiore proposto e la risposta di
   * chi compra, null finché non risponde); null se non è stata fatta.
   */
  readonly askedInApp: {
    readonly toItemId: string;
    readonly answer: OrderQuestionAnswer | null;
  } | null;
}

export interface SubstitutionLineView {
  readonly lineId: string;
  readonly title: string;
  readonly mode: SubstitutionMode;
  readonly missing: readonly SubstitutionMissingView[];
}

/**
 * "Faltan flores" (ADR-081): cosa manca nei ramos del pedido e con cosa cambiarlo, secondo la
 * regola del ramo. Un form per ingrediente; il servizio ricontrolla tutto. Sugli ordini online con il
 * filo aperto (M3-2), per i ramos che chiedono l'ok del cliente, «Chiedi nell'app» manda la domanda
 * «sì / no» preparata dal server; con il «Sí» la casella «Il cliente ha accettato» è già spuntata.
 */
export function SubstitutionPanel({
  lines,
  action,
  canApply,
  askAction = null,
}: {
  readonly lines: readonly SubstitutionLineView[];
  readonly action: Action;
  readonly canApply: boolean;
  /** «Chiedi nell'app», già legato all'ordine; null se l'ordine non ha il filo con chi compra. */
  readonly askAction?: Action | null;
}) {
  const t = useTranslations('orders.substitution');
  return (
    <Card className="border-warning/50 print:hidden" data-testid="order-substitutions">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TriangleExclamationPoint className="size-5 text-warning" aria-hidden="true" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {lines.map((line) => (
          <section key={line.lineId} className="grid gap-3" aria-label={line.title}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium break-words">{line.title}</h3>
              <Badge variant={line.mode === 'NOT_ALLOWED' ? 'danger' : 'secondary'}>
                {t(`mode.${line.mode}`)}
              </Badge>
            </div>
            {line.missing.map((missing) => (
              <MissingIngredient
                key={missing.itemId}
                lineId={line.lineId}
                mode={line.mode}
                missing={missing}
                action={action}
                askAction={askAction}
                canApply={canApply}
              />
            ))}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function MissingIngredient({
  lineId,
  mode,
  missing,
  action,
  askAction,
  canApply,
}: {
  readonly lineId: string;
  readonly mode: SubstitutionMode;
  readonly missing: SubstitutionMissingView;
  readonly action: Action;
  readonly askAction: Action | null;
  readonly canApply: boolean;
}) {
  const t = useTranslations('orders.substitution');
  const [state, formAction] = useToastActionState(action);
  const [askState, askFormAction] = useToastActionState(askAction ?? action);
  const asked = missing.askedInApp;
  // Il fiore chiesto nell'app parte già scelto, così il «Sí» del cliente vale per quello.
  const [selected, setSelected] = useState(asked?.toItemId ?? '');
  const askedFor = asked && asked.toItemId === selected ? asked : null;
  const askedLabel = asked
    ? (missing.candidates.find((candidate) => candidate.id === asked.toItemId)?.label ?? null)
    : null;
  const groupId = useId();
  const chosen = missing.candidates.find((candidate) => candidate.id === selected) ?? null;
  const toError = fieldError(state, 'toItemId') ?? fieldError(askState, 'toItemId');
  const agreedError = fieldError(state, 'customerAgreed');

  const header = (
    <p className="text-sm">
      <span className="font-medium">{missing.label}</span>
      <span className="text-muted-foreground"> · {missing.quantityLabel}</span>
      <span className="block text-[oklch(0.45_0.17_27)]">{missing.problemLabel}</span>
    </p>
  );

  if (mode === 'NOT_ALLOWED') {
    return (
      <div className="grid gap-1 rounded-xl border p-3">
        {header}
        <p className="text-sm text-muted-foreground">{t('notAllowedHint')}</p>
      </div>
    );
  }
  if (missing.candidates.length === 0) {
    return (
      <div className="grid gap-1 rounded-xl border p-3">
        {header}
        <p className="text-sm text-muted-foreground">{t('noCandidates')}</p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmitByIntent(formAction, { ask: askFormAction })}
      className="grid gap-3 rounded-xl border p-3"
    >
      {header}
      <input type="hidden" name="lineId" value={lineId} />
      <input type="hidden" name="fromItemId" value={missing.itemId} />
      <fieldset
        className="grid gap-2"
        aria-describedby={toError ? `${groupId}-error` : undefined}
        disabled={!canApply}
      >
        <legend className="mb-1 text-sm font-medium">{t('chooseLabel')}</legend>
        {missing.candidates.map((candidate) => (
          <label
            key={candidate.id}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30"
          >
            <input
              type="radio"
              name="toItemId"
              value={candidate.id}
              checked={selected === candidate.id}
              onChange={() => setSelected(candidate.id)}
              className="mt-0.5 accent-[var(--primary)]"
            />
            <span className="min-w-0">
              <span className="block font-medium break-words">{candidate.label}</span>
              <span className="block text-xs text-muted-foreground">
                {t(`reason.${candidate.reason}`)}
                {candidate.availabilityNote ? ` · ${candidate.availabilityNote}` : ''}
              </span>
            </span>
          </label>
        ))}
        {toError ? (
          <p id={`${groupId}-error`} className="text-sm text-destructive">
            {toError}
          </p>
        ) : null}
      </fieldset>

      {mode === 'ASK_CUSTOMER' && canApply ? (
        <div className="grid gap-2 rounded-lg bg-muted/60 p-3 text-sm">
          <p>{t('askHint')}</p>
          {asked && askedLabel ? (
            <p
              className="flex items-start gap-2 font-medium"
              data-testid="substitution-asked-in-app"
            >
              {asked.answer === 'YES' ? (
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : asked.answer === 'NO' ? (
                <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              ) : (
                <CircleHelp className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              )}
              <span>
                {asked.answer === 'YES'
                  ? t('askedYes', { to: askedLabel })
                  : asked.answer === 'NO'
                    ? t('askedNo', { to: askedLabel })
                    : t('askedWaiting', { to: askedLabel })}
              </span>
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {askAction && chosen && !(askedFor && askedFor.answer === null) ? (
              <SubmitButton
                formAction={askFormAction}
                data-intent="ask"
                variant="outline"
                size="sm"
                className="w-full sm:w-fit"
                icon={<MessageSquare aria-hidden="true" />}
                data-testid="substitution-ask-in-app"
              >
                {t('askInApp')}
              </SubmitButton>
            ) : null}
            {chosen?.whatsappHref ? (
              <Button asChild variant="outline" size="sm" className="w-full sm:w-fit">
                <a href={chosen.whatsappHref} target="_blank" rel="noopener noreferrer">
                  <MessageCircle aria-hidden="true" />
                  {t('askWhatsapp')}
                </a>
              </Button>
            ) : null}
          </div>
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox
              // Il «Sí» nell'app per il fiore scelto spunta la casella (si può sempre togliere).
              key={selected}
              defaultChecked={askedFor?.answer === 'YES'}
              name="customerAgreed"
              className="mt-0.5"
              aria-invalid={agreedError ? true : undefined}
              aria-describedby={agreedError ? `${groupId}-agreed-error` : undefined}
            />
            <span>{t('customerAgreed')}</span>
          </label>
          {agreedError ? (
            <p id={`${groupId}-agreed-error`} className="text-destructive">
              {agreedError}
            </p>
          ) : null}
        </div>
      ) : null}

      {canApply ? (
        <SubmitButton size="sm" className="w-full sm:w-fit" pendingLabel={t('applying')}>
          {t('apply')}
        </SubmitButton>
      ) : (
        <p className="text-sm text-muted-foreground">{t('askManager')}</p>
      )}
    </form>
  );
}
