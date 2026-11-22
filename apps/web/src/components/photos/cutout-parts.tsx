'use client';

import { Scissors } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ActionButton } from '@/components/form/action-button';
import type { ActionState } from '@/lib/action-state';

/** Intervallo e durata massima dell'aggiornamento automatico mentre si toglie il fondo. */
const REFRESH_EVERY_MS = 2500;
const REFRESH_FOR_MS = 120_000;

/**
 * Mentre qualche foto è "Quitando el fondo…" aggiorna la pagina finché cambia stato, per al
 * massimo due minuti (se il lavoro tarda, lo stato si vede al prossimo caricamento).
 */
export function CutoutAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > REFRESH_FOR_MS) clearInterval(timer);
      else router.refresh();
    }, REFRESH_EVERY_MS);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}

/** "Quitar el fondo" / "Reintentar" su una foto, con toast di esito. */
export function RequestCutoutButton({
  action,
  label,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
}) {
  return (
    <ActionButton action={action} variant="outline" size="sm" icon={<Scissors />}>
      {label}
    </ActionButton>
  );
}
