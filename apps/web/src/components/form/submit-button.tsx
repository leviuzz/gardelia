'use client';

import { LoaderCircle } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@/components/ui/button';

/** Pulsante di invio con stato di attesa (disabilitato durante l'invio). */
export function SubmitButton({
  children,
  pendingLabel,
  disabled,
  ...props
}: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending} {...props}>
      {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
