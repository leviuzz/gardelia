import { expect, test } from '@playwright/test';
import { E2E_CRON_SECRET } from '../playwright.config';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';
import { signUpWithNewShop } from './support/shop';

/**
 * Promo delle date speciali (ADR-047): la pagina Promociones (sconto, anteprima), l'email
 * automatica in una fioreria reale, lo stato nel calendario e la disiscrizione dal link.
 */

/** Data (nel fuso del Messico) fra `days` giorni. */
function mexicoDatePlus(days: number) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return {
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    iso: date.toISOString().slice(0, 10),
  };
}

test.describe('promociones (florería demo)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('si sceglie lo sconto e si vede il correo; nella demo non parte nulla', async ({ page }) => {
    await page.goto('/app/las-camelias/promotions');
    await expect(page.getByRole('heading', { name: 'Promociones', level: 1 })).toBeVisible();
    await expect(page.getByText('Estás en una florería de demostración: puedes')).toBeVisible();

    // Attivarla senza sconto: errore sul campo.
    const enabled = page.getByLabel('Enviar el correo automáticamente');
    const percent = page.getByLabel('Porcentaje de descuento');
    await page.getByLabel('Porcentaje', { exact: true }).check();
    await enabled.check();
    await percent.fill('');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Este campo es obligatorio.')).toBeVisible();

    await percent.fill('15');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('15% de descuento para tu cumpleaños')).toBeVisible();
    await expect(
      page.frameLocator('iframe[title="Así lo verá tu cliente"]').getByText('Hola, María:'),
    ).toBeVisible();

    await page.getByLabel('Monto fijo').check();
    await page.getByLabel('Descuento en MXN').fill('100');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('$100.00 de descuento para tu cumpleaños')).toBeVisible();

    // Di nuovo come all'inizio (spenta, senza sconto): i dati demo sono condivisi fra i test.
    await page.getByLabel('Porcentaje', { exact: true }).check();
    await percent.fill('');
    await enabled.uncheck();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Elige el descuento y guarda para ver el correo.')).toBeVisible();
    await page.reload();
    await expect(enabled).not.toBeChecked();
  });
});

test.describe('promociones (staff)', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('lo staff non gestisce le promozioni', async ({ page }) => {
    await page.goto('/app/las-camelias/promotions');
    await expect(page.getByText('Sin acceso a esta sección')).toBeVisible();
  });
});

test.describe('promociones (florería real)', () => {
  test('il cliente riceve l’email, si vede nel calendario e si disiscrive dal link', async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const shopName = `Florería Promo ${Date.now()}`;
    const { slug } = await signUpWithNewShop(page, { name: 'Rosa Martínez', shopName });

    await page.goto(`/app/${slug}/promotions`);
    await expect(page.getByText('Estás en una florería de demostración: puedes')).toHaveCount(0);
    await page.getByLabel('Enviar el correo automáticamente').check();
    await page.getByLabel('Porcentaje de descuento').fill('20');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('20% de descuento para tu cumpleaños')).toBeVisible();

    // Cliente con correo, consenso e compleanno fra 3 giorni (preavviso predefinito: 7).
    const customerEmail = uniqueEmail('cliente-promo');
    const date = mexicoDatePlus(3);
    await page.goto(`/app/${slug}/customers/new`);
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Lucía Promo');
    await page.getByLabel('Correo electrónico').fill(customerEmail);
    await page.getByLabel('Acepta recibir promociones').check();
    await page.getByRole('button', { name: 'Agregar fecha' }).click();
    const row = page.getByRole('group', { name: 'Fecha 1' });
    await row.getByRole('spinbutton', { name: 'Día', exact: true }).fill(String(date.day));
    await row.getByRole('combobox', { name: 'Mes', exact: true }).selectOption(String(date.month));
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
    const customerPath = new URL(page.url()).pathname;

    // I lavori giornalieri (Vercel Cron, alle 9 del Messico) mandano l'email.
    const cron = { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } };
    expect((await request.post('/api/internal/maintenance', cron)).ok()).toBe(true);
    const email = await waitForEmail(customerEmail, { subject: 'de descuento' });
    expect(email.subject).toBe('20% de descuento para tu cumpleaños');
    expect(email.text).toContain('Hola, Lucía Promo:');
    expect(email.text).toContain(shopName);

    // Nel calendario la data dice che la promo è partita.
    await page.goto(`/app/${slug}/calendar?view=day&date=${date.iso}`);
    await expect(page.getByRole('article').filter({ hasText: 'Lucía Promo' })).toContainText(
      'Promoción enviada el',
    );

    // Il cliente, senza sessione, apre il link dell'email e conferma.
    const unsubscribeLink = linkFrom(email, '/unsubscribe/');
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    await customerPage.goto(unsubscribeLink);
    await expect(
      customerPage.getByRole('heading', {
        name: `¿Ya no quieres recibir promociones de ${shopName}?`,
      }),
    ).toBeVisible();
    await customerPage.getByRole('button', { name: 'Sí, ya no quiero recibirlas' }).click();
    await expect(customerPage.getByRole('heading', { name: 'Listo' })).toBeVisible();
    await expect(
      customerPage.getByText(`Ya no recibirás promociones de ${shopName}.`),
    ).toBeVisible();
    await customerContext.close();

    // Disiscrizione con un clic dei programmi di posta: idempotente; un GET non disiscrive.
    const oneClick = unsubscribeLink.replace('/unsubscribe/', '/api/unsubscribe/');
    expect((await request.post(oneClick)).status()).toBe(200);
    expect((await request.get(oneClick, { maxRedirects: 0 })).status()).toBe(303);
    expect((await request.post(`${oneClick.slice(0, -2)}xx`)).status()).toBe(404);

    // Il fiorista vede il consenso tolto.
    await page.goto(customerPath);
    await expect(page.getByLabel('Acepta recibir promociones')).not.toBeChecked();
  });
});
