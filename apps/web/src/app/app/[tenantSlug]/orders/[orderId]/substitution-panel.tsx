'use client';

import { MessageCircle, TriangleExclamationPoint } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { SubstituteReason, SubstitutionMode } from '@floral/domain';
import { SubmitButton } from '@/components/form/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
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
}

export interface SubstitutionLineView {
  readonly lineId: string;
  readonly title: string;
  readonly mode: SubstitutionMode;
  readonly missing: readonly SubstitutionMissingView[];
}

/**
 * "Faltan flores" (ADR-081): cosa manca nei ramos del pedido e con cosa cambiarlo, secondo la
 * regola del ramo. Un form per ingrediente; il servizio ricontrolla tutto.
 */
export function SubstitutionPanel({
  lines,
  action,
  canApply,
}: {
  readonly lines: readonly SubstitutionLineView[];
  readonly action: Action;
  readonly canApply: boolean;
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
  canApply,
}: {
  readonly lineId: string;
  readonly mode: SubstitutionMode;
  readonly missing: SubstitutionMissingView;
  readonly action: Action;
  readonly canApply: boolean;
}) {
  const t = useTranslations('orders.substitution');
  const [state, formAction] = useToastActionState(action);
  const [selected, setSelected] = useState('');
  const groupId = useId();
  const chosen = missing.candidates.find((candidate) => candidate.id === selected) ?? null;
  const toError = fieldError(state, 'toItemId');
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
      onSubmit={preserveOnSubmit(formAction)}
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
          {chosen?.whatsappHref ? (
            <Button asChild variant="outline" size="sm" className="w-full sm:w-fit">
              <a href={chosen.whatsappHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden="true" />
                {t('askWhatsapp')}
              </a>
            </Button>
          ) : null}
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox
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
