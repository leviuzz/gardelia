import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LogoMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('errors');
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <LogoMark className="size-12" />
      <h1 className="font-display text-2xl font-semibold">{t('pageNotFoundTitle')}</h1>
      <p className="text-muted-foreground">{t('pageNotFoundBody')}</p>
      <Button asChild>
        <Link href="/app">{t('goHome')}</Link>
      </Button>
    </main>
  );
}
