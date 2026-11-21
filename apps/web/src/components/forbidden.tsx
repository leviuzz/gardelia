import { ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/** Sezione non accessibile per il ruolo corrente (il server ha già negato l'operazione). */
export async function Forbidden() {
  const t = await getTranslations('errors');
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
        <ShieldCheck className="size-6" aria-hidden="true" />
      </div>
      <h1 className="font-display text-xl font-semibold">{t('forbiddenTitle')}</h1>
      <p className="text-sm text-muted-foreground">{t('forbiddenBody')}</p>
    </div>
  );
}
