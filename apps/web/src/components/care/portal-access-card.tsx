import 'server-only';
import { Users } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { CarePortalPanelDto } from '@floral/core';
import { whatsappShareLink } from '@floral/domain';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { ActionButton } from '@/components/form/action-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  inviteCarePortalAction,
  resendCarePortalInviteAction,
  revokeCarePortalAccessAction,
  revokeCarePortalInviteAction,
} from '@/app/app/[tenantSlug]/subscriptions/[subscriptionId]/portal-actions';
import { PortalInviteForm, PortalInviteLink } from './portal-forms';

/**
 * "Acceso del cliente" nella pagina del contratto (ADR-084, chi gestisce): chi vede questo servizio
 * in Mi Floral Care, gli inviti in attesa con il link da copiare o mandare, e "Invitar". Lo staff
 * non lo vede.
 */
export async function PortalAccessCard({
  slug,
  panel,
  draft,
}: {
  readonly slug: string;
  readonly panel: CarePortalPanelDto;
  /** Il contratto è ancora un borrador: si invita dopo la conferma. */
  readonly draft: boolean;
}) {
  const t = await getTranslations('care.portal');
  const format = await getFormatter();
  const date = (at: Date) =>
    format.dateTime(at, { day: 'numeric', month: 'short', year: 'numeric' });
  const scopeLabel = (scope: 'CONTRACT' | 'CUSTOMER') =>
    scope === 'CONTRACT' ? t('scopeContract') : t('scopeCustomer');
  const id = panel.subscriptionId;

  return (
    <Card data-testid="portal-access-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {panel.people.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t('peopleTitle')}</h3>
            <ul className="divide-y rounded-xl border" data-testid="portal-people">
              {panel.people.map((person) => (
                <li
                  key={person.accessId}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium break-words">{person.name}</p>
                    <p className="break-all text-muted-foreground">{person.email}</p>
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="muted">{scopeLabel(person.scope)}</Badge>
                      {person.canSeeMoney ? <Badge variant="info">{t('seesMoney')}</Badge> : null}
                      <span className="text-xs text-muted-foreground">
                        {t('since', { date: date(person.since) })}
                      </span>
                    </p>
                  </div>
                  <ConfirmActionDialog
                    action={revokeCarePortalAccessAction.bind(null, slug, id, person.accessId)}
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                      >
                        {t('remove')}
                      </Button>
                    }
                    title={t('removeTitle', { name: person.name })}
                    description={t('removeBody')}
                    confirmLabel={t('removeConfirm')}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {panel.invites.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t('invitesTitle')}</h3>
            <ul className="divide-y rounded-xl border" data-testid="portal-invites">
              {panel.invites.map((invite) => (
                <li key={invite.id} className="space-y-3 p-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium break-all">{invite.email}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant={invite.status === 'PENDING' ? 'warning' : 'outline'}>
                        {invite.status === 'PENDING' ? t('pending') : t('expired')}
                      </Badge>
                      <Badge variant="muted">{scopeLabel(invite.scope)}</Badge>
                      {invite.canSeeMoney ? <Badge variant="info">{t('seesMoney')}</Badge> : null}
                      <span className="text-xs text-muted-foreground">
                        {invite.status === 'PENDING'
                          ? t('expiresOn', { date: date(invite.expiresAt) })
                          : t('expiredOn', { date: date(invite.expiresAt) })}
                      </span>
                    </p>
                  </div>
                  {invite.url ? (
                    <PortalInviteLink
                      url={invite.url}
                      whatsappHref={whatsappShareLink(t('whatsappText', { url: invite.url }))}
                    />
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {panel.canInvite ? (
                      <ActionButton
                        action={resendCarePortalInviteAction.bind(null, slug, id, invite.id)}
                        variant="outline"
                        size="sm"
                      >
                        {t('resend')}
                      </ActionButton>
                    ) : null}
                    {invite.status === 'PENDING' ? (
                      <ConfirmActionDialog
                        action={revokeCarePortalInviteAction.bind(null, slug, id, invite.id)}
                        trigger={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                          >
                            {t('revoke')}
                          </Button>
                        }
                        title={t('revokeTitle')}
                        description={t('revokeBody')}
                        confirmLabel={t('revokeConfirm')}
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {panel.canInvite ? (
          <section className="space-y-3">
            {!panel.emailsAllowed ? (
              <Alert>
                <AlertDescription>{t('demoNote')}</AlertDescription>
              </Alert>
            ) : null}
            <PortalInviteForm
              action={inviteCarePortalAction.bind(null, slug, id)}
              defaultEmail={panel.customerEmail}
            />
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">
            {draft ? t('notOpenDraft') : t('notOpen')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
