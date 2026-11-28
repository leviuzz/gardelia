import { expect, test, type Page } from '@playwright/test';
import { expectFitsAt320 } from './support/floral-care';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';
import { ownClientHeaders } from './support/network';
import { closeStore, ensurePublishedWithOrders } from './support/store';

/**
 * Marketplace M5-1 «Servicios en tu tienda» (ADR-089), dalle due parti:
 *  - la fioreria scrive e accende «Eventos y bodas» con una foto e crea un servizio suo;
 *  - chi compra lo vede nella sezione «Servicios» della vetrina, entra (si registra) e manda una
 *    richiesta con una foto di ispirazione; riceve «Recibimos tu solicitud» e la trova nel conto;
 *  - la fioreria la trova in «Por atender», nel menu e in «Solicitudes», la apre (foto privata) e la
 *    rifiuta con un motivo pronto; chi compra legge il motivo nel conto e per email;
 *  - lo staff vede la richiesta ma non la rifiuta; le pagine stanno in 320 px.
 * Alla fine i servizi tornano spenti e la tienda chiusa, come per gli altri test.
 */

const OWNER_EMAIL = 'duena@lascamelias.test';
const SHOP = 'Florería Las Camelias';

/** Un servizio dalle Impostazioni: la sua scheda, la descrizione e (se serve) acceso. */
async function describeAndPublish(page: Page, description: string): Promise<void> {
  await page.getByLabel('Descripción').fill(description);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Servicio guardado')).toBeVisible();
  const publish = page.getByTestId('service-publish');
  if ((await publish.textContent())?.includes('Poner en la tienda')) {
    await publish.click();
    await expect(page.getByText('El servicio ya está en tu tienda')).toBeVisible();
  }
}

/** Spegne un servizio dalla sua scheda (idempotente). */
async function unpublish(page: Page, href: string): Promise<void> {
  await page.goto(href);
  const toggle = page.getByTestId('service-publish');
  if ((await toggle.textContent())?.includes('Quitar de la tienda')) {
    await toggle.click();
    await expect(page.getByText('Quitaste el servicio de tu tienda')).toBeVisible();
  }
}

