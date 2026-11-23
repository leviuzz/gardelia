import { ArrowRight, Store } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getPlacesProvider, listUserTenants, openBuyerAccount } from '@floral/core';
import { MX_REGIONS } from '@floral/domain';
import { AddressBook } from '@/components/addresses/address-book';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { PlacesConfigProvider } from '@/components/form/address-search';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getBuyerContext } from '@/lib/buyer';
import { phoneForInput } from '@/lib/format';
import {
  addBuyerAddressAction,
  archiveBuyerAddressAction,
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
 * "Mi cuenta" di chi compra (blocco C1): dati di contatto e indirizzi di consegna salvati. Aprirla
 * la prima volta crea il conto cliente; da lì l'accesso porta qui invece che alla creazione di
 * una fioreria.
 */
export default async function AccountPage() {
  const ctx = await getBuyerContext();
  const [account, shops] = await Promise.all([openBuyerAccount(ctx), listUserTenants(ctx.userId)]);
  const t = await getTranslations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('account.title')}</h1>
        <p className="mt-2 text-muted-foreground">
          {t('account.greeting', { name: account.name })}
        </p>
      </div>

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

      <div className="mx-auto max-w-xs">
        <SignOutButton label={t('auth.signOut')} redirectTo="/" />
      </div>
    </div>
  );
}
