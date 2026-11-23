import {
  ArrowRight,
  CalendarHeart,
  Check,
  FileText,
  Flower2,
  Sparkles,
  TriangleExclamationPoint,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getDashboard, listUpcomingOccasions, type ActivityEntry } from '@floral/core';
import {
  ORDER_STATUSES,
  QUOTE_STATUSES,
  isMembershipRole,
  isPlanCode,
  type OrderStatus,
  type QuoteStatus,
} from '@floral/domain';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes, type TenantRoutes } from '@/lib/routes';
import { requireUser } from '@/lib/session';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';

/** Dove porta ogni passo della guida iniziale. */
const STEP_LINKS = {
  first_product: (routes: TenantRoutes) => routes.catalog.new,
  first_bouquet_recipe: (routes: TenantRoutes) => routes.catalog.list({ type: 'BOUQUET' }),
  complete_costs: (routes: TenantRoutes) => routes.catalog.list(),
  invite_team: (routes: TenantRoutes) => routes.settings.team,
} as const;

function isQuoteStatus(value: string): value is QuoteStatus {
  return (QUOTE_STATUSES as readonly string[]).includes(value);
}

function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

function metadataNumber(metadata: ActivityEntry['metadata'], key: string): number | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

function metadataString(metadata: ActivityEntry['metadata'], key: string): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

