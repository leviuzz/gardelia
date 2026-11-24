'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Stampa la pagina (o la salva in PDF dal browser). Non compare nella stampa. */
export function PrintButton({ label }: { readonly label: string }) {
  return (
    <Button type="button" variant="outline" className="print:hidden" onClick={() => window.print()}>
      <Printer />
      {label}
    </Button>
  );
}
