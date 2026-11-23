'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/** Stampa la comanda (righe, consegna e tarjeta) o la salva in PDF dal browser. */
export function PrintOrderButton({
  label,
  icon,
}: {
  readonly label: string;
  readonly icon: ReactNode;
}) {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      {icon}
      {label}
    </Button>
  );
}
