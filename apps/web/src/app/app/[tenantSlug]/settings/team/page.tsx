import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getTeam, hasPermission } from '@floral/core';
import { MEMBERSHIP_ROLES, invitableRoles } from '@floral/domain';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { initials } from '@/lib/format';
import { getTenantContext } from '@/lib/tenant';
import {
  changeRoleAction,
  inviteMemberAction,
  revokeInvitationAction,
  setMemberActiveAction,
} from '../actions';
import {
  InviteForm,
  MemberStatusControl,
  RevokeInvitationButton,
  RoleSelect,
} from './team-controls';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('team');
  return { title: t('title') };
}

export default async function TeamPage({ params }: PageProps<'/app/[tenantSlug]/settings/team'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'members:read')) return <Forbidden />;

  const team = await getTeam(ctx);
  const t = await getTranslations();
  const format = await getFormatter();
  const slug = ctx.tenantSlug;
  const canManage = hasPermission(ctx, 'members:manage');
  const roles = invitableRoles(ctx.role);
  const date = (value: Date) =>
    format.dateTime(value, { dateStyle: 'medium', timeZone: ctx.timezone });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t('team.title')} description={t('team.subtitle')} />

      {roles.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('team.inviteTitle')}</CardTitle>
            <CardDescription>{t('team.inviteSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm action={inviteMemberAction.bind(null, slug)} roles={roles} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('team.members')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {team.members.map((member) => (
              <li key={member.membershipId} className="flex flex-wrap items-center gap-3 py-3">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
                  aria-hidden="true"
                >
                  {initials(member.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{member.name}</span>
                    {member.isCurrentUser ? (
                      <Badge variant="secondary">{t('team.you')}</Badge>
                    ) : null}
                    {member.status === 'SUSPENDED' ? (
                      <Badge variant="muted">{t('team.statusSuspended')}</Badge>
                    ) : null}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {member.email} · {t('team.joined', { date: date(member.joinedAt) })}
                  </p>
                </div>
                {canManage && !member.isCurrentUser ? (
                  <div
                    className="flex items-center gap-2"
                    aria-label={t('team.memberActions', { name: member.name })}
                  >
                    <RoleSelect
                      action={changeRoleAction.bind(null, slug, member.membershipId)}
                      currentRole={member.role}
                      label={member.membershipId}
                    />
                    <MemberStatusControl
                      action={setMemberActiveAction.bind(
                        null,
                        slug,
                        member.membershipId,
                        member.status !== 'ACTIVE',
                      )}
                      active={member.status === 'ACTIVE'}
                      memberName={member.name}
                    />
                  </div>
                ) : (
                  <Badge variant="outline">{t(`roles.${member.role}`)}</Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('team.invitations')}</CardTitle>
        </CardHeader>
        <CardContent>
          {team.invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('team.noInvitations')}</p>
          ) : (
            <ul className="divide-y">
              {team.invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{invitation.email}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('team.invitedBy', {
                        name: invitation.invitedByName,
                        date: date(invitation.expiresAt),
                      })}
                    </p>
                  </div>
                  <Badge variant="outline">{t(`roles.${invitation.role}`)}</Badge>
                  {roles.includes(invitation.role) ? (
                    <RevokeInvitationButton
                      action={revokeInvitationAction.bind(null, slug, invitation.id)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="bg-transparent shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t('team.rolesHelp')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3">
            {MEMBERSHIP_ROLES.map((role) => (
              <div key={role} className="rounded-xl border bg-card p-4">
                <dt className="font-medium">{t(`roles.${role}`)}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">
                  {t(`roles.descriptions.${role}`)}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
