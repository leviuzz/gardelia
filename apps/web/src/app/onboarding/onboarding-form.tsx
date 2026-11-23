'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { StepIndicator } from '@/components/common/step-indicator';
import { AddressFields } from '@/components/form/address-fields';
import { LegalFields } from '@/components/form/legal-fields';
import { ShopProfileFields } from '@/components/form/shop-profile-fields';
import { Field, controlProps } from '@/components/form/field';
import { FormAlert } from '@/components/form/form-alert';
import { SubmitButton } from '@/components/form/submit-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { firstInvalidControl, firstStepWithError, focusFirstControl } from '@/lib/form-steps';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';

interface Props {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  timezones: readonly { id: string; label: string }[];
  regions: readonly { code: string; name: string }[];
  defaultContactEmail: string;
}

/** I campi dell'indirizzo (`location.*`) sono del secondo passo, gli altri del primo. */
const stepOfField = (name: string) => (name.startsWith('location.') ? 1 : 0);

/**
 * Creazione della fioreria in due passi (un solo modulo): 1) la fioreria, 2) l'indirizzo della
 * tienda con "Crear mi florería". Si passa al secondo solo con il primo valido; se il server
 * segnala un errore nel primo passo, si torna lì.
 */
export function OnboardingForm({ action, timezones, regions, defaultContactEmail }: Props) {
  const t = useTranslations('onboarding');
  const ts = useTranslations('steps');
  const [state, formAction] = useActionState(action, idleState);
  const err = (field: string) => fieldError(state, field);
  const [step, setStep] = useState(0);
  const shopSection = useRef<HTMLDivElement>(null);
  const addressSection = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);

  // Errori del server: si apre il primo passo che ne ha uno (stato aggiornato durante il render
  // quando arriva un nuovo esito, come consiglia React, senza effetti).
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    const errorStep =
      state.status === 'error' ? firstStepWithError(state.fieldErrors, stepOfField) : null;
    if (errorStep !== null) setStep(errorStep);
  }

  const sectionOf = (index: number) => (index === 0 ? shopSection : addressSection).current;

  function goTo(next: number) {
    // Il passo deve essere visibile prima di spostare il cursore.
    flushSync(() => setStep(next));
    top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    focusFirstControl(sectionOf(next));
  }

  /** Mostra l'errore del browser sul campo, aprendo prima il suo passo se è nascosto. */
  function report(index: number, control: ReturnType<typeof firstInvalidControl>): void {
    flushSync(() => setStep(index));
    control?.reportValidity();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Invio (anche con il tasto Enter) dal primo passo = "Continuar".
    if (step === 0) {
      event.preventDefault();
      const invalid = firstInvalidControl(shopSection.current);
      if (invalid) report(0, invalid);
      else goTo(1);
      return;
    }
    for (const index of [0, 1]) {
      const invalid = firstInvalidControl(sectionOf(index));
      if (invalid) {
        event.preventDefault();
        report(index, invalid);
        return;
      }
    }
    preserveOnSubmit(formAction)(event);
  }

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="mt-8 space-y-6">
      <div ref={top} className="scroll-mt-6">
        <StepIndicator
          steps={[
            { key: 'shop', label: t('stepShop') },
            { key: 'address', label: t('stepAddress') },
          ]}
          current={step}
          reachable={step}
          onSelect={goTo}
        />
      </div>
      <FormAlert state={state} />

      <div ref={shopSection} hidden={step !== 0}>
        <Card>
          <CardHeader>
            <CardTitle>{t('stepShop')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <ShopProfileFields
              defaults={{ contactEmail: defaultContactEmail }}
              error={err}
              timezones={timezones}
              displayNameHint={t('displayNameHint')}
            />
            <LegalFields error={err} taxIdHint={t('taxIdHint')} />
            <div className="grid gap-2 sm:col-span-2">
              <span className="text-sm font-medium">{t('country')}</span>
              <p className="rounded-lg border border-dashed bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {t('countryValue')}
              </p>
            </div>
          </CardContent>
        </Card>
        <div className="mt-6 flex justify-end">
          <Button type="submit" size="lg" className="w-full sm:w-auto">
            {ts('continue')}
            <ArrowRight />
          </Button>
        </div>
      </div>

      <div ref={addressSection} hidden={step !== 1}>
        <Card>
          <CardHeader>
            <CardTitle>{t('stepAddress')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-6">
            <AddressFields regions={regions} error={err} namePrefix="location." layout="wide" />
            <Field
              id="deliveryRadiusKm"
              label={t('deliveryRadiusKm')}
              hint={t('deliveryRadiusHint')}
              error={err('location.deliveryRadiusKm')}
              className="sm:col-span-3"
            >
              <Input
                {...controlProps('deliveryRadiusKm', err('location.deliveryRadiusKm'), true)}
                name="location.deliveryRadiusKm"
                type="number"
                inputMode="numeric"
                min={0}
                max={200}
              />
            </Field>
          </CardContent>
        </Card>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => goTo(0)}>
            <ArrowLeft />
            {ts('back')}
          </Button>
          <SubmitButton size="lg" className="w-full sm:w-auto" pendingLabel={t('submitting')}>
            {t('submit')}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