export default async function DashboardPage({ params }: PageProps<'/app/[tenantSlug]'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const user = await requireUser();
  const [data, occasions] = await Promise.all([
    getDashboard(ctx),
    listUpcomingOccasions(ctx, { withinDays: 30, limit: 6 }),
  ]);
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);

  const attention = data.catalog.outOfStock + data.catalog.limited + data.catalog.onRequest;
  const firstName = user.name.split(' ')[0] ?? user.name;
  const pendingSteps = data.onboarding.filter((step) => !step.done).length;

  function describeActivity(entry: ActivityEntry): string {
    const actor = entry.actorName ?? t('activity.someone');
    // Moduli con i testi nel proprio namespace (ADR-060): `inventory.x` → `inventory.activity.x`.
    const [module, ...rest] = entry.action.split('.');
    const moduleKey = `${module}.activity.${rest.join('.')}`;
    const key = t.has(`activity.${entry.action}`) ? `activity.${entry.action}` : moduleKey;
    const roleValue =
      metadataString(entry.metadata, 'to') ?? metadataString(entry.metadata, 'role');
    const statusValue = metadataString(entry.metadata, 'to');
    const planValue = metadataString(entry.metadata, 'planCode');
    const values = {
      actor,
      name:
        metadataString(entry.metadata, 'name') ??
        metadataString(entry.metadata, 'bouquetName') ??
        '—',
      ingredient: metadataString(entry.metadata, 'ingredientName') ?? '—',
      role: roleValue && isMembershipRole(roleValue) ? t(`roles.${roleValue}`) : '—',
      number: metadataString(entry.metadata, 'number') ?? '—',
      status: !statusValue
        ? '—'
        : entry.action.startsWith('order.') && isOrderStatus(statusValue)
          ? t(`orders.statuses.${statusValue}`)
          : isQuoteStatus(statusValue)
            ? t(`quotes.statuses.${statusValue}`)
            : '—',
      plan: planValue && isPlanCode(planValue) ? t(`plans.names.${planValue}`) : '—',
      units: metadataNumber(entry.metadata, 'units') ?? 0,
      lines: metadataNumber(entry.metadata, 'lines') ?? 1,
    };
    return t.has(key) ? t(key, values) : t('activity.fallback', values);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={t('dashboard.greeting', { name: firstName })}
        description={t('dashboard.subtitle', { shop: ctx.tenantName })}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<FileText />}
          label={t('dashboard.statOpenQuotes')}
          value={format.number(data.quotes.drafts + data.quotes.sent)}
          detail={t('dashboard.openQuotesDetail', {
            drafts: data.quotes.drafts,
            sent: data.quotes.sent,
          })}
          href={routes.quotes.list()}
        />
        <StatCard
          icon={<Flower2 />}
          label={t('dashboard.statActiveItems')}
          value={format.number(data.catalog.activeItems)}
          href={routes.catalog.list()}
        />
        <StatCard
          icon={<TriangleExclamationPoint />}
          label={t('dashboard.statAttention')}
          value={format.number(attention)}
          detail={t('dashboard.attentionDetail', {
            outOfStock: data.catalog.outOfStock,
            limited: data.catalog.limited,
            onRequest: data.catalog.onRequest,
          })}
          tone={attention > 0 ? 'warning' : 'default'}
        />
        {data.team ? (
          <StatCard
            icon={<Users />}
            label={t('dashboard.statTeam')}
            value={format.number(data.team.activeMembers)}
            detail={t('dashboard.pendingInvites', { count: data.team.pendingInvitations })}
            href={routes.settings.team}
          />
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="min-w-0 space-y-6 lg:col-span-3">
          {pendingSteps > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('dashboard.gettingStarted')}</CardTitle>
                <CardDescription>{t('dashboard.gettingStartedHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="divide-y rounded-xl border">
                  {data.onboarding.map((step) => (
                    <li key={step.key} className="flex items-center gap-3 px-4 py-3">
                      <span
                        className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-full border',
                          step.done ? 'border-transparent bg-success text-white' : 'bg-card',
                        )}
                        aria-hidden="true"
                      >
                        {step.done ? <Check className="size-3.5" /> : null}
                      </span>
                      <span
                        className={cn(
                          'flex-1 text-sm',
                          step.done && 'text-muted-foreground line-through',
                        )}
                      >
                        {t(`dashboard.step_${step.key}`)}
                      </span>
                      {step.done ? (
                        <span className="sr-only">{t('dashboard.stepDone')}</span>
                      ) : (
                        <Link
                          href={STEP_LINKS[step.key](routes)}
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          {t('dashboard.go')}
                          <ArrowRight className="size-3.5" />
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>{t('dashboard.upcomingOccasions')}</CardTitle>
              <Link
                href={routes.calendar()}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                {t('dashboard.viewCalendar')}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </CardHeader>
            <CardContent>
              {occasions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.noUpcomingOccasions')}
                </p>
              ) : (
                <ul className="divide-y">
                  {occasions.map((occasion) => (
                    <li
                      key={occasion.occasionId}
                      className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <CalendarHeart
                        className="size-4 shrink-0 text-accent-foreground"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="truncate font-medium">{occasion.customerName}</p>
                        <p className="truncate text-muted-foreground">
                          {occasion.type === 'CUSTOM' && occasion.label
                            ? occasion.label
                            : t(`customers.occasions.types.${occasion.type}`)}
                          {occasion.personName
                            ? ` · ${t('customers.occasions.of', { name: occasion.personName })}`
                            : ''}
                        </p>
                      </div>
                      <Badge variant={occasion.inReminderWindow ? 'accent' : 'muted'}>
                        {occasion.daysUntil === 0
                          ? t('customers.occasions.today')
                          : t('customers.occasions.inDays', { count: occasion.daysUntil })}
                      </Badge>
                      <Link
                        href={routes.customers.detail(occasion.customerId)}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {t('dashboard.contactNow')}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.catalogHealth')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {data.catalog.itemsMissingCost ? (
                <HealthRow tone="warning">
                  {t('dashboard.missingCosts', { count: data.catalog.itemsMissingCost })}
                </HealthRow>
              ) : null}
              {data.catalog.bouquetsWithoutRecipe > 0 ? (
                <HealthRow tone="warning">
                  {t('dashboard.bouquetsWithoutRecipe', {
                    count: data.catalog.bouquetsWithoutRecipe,
                  })}
                </HealthRow>
              ) : null}
              {!data.catalog.itemsMissingCost && data.catalog.bouquetsWithoutRecipe === 0 ? (
                <HealthRow tone="success">{t('dashboard.catalogOk')}</HealthRow>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-dashed bg-transparent shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-accent-foreground" aria-hidden="true" />
                {t('dashboard.comingSoonTitle')}
              </CardTitle>
              <CardDescription className="leading-relaxed">
                {t('dashboard.comingSoonBody')}
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        {data.recentActivity ? (
          <Card className="min-w-0 lg:col-span-2">
            <CardHeader>
              <CardTitle>{t('dashboard.recentActivity')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('dashboard.noActivity')}</p>
              ) : (
                <ol className="space-y-4">
                  {data.recentActivity.map((entry) => (
                    <li key={entry.id} className="flex gap-3">
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-sm leading-snug">{describeActivity(entry)}</p>
                        <time
                          dateTime={entry.createdAt.toISOString()}
                          className="text-xs text-muted-foreground"
                        >
                          {format.relativeTime(entry.createdAt)}
                        </time>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  href,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
  href?: string;
  tone?: 'default' | 'warning';
}) {
  const content = (
    <Card className={cn('h-full gap-3 transition-colors', href && 'hover:bg-muted/40')}>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-lg [&_svg]:size-4',
              tone === 'warning'
                ? 'bg-warning-soft text-[oklch(0.45_0.1_65)]'
                : 'bg-secondary text-primary',
            )}
          >
            {icon}
          </span>
        </div>
        <p className="font-display text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link
      href={href}
      className="block rounded-2xl focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      {content}
    </Link>
  ) : (
    content
  );
}

function HealthRow({ tone, children }: { tone: 'warning' | 'success'; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Badge variant={tone === 'warning' ? 'warning' : 'success'} className="mt-0.5">
        {tone === 'warning' ? '!' : '✓'}
      </Badge>
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}
