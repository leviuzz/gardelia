import {
  ArrowLeft,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  TriangleExclamationPoint,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getTwoFactorRequirement, listAccountSessions, listUserTenants } from '@floral/core';
import { describeUserAgent } from '@floral/domain';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { ActionButton } from '@/components/form/action-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { accountRoutes, appRoutes, securityRoutes } from '@/lib/routes';
import { getSession, requireUser, safeNextPath } from '@/lib/session';
import { revokeOtherSessionsAction, revokeSessionAction } from './actions';
import { TwoFactorPanel } from './two-factor-panel';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('security');
  return { title: t('title') };
}

/**
 * "Seguridad de la cuenta" (ADR-077): verifica in due passaggi e dispositivi collegati. Ci si
 * arriva dal menu della persona, da "Mi cuenta" o, per i titolari oltre la scadenza, dall'obbligo
 * di attivarla (`requerida`).
 */
export default async function SecurityPage({ searchParams }: PageProps<'/seguridad'>) {
  const params = await searchParams;
  const user = await requireUser(securityRoutes.home());
  const session = (await getSession())!;
  const [requirement, sessions, shops] = await Promise.all([
    getTwoFactorRequirement(user.id),
    listAccountSessions(user.id, session.session.id),
    listUserTenants(user.id),
  ]);
  const t = await getTranslations('security');
  const format = await getFormatter();
  const back = safeNextPath(
    typeof params.volver === 'string' ? params.volver : null,
    shops.length > 0 ? appRoutes.home : accountRoutes.home,
  );
  const blocked = requirement.blocking;
  const date = (value: Date) => format.dateTime(value, { dateStyle: 'long' });
  // Nella lista dei dispositivi la data breve ("24 nov 2026") tiene la riga corta su telefono.
  const shortDate = (value: Date) => format.dateTime(value, { dateStyle: 'medium' });

  return (
    <div className="space-y-6">
      {blocked ? null : (
        <Link
          href={back}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('back')}
        </Link>
      )}
      <div className="space-y-1.5">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle', { email: user.email })}</p>
      </div>

      {blocked ? (
        <Alert variant="destructive" data-testid="two-factor-required">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>{t('blocked')}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            {t('twoFactor.title')}
          </CardTitle>
          <CardDescription>{t('twoFactor.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {requirement.hasPassword ? (
            <TwoFactorPanel
              enabled={requirement.enabled}
              required={requirement.required}
              deadline={requirement.deadline ? date(requirement.deadline) : null}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('twoFactor.googleOnly')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MonitorSmartphone className="size-5 text-primary" aria-hidden="true" />
            {t('sessions.title')}
          </CardTitle>
          <CardDescription>{t('sessions.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ul className="divide-y rounded-xl border" data-testid="sessions">
            {sessions.map((item) => {
              const device = describeUserAgent(item.userAgent);
              const name =
                device.browser && device.os
                  ? t('sessions.device', { browser: device.browser, os: device.os })
                  : (device.browser ?? device.os ?? t('sessions.unknownDevice'));
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                  <span className="min-w-48 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {name}
                      {item.current ? (
                        <Badge variant="success">{t('sessions.current')}</Badge>
                      ) : null}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {t('sessions.since', { date: shortDate(item.createdAt) })} ·{' '}
                      {t('sessions.lastSeen', { date: shortDate(item.lastSeenAt) })}
                    </span>
                  </span>
                  {item.current ? null : (
                    <ActionButton
                      action={revokeSessionAction.bind(null, item.id)}
                      variant="outline"
                      size="sm"
                      icon={<LogOut />}
                      aria-label={t('sessions.revokeNamed', { device: name })}
                    >
                      {t('sessions.revoke')}
                    </ActionButton>
                  )}
                </li>
              );
            })}
          </ul>
          {sessions.length > 1 ? (
            <div>
              <ConfirmActionDialog
                action={revokeOtherSessionsAction}
                trigger={
                  <Button variant="outline">
                    <LogOut />
                    {t('sessions.revokeOthers')}
                  </Button>
                }
                title={t('sessions.revokeOthersTitle')}
                description={t('sessions.revokeOthersBody')}
                confirmLabel={t('sessions.revokeOthers')}
              />
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{t('sessions.note')}</p>
        </CardContent>
      </Card>

      {blocked ? (
        // Chi non vuole attivarla adesso può solo uscire: le sue fiorerie restano chiuse.
        <div className="mx-auto max-w-xs">
          <SignOutButton label={t('signOut')} redirectTo="/" />
        </div>
      ) : null}
    </div>
  );
}
