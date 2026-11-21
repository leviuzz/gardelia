'use client';

import { startTransition, type FormEvent } from 'react';

/**
 * React 19 azzera i campi non controllati di un <form action={fn}> PRIMA di eseguire
 * l'action, anche quando questa restituisce errori di validazione: l'utente perderebbe
 * ciò che ha scritto. Gestendo noi il submit dentro una transizione, React mantiene lo
 * stato "pending" (useFormStatus continua a funzionare) ma non resetta il form.
 * Senza JavaScript il form resta comunque inviabile tramite l'attributo action.
 */
export function preserveOnSubmit(formAction: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(formData));
  };
}
