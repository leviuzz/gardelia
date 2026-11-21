import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_GOOGLE_CLIENT_ID } from '../playwright.config';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';

/**
 * Login con Google (ADR-036). Google non viene mai contattato: il test intercetta la pagina
 * di autorizzazione e torna alla callback come farebbe Google (con un `code` o un errore);
 * il server scambia il `code` con l'endpoint simulato (e2e/support/google-oauth-mock.mjs).
 * Stato, cookie, PKCE, collegamento degli account e sessione sono il codice reale.
 */
interface GoogleIdentity {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
  readonly emailVerified?: boolean;
}

type GoogleAnswer = { readonly identity: GoogleIdentity } | { readonly error: string };

/**
 * IP di prova (TEST-NET-2) diverso a ogni esecuzione: i limiti anti-abuso di registrazione e
 * accesso (per IP, salvati nel database) non si sommano fra un'esecuzione e l'altra né con gli
 * altri test, che usano 127.0.0.1.
 */
const CLIENT_IP = `198.51.100.${1 + Math.floor(Math.random() * 254)}`;
const CLIENT_HEADERS = { 'x-forwarded-for': CLIENT_IP };
test.use({ extraHTTPHeaders: CLIENT_HEADERS });

/** Prepara la risposta di "Google" e restituisce l'URL di autorizzazione richiesto. */
async function googleWillAnswer(page: Page, answer: GoogleAnswer): Promise<() => URL> {
  let authorizeUrl: URL | null = null;
  await page.route(
    'https://accounts.google.com/**',
    async (route) => {
      const url = new URL(route.request().url());
      authorizeUrl = url;
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      if ('error' in answer) {
        back.searchParams.set('error', answer.error);
      } else {
        const { emailVerified = true, ...identity } = answer.identity;
        const code = Buffer.from(
          JSON.stringify({ ...identity, email_verified: emailVerified }),
        ).toString('base64url');
        back.searchParams.set('code', code);
      }
      await route.fulfill({ status: 302, headers: { location: back.toString() } });
    },
    { times: 1 },
  );
  return () => {
    if (!authorizeUrl) throw new Error('Google non è stato chiamato');
    return authorizeUrl;
  };
}

function googleSub(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
}

async function cleanPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: CLIENT_HEADERS,
  });
  return context.newPage();
}

async function createShop(page: Page, shopName: string) {
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('Nombre comercial').fill(shopName);
  await page.getByLabel('Teléfono de contacto').fill('449 555 0199');
  await page.getByLabel('Calle y número').fill('Av. Madero 120');
  await page.getByLabel('Colonia').fill('Zona Centro');
  await page.getByLabel('Código postal').fill('20000');
  await page.getByLabel('Municipio o alcaldía').fill('Aguascalientes');
  await page.getByRole('button', { name: 'Crear mi florería' }).click();
}

