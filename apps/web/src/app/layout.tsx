import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { BRAND } from '@floral/domain';
import { Toaster } from '@/components/ui/toaster';
import { fraunces, inter } from './fonts';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {
    title: { default: BRAND.productName, template: `%s · ${BRAND.productName}` },
    description: t('description'),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f7f5ef',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Leggere gli header rende il rendering dinamico: necessario per il nonce del CSP (proxy.ts).
  await headers();
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
