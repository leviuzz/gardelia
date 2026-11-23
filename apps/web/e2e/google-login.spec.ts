import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_GOOGLE_CLIENT_ID } from '../playwright.config';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';

/**
 * Login con Google (ADR-036). Google non viene mai contattato: il test intercetta la pagina
 * di autorizzazione, mostra al suo posto una pagina con il link di ritorno alla callback (con un
 * `code` o un errore, come farebbe Google) e lo segue; il server scambia il `code` con
 * l'endpoint simulato (e2e/support/google-oauth-mock.mjs). Stato, cookie, PKCE, collegamento
 * degli account e sessione sono il codice reale.
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

const GOOGLE_PAGES = 'https://accounts.google.com/**';
const BACK_TO_APP = 'Volver a la app (Google simulado)';

interface SimulatedGoogle {
  /** URL di autorizzazione aperto dall'app (dopo `returnToApp`). */
  readonly authorizeUrl: () => URL;
  /** Dalla pagina di "Google" si torna all'app, come chi sceglie l'account. */
  readonly returnToApp: () => Promise<void>;
}

/** Callback dell'app con la risposta di "Google": un `code` con l'identità, o un errore. */
function callbackFor(authorize: URL, answer: GoogleAnswer): string {
  const back = new URL(authorize.searchParams.get('redirect_uri') ?? '');
  back.searchParams.set('state', authorize.searchParams.get('state') ?? '');
  if ('error' in answer) {
    back.searchParams.set('error', answer.error);
  } else {
    const { emailVerified = true, ...identity } = answer.identity;
    const code = Buffer.from(
      JSON.stringify({ ...identity, email_verified: emailVerified }),
    ).toString('base64url');
    back.searchParams.set('code', code);
  }
  return back.toString();
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

/**
 * Prepara la risposta di "Google". Al posto di Google compare una pagina con il link di ritorno:
 * NON un redirect 302 dall'intercettazione. In CI quel redirect ogni tanto restava fermo nel
 * browser e la richiesta di ritorno non arrivava mai al server (nessuna riga "ritorno da Google
 * ricevuto" nel log). Prima di seguire il link l'intercettazione si toglie: il ritorno è una
 * navigazione normale, come quella che parte da Google.
 */
async function googleWillAnswer(page: Page, answer: GoogleAnswer): Promise<SimulatedGoogle> {
  let authorizeUrl: URL | null = null;
  await page.route(GOOGLE_PAGES, async (route) => {
    const url = new URL(route.request().url());
    // Solo la pagina di autorizzazione; il resto (es. l'icona della pagina) non esiste.
    if (!url.pathname.startsWith('/o/oauth2/')) return route.fulfill({ status: 404, body: '' });
    authorizeUrl = url;
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><meta charset="utf-8"><title>Google (simulado)</title><a href="${escapeHtml(callbackFor(url, answer))}">${BACK_TO_APP}</a>`,
    });
  });
  return {
    authorizeUrl: () => {
      if (!authorizeUrl) throw new Error('Google non è stato chiamato');
      return authorizeUrl;
    },
    returnToApp: async () => {
      await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\//);
      const back = page.getByRole('link', { name: BACK_TO_APP, exact: true });
      await expect(back).toBeVisible();
      await page.unroute(GOOGLE_PAGES);
      await back.click();
    },
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
    const google = await googleWillAnswer(page, { identity });
    await page.getByRole('button', { name: 'Continuar con Google' }).click();
    await google.returnToApp();

    // Senza account e senza fiorerie si arriva all'onboarding, già autenticati.
    await expect(page).toHaveURL(/\/onboarding$/);
    const url = google.authorizeUrl();
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
    const googleAgain = await googleWillAnswer(again, { identity });
    await again.getByRole('button', { name: 'Continuar con Google' }).click();
    await googleAgain.returnToApp();
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
    const simulated = await googleWillAnswer(google, {
      identity: { sub: googleSub(), email, name: 'Marta I. (Google)' },
    });
    await google.getByRole('button', { name: 'Continuar con Google' }).click();
    await simulated.returnToApp();
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
    const google = await googleWillAnswer(owner, {
      identity: { sub: googleSub(), email, name: 'Titular Real' },
    });
    await owner.getByRole('button', { name: 'Continuar con Google' }).click();
    await google.returnToApp();
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
    const google = await googleWillAnswer(page, {
      identity: { sub: googleSub(), email, name: 'Rosa Sin Verificar', emailVerified: false },
    });
    await page.getByRole('button', { name: 'Continuar con Google' }).click();
    await google.returnToApp();
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
    const google = await googleWillAnswer(page, { error: 'access_denied' });
    await page.getByRole('button', { name: 'Continuar con Google' }).click();
    await google.returnToApp();
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
    const google = await googleWillAnswer(guest, {
      identity: { sub: googleSub(), email, name: 'Diego Google' },
    });
    await guest.getByRole('button', { name: 'Continuar con Google' }).click();
    await google.returnToApp();
    // Di ritorno sull'invito, ora autenticata: compare il pulsante per accettare.
    const accept = guest.getByRole('button', { name: 'Aceptar invitación' });
    await expect(accept).toBeVisible();
    await expect(guest).toHaveURL(/\/invite\//);
    // Google propone subito l'account dell'invito.
    expect(google.authorizeUrl().searchParams.get('login_hint')).toBe(email);

    await accept.click();
    await expect(guest).toHaveURL(/\/app\/las-camelias$/);
    await expect(guest.getByRole('heading', { name: 'Hola, Diego' })).toBeVisible();
    await guest.context().close();
  });
});
