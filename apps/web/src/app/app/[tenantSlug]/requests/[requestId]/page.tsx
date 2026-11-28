import { ArrowLeft, FileText, Mail, Phone, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getServiceRequest, hasPermission } from '@floral/core';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { ServiceRequestDetails } from '@/components/requests/service-request-details';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { orNotFound } from '@/lib/care-portal';
import { tenantRoutes } from '@/lib/routes';
import { SERVICE_REQUEST_STATUS_BADGE } from '@/lib/service-request-ui';
import { getTenantContext } from '@/lib/tenant';
import { declineServiceRequestAction } from '../actions';
import { DeclineRequestForm } from './decline-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('requests');
  return { title: t('title') };
}

/**
 * Una richiesta di servizio (M5, ADR-089): quello che ha scritto chi compra, le foto (rotte private),
 * il cliente del CRM con telefono ed email, e «Rifiuta» per proprietario e gerente finché è aperta.
 * Un ID di un'altra fioreria risponde 404 con l'evento di sicurezza.
 */
export default async function ServiceRequestPage({
  params,
}: PageProps<'/app/[tenantSlug]/requests/[requestId]'>) {
  const { tenantSlug, requestId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'requests:read')) return <Forbidden />;
  const { request, customer, buyerDeleted, canDecline } = await orNotFound(
    getServiceRequest(ctx, requestId),
  );
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const serviceName = request.service.name ?? t(`serviceNames.${request.service.kind}`);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={routes.requests.list()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('requests.title')}
      </Link>
      <PageHeader
        title={`${request.numberLabel} · ${serviceName}`}
        description={t('requests.receivedLong', {
          date: format.dateTime(request.createdAt, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: ctx.timezone,
          }),
        })}
      />
      <Badge variant={SERVICE_REQUEST_STATUS_BADGE[request.status]} data-testid="request-status">
        {t(`requests.statuses.${request.status}`)}
      </Badge>

      {request.status === 'DECLINED' && request.declineReason ? (
        <Alert variant="info">
          <AlertDescription className="space-y-1">
            <p className="font-medium">{t('requests.declinedTitle')}</p>
            <p className="whitespace-pre-line">{request.declineReason}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('requests.customerTitle')}</CardTitle>
          {buyerDeleted ? <CardDescription>{t('requests.buyerDeleted')}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm">
            <li className="flex items-center gap-2">
              <UserRound className="size-4 text-primary" aria-hidden="true" />
              {customer ? (
                <Link
                  href={routes.customers.detail(customer.id)}
                  className="font-medium text-primary hover:underline"
                >
                  {customer.displayName}
                </Link>
              ) : (
                t('requests.deletedBuyer')
              )}
            </li>
            <li className="flex items-center gap-2">
              <Phone className="size-4 text-primary" aria-hidden="true" />
              <a href={`tel:${request.contactPhone}`} className="hover:underline">
                {request.contactPhone}
              </a>
            </li>
            {customer?.email ? (
              <li className="flex items-center gap-2">
                <Mail className="size-4 text-primary" aria-hidden="true" />
                <a href={`mailto:${customer.email}`} className="break-all hover:underline">
                  {customer.email}
                </a>
              </li>
            ) : null}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('requests.detailsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ServiceRequestDetails
            request={request}
            photoSrc={(photoId, thumb) => routes.requests.photo(request.id, photoId, { thumb })}
          />
        </CardContent>
      </Card>

      {canDecline ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('requests.decline.title')}</CardTitle>
            <CardDescription>{t('requests.decline.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <DeclineRequestForm
              action={declineServiceRequestAction.bind(null, ctx.tenantSlug, request.id)}
            />
          </CardContent>
        </Card>
      ) : request.status === 'NEW' && !hasPermission(ctx, 'requests:write') ? (
        <p className="text-sm text-muted-foreground">{t('requests.staffHint')}</p>
      ) : null}
      {/* Il preventivo legato alla richiesta arriva con M5-2: intanto si prepara da Preventivi. */}
      {customer && request.status === 'NEW' && hasPermission(ctx, 'quotes:write') ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('requests.quoteTitle')}</CardTitle>
            <CardDescription>{t('requests.quoteBody')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={routes.quotes.new({ customerId: customer.id })}>
                <FileText aria-hidden="true" />
                {t('requests.quoteAction')}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
