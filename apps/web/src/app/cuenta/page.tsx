import {
  ArrowRight,
  ChevronRight,
  Download,
  Leaf,
  ShieldCheck,
  ShoppingBag,
  Store,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  getBuyerAccountDeletionBlockers,
  getPlacesProvider,
  listBuyerOrders,
  listMyCareContracts,
  listUserTenants,
  openBuyerAccount,
} from '@floral/core';
import { MX_REGIONS } from '@floral/domain';
import { DeleteAccountButton } from '@/components/account/delete-account';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { AddressBook } from '@/components/addresses/address-book';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { PlacesConfigProvider } from '@/components/form/address-search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getBuyerContext } from '@/lib/buyer';
import { serverEnv } from '@/lib/env';
import { money, phoneForInput } from '@/lib/format';
import { ORDER_STATUS_BADGE } from '@/lib/order-ui';
import { calendarDate } from '@/lib/quote-ui';
import {
  accountRoutes,
  buyerRoutes,
  legalRoutes,
  publicStoreRoutes,
  securityRoutes,
} from '@/lib/routes';
import {
  addBuyerAddressAction,
  archiveBuyerAddressAction,
  cancelBuyerOrderAction,
  updateBuyerAddressAction,
  updateBuyerProfileAction,
} from './actions';
import { BuyerProfileForm } from './profile-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account');
  return { title: t('title') };
}

const REGIONS = MX_REGIONS.map(({ code, name }) => ({ code, name }));
const REGION_NAMES = new Map<string, string>(REGIONS.map((region) => [region.code, region.name]));

/**
 * "Mi cuenta" di chi compra (blocco C1): i suoi ordini online (C4, ADR-067), dati di contatto e
 * indirizzi di consegna salvati. Aprirla la prima volta crea il conto cliente; da lì l'accesso porta
 * qui invece che alla creazione di una fioreria.
 */
