import { ArrowLeft, CircleCheck, Store, XCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getBuyerServiceRequest } from '@floral/core';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { ServiceRequestDetails } from '@/components/requests/service-request-details';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getBuyerContext } from '@/lib/buyer';
import { orNotFound } from '@/lib/care-portal';
import { accountRoutes, publicStoreRoutes } from '@/lib/routes';
import { SERVICE_REQUEST_STATUS_BADGE } from '@/lib/service-request-ui';
import { cancelServiceRequestAction } from '../actions';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Una richiesta di servizio nel conto di chi l'ha fatta (M5, ADR-089): lo stato, quello che ha
 * scritto e le foto, il motivo se la fioreria non può, «Cancelar solicitud» finché è aperta. La
 * richiesta di un'altra persona risponde 404.
 */
export default async function BuyerServiceRequestPage({
  params,
  searchParams,
}: PageProps<'/cuenta/solicitudes/[requestId]'>) {
  const { requestId } = await params;
  const query = await searchParams;
  const ctx = await getBuyerContext(accountRoutes.requests.detail(requestId));
  const { shop, request, canCancel } = await orNotFound(getBuyerServiceRequest(ctx, requestId));
  const t = await getTranslations();
  const format = await getFormatter();
  const serviceName = request.service.name ?? t(`serviceNames.${request.service.kind}`);

  return (
    <div className="space-y-6">
      <Link
        href={accountRoutes.requests.list}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('account.requests.back')}
      </Link>

      {query.enviada === '1' ? (
        <Alert variant="success" data-testid="request-sent">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>{t('account.requests.sent', { shop: shop.name })}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight break-words">
          {serviceName}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">{request.numberLabel}</span>
          <span aria-hidden="true">·</span>
          <Link
            href={publicStoreRoutes(shop.slug).home}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <Store className="size-4" aria-hidden="true" />
            {shop.name}
          </Link>
          <span aria-hidden="true">·</span>
          {format.dateTime(request.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
        <Badge variant={SERVICE_REQUEST_STATUS_BADGE[request.status]} data-testid="request-status">
          {t(`account.requests.statuses.${request.status}`)}
        </Badge>
        <p className="text-sm text-muted-foreground">
          {t(`account.requests.statusHints.${request.status}`, { shop: shop.name })}
        </p>
      </div>

      {request.status === 'DECLINED' && request.declineReason ? (
        <Alert variant="destructive" data-testid="request-declined">
          <XCircle aria-hidden="true" />
          <AlertDescription className="space-y-1">
            <p className="font-medium">
              {t('account.requests.declinedTitle', { shop: shop.name })}
            </p>
            <p className="whitespace-pre-line">{request.declineReason}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('account.requests.whatYouSent')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ServiceRequestDetails
            request={request}
            photoSrc={(photoId, thumb) =>
              accountRoutes.requests.photo(request.id, photoId, { thumb })
            }
          />
        </CardContent>
      </Card>

      {canCancel ? (
        <ConfirmActionDialog
          action={cancelServiceRequestAction.bind(null, request.id)}
          trigger={
            <Button variant="outline" data-testid="request-cancel">
              {t('account.requests.cancel')}
            </Button>
          }
          title={t('account.requests.cancelTitle', { number: request.numberLabel })}
          description={t('account.requests.cancelBody', { shop: shop.name })}
          confirmLabel={t('account.requests.cancelConfirm')}
        />
      ) : null}
    </div>
  );
}
