'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { isEnabledLocale } from '@floral/domain';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS } from './locale';

/**
 * Cambia la lingua dell'interfaccia di questo browser (ADR-042). Non tocca dati di nessuna
 * fioreria: salva solo la preferenza in un cookie. Valori sconosciuti vengono ignorati. Funziona
 * anche senza JavaScript (modulo con pulsanti).
 */
export async function changeLocaleAction(formData: FormData): Promise<void> {
  const locale = formData.get('locale');
  if (!isEnabledLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax',
    httpOnly: true,
    secure: (process.env.APP_URL ?? '').startsWith('https://'),
  });
  revalidatePath('/', 'layout');
}