test.describe('servicios en la tienda y solicitudes (M5-1)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });
  test.setTimeout(300_000);

  test('la florería publica servicios, el cliente pide uno con una foto y la florería lo rechaza', async ({
    page,
    browser,
  }) => {
    await ensurePublishedWithOrders(page);

    // 1. Impostazioni → Negozio online → «Servicios en tu tienda»: «Eventos y bodas» con una foto.
    await page.goto('/app/las-camelias/settings/store');
    await page.getByRole('link', { name: 'Administrar servicios' }).click();
    await expect(page).toHaveURL(/\/settings\/store\/services$/);
    await page.getByTestId('service-row-event').getByRole('link', { name: 'Editar' }).click();
    await expect(page).toHaveURL(/\/settings\/store\/services\/(event|[0-9a-f-]{36})$/);
    // Le foto già presenti (un'esecuzione precedente in locale) non contano: una in più.
    const photos = page.getByTestId('service-photos').locator('img');
    const before = await photos.count();
    await page.locator('input[name="files"]').setInputFiles('e2e/fixtures/ramo.jpg');
    await page.getByRole('button', { name: 'Subir fotos' }).click();
    await expect(photos).toHaveCount(before + 1);
    await describeAndPublish(page, 'Bodas, XV años y bautizos: ramo, centros de mesa y montaje.');
    const eventSettings = page.url();
    await expectFitsAt320(page, 'service-settings');

    // Un servizio della fioreria: nome, descrizione, acceso.
    await page.goto('/app/las-camelias/settings/store/services');
    await page.getByLabel('Nuevo servicio').fill('Coronas fúnebres');
    await page.getByRole('button', { name: 'Crear servicio' }).click();
    // Si apre la scheda del servizio nuovo, spento.
    await expect(page).toHaveURL(/\/settings\/store\/services\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Coronas fúnebres' })).toBeVisible();
    await describeAndPublish(page, 'Coronas y cruces con entrega el mismo día.');
    const customSettings = page.url();

    // 2. Chi compra: la sezione «Servicios» della vetrina e la pagina del servizio.
    const visitor = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: ownClientHeaders(),
    });
    const shopper = await visitor.newPage();
    await shopper.goto('/f/las-camelias');
    const services = shopper.getByTestId('storefront-services');
    await expect(services.getByText('Eventos y bodas')).toBeVisible();
    await expect(services.getByText('Coronas fúnebres').first()).toBeVisible();
    await services.getByTestId('storefront-service-EVENT').click();
    await expect(shopper.getByTestId('service-title')).toHaveText('Eventos y bodas');
    const servicePath = new URL(shopper.url()).pathname;

    // Senza conto: «Entrar o crear cuenta» e si torna qui dopo la conferma dell'email.
    await shopper.getByTestId('service-sign-in').getByRole('link').click();
    await shopper.getByRole('link', { name: 'Regístrate' }).click();
    const email = uniqueEmail('servicios');
    const password = 'una-clave-segura-789';
    await shopper.getByLabel('Nombre completo').fill('Renata Eventos');
    await shopper.getByLabel('Correo electrónico').fill(email);
    await shopper.getByLabel('Contraseña', { exact: true }).fill(password);
    await shopper.getByLabel('Confirma la contraseña').fill(password);
    await shopper.getByRole('button', { name: 'Crear cuenta' }).click();
    const verification = await waitForEmail(email, { subject: 'Confirma tu correo' });
    await shopper.goto(linkFrom(verification, '/api/auth/verify-email'));
    await expect(shopper).toHaveURL(new RegExp(`${servicePath}$`));

    // 3. Il modulo dell'evento, con una foto di ispirazione.
    const form = shopper.getByTestId('service-request-form');
    await form.getByLabel('Tipo de evento').selectOption({ label: 'Boda' });
    await form.getByLabel('Invitados').fill('120');
    await form.getByLabel('Lugar').fill('Jardín Las Palmas, Aguascalientes');
    const date = form.getByLabel('Fecha');
    await date.fill((await date.getAttribute('min')) ?? '');
    await form.getByLabel('Presupuesto (MXN)').fill('25000');
    await form.getByLabel('Cuéntale más (opcional)').fill('Flores blancas y eucalipto.');
    await form.getByTestId('service-request-photos').setInputFiles('e2e/fixtures/rosa.jpg');
    await expect(form.getByText('rosa.jpg')).toBeVisible();
    await form.getByLabel('Tu teléfono').fill('449 555 0177');
    await expectFitsAt320(shopper, 'service-request-form');
    await form.getByRole('button', { name: 'Enviar solicitud' }).click();

    await expect(shopper).toHaveURL(/\/cuenta\/solicitudes\/[0-9a-f-]{36}\?enviada=1$/);
    await expect(shopper.getByTestId('request-sent')).toContainText(SHOP);
    await expect(shopper.getByTestId('request-status')).toHaveText('Enviada');
    await expect(shopper.getByTestId('service-request-photos-list').locator('img')).toHaveCount(1);
    const buyerRequestPath = new URL(shopper.url()).pathname;
    const received = await waitForEmail(email, { subject: 'Recibimos tu solicitud SOL-' });
    const number = /SOL-\d+/.exec(received.subject)?.[0] ?? '';
    expect(number).not.toBe('');
    await expectFitsAt320(shopper, 'buyer-request');
    // «Mis solicitudes» nel conto.
    await shopper.goto('/cuenta');
    await expect(shopper.getByTestId('account-requests')).toContainText(number);

    // 4. La fioreria: l'email senza il messaggio, «Por atender», il numero nel menu, l'elenco.
    const shopMail = await waitForEmail(OWNER_EMAIL, {
      subject: `Nueva solicitud ${number}: Eventos y bodas`,
    });
    expect(shopMail.text).not.toContain('Flores blancas y eucalipto');
    await page.goto('/app/las-camelias');
    await expect(page.getByTestId('todo-service-requests')).toBeVisible();
    await expect(
      page
        .getByRole('link', { name: /Solicitudes/ })
        .first()
        .getByTestId('nav-badge'),
    ).toBeVisible();
    await page.getByTestId('todo-service-requests').getByRole('link').click();
    await expect(page).toHaveURL(/\/requests\?filter=new$/);
    await page
      .getByTestId('requests-list')
      .getByRole('link', { name: new RegExp(number) })
      .click();
    await expect(page.getByTestId('request-status')).toHaveText('Nueva');
    await expect(page.getByText('Renata Eventos')).toBeVisible();
    await expect(page.getByText('Flores blancas y eucalipto.')).toBeVisible();
    await expect(page.getByTestId('service-request-photos-list').locator('img')).toHaveCount(1);
    const shopRequestPath = new URL(page.url()).pathname;
    await expectFitsAt320(page, 'shop-request');

    // Lo staff la vede ma non la rifiuta.
    const staffContext = await browser.newContext({ storageState: 'e2e/.auth/staff.json' });
    const staff = await staffContext.newPage();
    await staff.goto(shopRequestPath);
    await expect(staff.getByTestId('request-status')).toHaveText('Nueva');
    await expect(staff.getByTestId('decline-request-form')).toHaveCount(0);
    await staffContext.close();

    // 5. «Rechazar» con un motivo pronto.
    const decline = page.getByTestId('decline-request-form');
    await decline.getByText('No llegamos a ese lugar').click();
    await decline.getByRole('button', { name: 'Rechazar la solicitud' }).click();
    await expect(page.getByText('Solicitud rechazada: le avisamos al cliente')).toBeVisible();
    await expect(page.getByTestId('request-status')).toHaveText('Rechazada');

    // 6. Chi compra legge il motivo nel conto e per email.
    const declined = await waitForEmail(email, {
      subject: `${SHOP} no puede atender tu solicitud ${number}`,
    });
    expect(declined.text).toContain('No llegamos a ese lugar.');
    await shopper.goto(buyerRequestPath);
    await expect(shopper.getByTestId('request-status')).toHaveText('La florería no puede');
    await expect(shopper.getByTestId('request-declined')).toContainText('No llegamos a ese lugar.');
    await expect(shopper.getByTestId('request-cancel')).toHaveCount(0);
    await visitor.close();

    // Come prima per gli altri test: la foto aggiunta tolta, servizi spenti, tienda chiusa.
    await page.goto(eventSettings);
    await page.getByRole('button', { name: 'Quitar la foto' }).last().click();
    await expect(page.getByText('Foto quitada')).toBeVisible();
    await unpublish(page, eventSettings);
    await unpublish(page, customSettings);
    await closeStore(page);
  });
});