async function signUpWithPassword(page: Page, name: string, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Nombre completo').fill(name);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('una-clave-segura-123');
  await page.getByLabel('Confirma la contraseña').fill('una-clave-segura-123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();
}

test.describe('login con Google', () => {
  test('una persona nueva entra con Google, crea su florería y vuelve a entrar', async ({
    page,
    browser,
    baseURL,
  }) => {
    const identity = { sub: googleSub(), email: uniqueEmail('google'), name: 'Lucía Torres' };

    await page.goto('/signup');
    const authorize = await googleWillAnswer(page, { identity });
    await page.getByRole('button', { name: 'Continuar con Google' }).click();

    // Senza account e senza fiorerie si arriva all'onboarding, già autenticati.
    await expect(page).toHaveURL(/\/onboarding$/);
    const url = authorize();
    expect(url.pathname).toBe('/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(E2E_GOOGLE_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(`${baseURL}/api/auth/callback/google`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual([
      'email',
      'openid',
      'profile',
    ]);
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();

    await createShop(page, `Florería Google ${Date.now()}`);
    await expect(page.getByRole('heading', { name: 'Hola, Lucía' })).toBeVisible();

    // Seconda volta, da un browser pulito: stesso account Google, dritto alla fioreria.
    const again = await cleanPage(browser);
    await again.goto('/login');
    await googleWillAnswer(again, { identity });
    await again.getByRole('button', { name: 'Continuar con Google' }).click();
    await expect(again).toHaveURL(/\/app\/floreria-google-\d+$/);
    await expect(again.getByRole('heading', { name: 'Hola, Lucía' })).toBeVisible();
    await again.context().close();
  });

  test('un account con correo confermato si collega a Google con la stessa email', async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail('collega');
    await signUpWithPassword(page, 'Marta Ibarra', email);
    const verification = await waitForEmail(email, { subject: 'Confirma tu correo' });
    await page.goto(linkFrom(verification, '/api/auth/verify-email'));
    await createShop(page, `Florería Marta ${Date.now()}`);
    await expect(page.getByRole('heading', { name: 'Hola, Marta' })).toBeVisible();

    // Stessa email su Google (verificata): entra nello STESSO account, nome invariato.
    const google = await cleanPage(browser);
    await google.goto('/login');
    await googleWillAnswer(google, {
      identity: { sub: googleSub(), email, name: 'Marta I. (Google)' },
    });
    await google.getByRole('button', { name: 'Continuar con Google' }).click();
    await expect(google).toHaveURL(/\/app\/floreria-marta-\d+$/);
    await expect(google.getByRole('heading', { name: 'Hola, Marta' })).toBeVisible();
    await google.context().close();
  });

  test('un account mai confermato NON si collega a Google (niente furto di account)', async ({
    page,
    browser,
  }) => {
    // Qualcuno registra con email e password l'indirizzo di un altro, senza confermarlo.
    const email = uniqueEmail('ajena');
    await signUpWithPassword(page, 'Cuenta Ajena', email);

    // Il vero titolare entra con Google: Better Auth rifiuta il collegamento automatico.
    const owner = await cleanPage(browser);
    await owner.goto('/login');
    await googleWillAnswer(owner, { identity: { sub: googleSub(), email, name: 'Titular Real' } });
    await owner.getByRole('button', { name: 'Continuar con Google' }).click();
    await expect(owner).toHaveURL(/\/login\?error=account_not_linked/);
    await expect(
      owner.getByText('Ya existe una cuenta con este correo, pero aún no está confirmada.', {
        exact: false,
      }),
    ).toBeVisible();
    await owner.goto('/app');
    await expect(owner).toHaveURL(/\/login\?next=%2Fapp$/);
    await owner.context().close();
  });

  test('email non verificata da Google: nessuna sessione e link di conferma', async ({ page }) => {
    const email = uniqueEmail('sinverificar');
    await page.goto('/signup');
    await googleWillAnswer(page, {
      identity: { sub: googleSub(), email, name: 'Rosa Sin Verificar', emailVerified: false },
    });
    await page.getByRole('button', { name: 'Continuar con Google' }).click();
    await expect(page).toHaveURL(/\/signup\?error=email_not_verified/);
    await expect(
      page.getByText('Google no ha confirmado este correo.', { exact: false }),
    ).toBeVisible();
    await waitForEmail(email, { subject: 'Confirma tu correo' });
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
  });

  test('annullare su Google riporta all’accesso con un avviso', async ({ page }) => {
    await page.goto('/login');
    await googleWillAnswer(page, { error: 'access_denied' });
    await page.getByRole('button', { name: 'Continuar con Google' }).click();
    await expect(page).toHaveURL(/\/login\?error=access_denied/);
    await expect(
      page.getByText('Cancelaste el acceso con Google.', { exact: false }),
    ).toBeVisible();
    // Il modulo con email e password resta disponibile.
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });
});

test.describe('invito accettato con Google', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('la persona invitata entra con Google ed entra nella fioreria', async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail('equipo-google');
    await page.goto('/app/las-camelias/settings/team');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Rol', { exact: true }).selectOption('STAFF');
    await page.getByRole('button', { name: 'Enviar invitación' }).click();
    await expect(page.getByText(`Invitación enviada a ${email}`)).toBeVisible();
    const inviteUrl = linkFrom(await waitForEmail(email, { subject: 'te invitó' }), '/invite/');

    const guest = await cleanPage(browser);
    await guest.goto(inviteUrl);
    const authorize = await googleWillAnswer(guest, {
      identity: { sub: googleSub(), email, name: 'Diego Google' },
    });
    await guest.getByRole('button', { name: 'Continuar con Google' }).click();
    // Di ritorno sull'invito, ora autenticata: compare il pulsante per accettare.
    const accept = guest.getByRole('button', { name: 'Aceptar invitación' });
    await expect(accept).toBeVisible();
    await expect(guest).toHaveURL(/\/invite\//);
    // Google propone subito l'account dell'invito.
    expect(authorize().searchParams.get('login_hint')).toBe(email);

    await accept.click();
    await expect(guest).toHaveURL(/\/app\/las-camelias$/);
    await expect(guest.getByRole('heading', { name: 'Hola, Diego' })).toBeVisible();
    await guest.context().close();
  });
});
