import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { TWO_FACTOR_POLICY } from '@floral/domain';
import { AuthCard } from '@/components/auth/auth-card';
import { authPath } from '@/lib/auth-paths';
import { getSession, safeNextPath } from '@/lib/session';
import { TwoFactorChallengeForm } from './challenge-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('security.challenge');
  return { title: t('title') };
}

/**
 * Secondo passaggio dell'accesso (ADR-077): dopo la password, il codice dell'app di autenticazione
 * o un codice di respaldo. Better Auth tiene la prova della password in un cookie per 10 minuti;
 * scaduto, si torna al login.
 */
export default async function TwoFactorChallengePage({ searchParams }: PageProps<'/verificacion'>) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null);
  if (await getSession()) redirect(next);
  const t = await getTranslations('security.challenge');
  return (
    <AuthCard
      title={t('title')}
      subtitle={t('subtitle')}
      footer={
        <Link
          href={authPath('/login', { next })}
          className="font-medium text-primary hover:underline"
        >
          {t('backToLogin')}
        </Link>
      }
    >
      <TwoFactorChallengeForm next={next} trustDays={TWO_FACTOR_POLICY.trustDeviceDays} />
    </AuthCard>
  );
}
