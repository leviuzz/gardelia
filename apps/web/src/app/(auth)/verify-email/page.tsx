import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { ResendVerification } from '@/components/auth/resend-verification';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getSession, safeNextPath } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('checkEmailTitle') };
}

/**
 * Destinazione del link di verifica email (Better Auth reindirizza qui).
 * Successo → sessione creata automaticamente → prosegue; errore → ?error=CODICE.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps<'/verify-email'>) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null);
  const error = typeof params.error === 'string' ? params.error : null;
  if (!error && (await getSession())) redirect(next);

  const t = await getTranslations('auth');
  if (error) {
    return (
      <AuthCard title={t('verifyInvalidTitle')}>
        <div className="space-y-5">
          <Alert variant="destructive">
            <AlertDescription>{t('errors.INVALID_TOKEN')}</AlertDescription>
          </Alert>
          <ResendVerification defaultEmail="" next={next} />
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('verifiedTitle')} subtitle={t('verifiedBody')}>
      <Button asChild className="w-full" size="lg">
        <Link href={`/login?next=${encodeURIComponent(next)}`}>{t('loginButton')}</Link>
      </Button>
    </AuthCard>
  );
}