export default async function AccountPage() {
  const ctx = await getBuyerContext();
  const [account, shops, orders, deletionBlockers, careContracts] = await Promise.all([
    openBuyerAccount(ctx),
    listUserTenants(ctx.userId),
    listBuyerOrders(ctx, serverEnv().BETTER_AUTH_SECRET),
    getBuyerAccountDeletionBlockers(ctx),
    listMyCareContracts(ctx),
  ]);
  const t = await getTranslations();
  const format = await getFormatter();
  const careUnread = careContracts.reduce((total, contract) => total + contract.unreadMessages, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('account.title')}</h1>
        <p className="mt-2 text-muted-foreground">
          {t('account.greeting', { name: account.name })}
        </p>
      </div>

      <Card id="pedidos" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>{t('account.orders.title')}</CardTitle>
          <CardDescription>{t('account.orders.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
                <ShoppingBag className="size-5" aria-hidden="true" />
              </span>
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                {t('account.orders.empty')}
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href={buyerRoutes.home}>{t('account.orders.find')}</Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y rounded-xl border">
              {orders.map((order) => (
                <li key={order.orderId}>
                  <Link
                    href={order.trackingPath ?? publicStoreRoutes(order.shopSlug).home}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block truncate font-medium">{order.shopName}</span>
                      <span className="block text-sm text-muted-foreground first-letter:uppercase">
                        <span className="tabular-nums">{order.numberLabel}</span>
                        {order.scheduledDate
                          ? ` · ${format.dateTime(calendarDate(order.scheduledDate), {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                              timeZone: 'UTC',
                            })}`
                          : ''}
                        {` · ${t(`orders.modes.${order.fulfillmentMode}`)}`}
                      </span>
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <Badge variant={ORDER_STATUS_BADGE[order.status]}>
                          {t(`account.orders.statuses.${order.status}`)}
                        </Badge>
                        <span className="text-sm font-medium tabular-nums">
                          {money(order.totalMinor, order.currency)}
                        </span>
                      </span>
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                  {/* Ancora da accettare: chi l'ha fatto può annullarlo da qui. */}
                  {order.status === 'PENDING_ACCEPTANCE' ? (
                    <div className="px-4 pb-3">
                      <ConfirmActionDialog
                        action={cancelBuyerOrderAction.bind(null, order.orderId)}
                        trigger={
                          <Button variant="outline" size="sm">
                            {t('account.orders.cancel')}
                          </Button>
                        }
                        title={t('account.orders.cancelTitle', { number: order.numberLabel })}
                        description={t('account.orders.cancelBody', { shop: order.shopName })}
                        confirmLabel={t('account.orders.cancelConfirm')}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {careContracts.length > 0 ? (
        <Card data-testid="account-floral-care">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
              <Leaf className="size-5" aria-hidden="true" />
            </span>
            <p className="min-w-0 flex-1 text-sm">
              <span className="block font-medium">{t('account.care.title')}</span>
              <span className="text-muted-foreground">
                {t('account.care.cardBody', { count: careContracts.length })}
              </span>
              {careUnread > 0 ? (
                <Badge variant="info" className="mt-1">
                  {t('account.care.unread', { count: careUnread })}
                </Badge>
              ) : null}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href={accountRoutes.care.home}>
                {t('account.care.open')}
                <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {shops.length > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
              <Store className="size-5" aria-hidden="true" />
            </span>
            <p className="min-w-0 flex-1 text-sm">{t('account.shopsBody')}</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/app">
                {t('account.shopsCta')}
                <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('account.dataTitle')}</CardTitle>
          <CardDescription>{t('account.dataSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{t('account.name')}</dt>
              <dd className="font-medium break-words">{account.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('account.email')}</dt>
              <dd className="font-medium break-all">{account.email}</dd>
            </div>
          </dl>
          <BuyerProfileForm
            action={updateBuyerProfileAction}
            defaultPhone={phoneForInput(account.phone)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('customers.addresses.title')}</CardTitle>
          <CardDescription>{t('account.addressesSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* "Buscar dirección" con Google Places se c'è la chiave (ADR-059). */}
          <PlacesConfigProvider enabled={getPlacesProvider() !== null} near={null}>
            <AddressBook
              canWrite
              addAction={addBuyerAddressAction}
              regions={REGIONS}
              addresses={account.addresses.map((address) => ({
                ...address,
                regionName: REGION_NAMES.get(address.region) ?? address.region,
                updateAction: updateBuyerAddressAction.bind(null, address.id),
                archiveAction: archiveBuyerAddressAction.bind(null, address.id),
              }))}
            />
          </PlacesConfigProvider>
        </CardContent>
      </Card>

      {shops.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('account.floristTitle')}</CardTitle>
            <CardDescription>{t('account.floristBody')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/onboarding">
                <Store />
                {t('account.floristCta')}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Verifica in due passaggi e dispositivi collegati (ADR-077). */}
      <Link
        href={securityRoutes.home({ volver: accountRoutes.home })}
        className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t('security.title')}</span>
          <span className="block text-sm text-muted-foreground">{t('security.linkBody')}</span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Card id="privacidad" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>{t('account.privacy.title')}</CardTitle>
          <CardDescription>
            {t.rich('account.privacy.subtitle', {
              privacy: (chunks) => (
                <Link
                  href={legalRoutes.privacy}
                  className="font-medium text-primary hover:underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col items-start gap-1">
            <Button asChild variant="outline">
              {/* Documento generato dal server: si scarica, non si apre come pagina. */}
              <a href={accountRoutes.data} download>
                <Download />
                {t('account.privacy.download')}
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">{t('account.privacy.downloadHint')}</p>
          </div>
          {deletionBlockers.length > 0 ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{t('account.privacy.cannotDelete')}</p>
              <ul className="list-disc space-y-1 pl-5">
                {deletionBlockers.map((blocker) => (
                  <li key={blocker}>{t(`account.privacy.blockers.${blocker}`)}</li>
                ))}
              </ul>
            </div>
          ) : (
            <DeleteAccountButton />
          )}
        </CardContent>
      </Card>

      <div className="mx-auto max-w-xs">
        <SignOutButton label={t('auth.signOut')} redirectTo="/" />
      </div>
    </div>
  );
}
