import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getBuyerAccountDeletionBlockers } from '@floral/core';
import { ConfirmDeleteAccount } from '@/components/account/delete-account';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getBuyerContext } from '@/lib/buyer';
import { accountRoutes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.privacy');
  return { title: t('confirmTitle'), robots: { index: false, follow: false } };
}

/**
 * Dal link dell'email di conferma (ADR-068): serve l'accesso con lo stesso conto (dopo il login si
 * torna qui), poi un ultimo clic cancella il conto. Il token lo verifica Better Auth.
 */
export default async function ConfirmDeletePage({ searchParams }: PageProps<'/cuenta/eliminar'>) {
  const { token } = await searchParams;
  if (typeof token !== 'string' || token.length === 0 || token.length > 200) {
    redirect(accountRoutes.home);
  }
  const ctx = await getBuyerContext(accountRoutes.deleteConfirm(token));
  const [blockers, t] = await Promise.all([
    getBuyerAccountDeletionBlockers(ctx),
    getTranslations('account.privacy'),
  ]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('confirmTitle')}</CardTitle>
        <CardDescription>{t('confirmBody')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {blockers.length > 0 ? (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t('cannotDelete')}</p>
            <ul className="list-disc space-y-1 pl-5">
              {blockers.map((blocker) => (
                <li key={blocker}>{t(`blockers.${blocker}`)}</li>
              ))}
            </ul>
          </div>
        ) : (
          <ConfirmDeleteAccount token={token} />
        )}
        <Link
          href={accountRoutes.home}
          className="inline-block text-sm text-primary hover:underline"
        >
          {t('keepAccount')}
        </Link>
      </CardContent>
    </Card>
  );
}
