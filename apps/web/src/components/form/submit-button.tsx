'use client';

import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@/components/ui/button';

/**
 * Pulsante di invio con stato di attesa (disabilitato durante l'invio). Con `icon`, durante
 * l'invio la rotella prende il posto dell'icona (senza, si aggiunge davanti al testo).
 */
export function SubmitButton({
  children,
  pendingLabel,
  icon,
  disabled,
  ...props
}: ButtonProps & { pendingLabel?: string; icon?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending} {...props}>
      {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : icon}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
