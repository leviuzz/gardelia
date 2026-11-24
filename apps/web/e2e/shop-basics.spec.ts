import { expect, test } from '@playwright/test';
import { signUpWithNewShop } from './support/shop';

/**
 * Dati della fioreria nelle impostazioni (V1 §2.2): vigenza delle cotizaciones, orario di apertura
 * con più fasce per giorno, logo caricato da Ajustes e intestazione della cotización stampata.
 */

test('vigencia, horario con varias franjas y logo; la cotización impresa lleva el membrete', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const shopName = `Florería Membrete ${Date.now()}`;
  const { slug } = await signUpWithNewShop(page, { name: 'Lucía Pérez', shopName });
  await page.goto(`/app/${slug}/settings`);

  // Vigencia delle cotizaciones nuove.
  const validity = page.getByRole('spinbutton', { name: 'Vigencia (días)' });
  await expect(validity).toHaveValue('7');
  await validity.fill('15');
  await page
    .locator('form')
    .filter({ has: validity })
    .getByRole('button', { name: 'Guardar', exact: true })
    .click();
  await expect(page.getByText('Vigencia guardada')).toBeVisible();

  // Orario: lunes con due fasce (cierra a mediodía), martes copia il lunes, miércoles corrido.
  const hours = page.locator('#hours');
  await expect(hours.getByRole('switch', { name: 'Abierto el lunes' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await hours.getByRole('switch', { name: 'Abierto el lunes' }).click();
  await expect(hours.getByLabel('lunes, horario 1: desde')).toHaveValue('09:00');
  await hours.getByLabel('lunes, horario 1: hasta').fill('14:00');
  await hours.getByRole('button', { name: 'Agregar horario el lunes' }).click();
  await expect(hours.getByLabel('lunes, horario 2: desde')).toHaveValue('14:00');
  await hours.getByLabel('lunes, horario 2: desde').fill('16:00');
  await hours.getByLabel('lunes, horario 2: hasta').fill('20:00');
  await hours.getByRole('switch', { name: 'Abierto el martes' }).click();
  await expect(hours.getByLabel('martes, horario 2: hasta')).toHaveValue('20:00');

  // Una fascia che si sovrappone: errore sulla fascia, niente salvato.
  await hours.getByRole('switch', { name: 'Abierto el miércoles' }).click();
  await hours.getByRole('button', { name: 'Quitar el horario 2 del miércoles' }).click();
  await hours.getByLabel('miércoles, horario 1: hasta').fill('19:00');
  await hours.getByRole('button', { name: 'Agregar horario el miércoles' }).click();
  await hours.getByLabel('miércoles, horario 2: desde').fill('12:00');
  await hours.getByLabel('miércoles, horario 2: hasta').fill('15:00');
  await hours.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(
    hours.getByText('Este horario se cruza con otro del mismo día: júntalos en uno solo.'),
  ).toBeVisible();
  await hours.getByRole('button', { name: 'Quitar el horario 2 del miércoles' }).click();
  await hours.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Horario guardado')).toBeVisible();

  // I giorni chiusi accettano ancora consegne: la pagina lo segnala.
  await page.reload();
  await expect(page.getByTestId('hours-delivery-mismatch')).toContainText('Domingo');
  await expect(hours.getByLabel('lunes, horario 2: desde')).toHaveValue('16:00');
  await expect(hours.getByRole('switch', { name: 'Abierto el jueves' })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  // Logo da Ajustes (lo stesso della tienda en línea).
  await page.getByLabel('Archivo del logo').setInputFiles('e2e/fixtures/ramo.jpg');
  await page.getByRole('button', { name: 'Subir logo' }).click();
  await expect(page.getByText('Se subió 1 foto')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar logo' })).toBeVisible();

  // Una cotización: vigencia di 15 giorni e intestazione con logo, indirizzo e orario in stampa.
  await page.goto(`/app/${slug}/customers/new`);
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Marta Membrete');
  await page.getByRole('button', { name: 'Crear cliente' }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
  await page.getByRole('link', { name: 'Nueva cotización' }).click();
  await page.getByRole('button', { name: 'Crear cotización' }).click();
  await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);

  const letterhead = page.getByTestId('print-letterhead');
  await expect(letterhead).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  await expect(letterhead).toBeVisible();
  await expect(letterhead).toContainText(shopName);
  await expect(letterhead).toContainText('Av. Universidad 940, Ciudad Universitaria, C.P. 20131');
  await expect(letterhead).toContainText('Lunes a martes09:00–14:00, 16:00–20:00');
  await expect(letterhead).toContainText('Miércoles09:00–19:00');
  await expect(letterhead).toContainText('Jueves a domingoCerrado');
  const logo = letterhead.getByRole('img', { name: `Logo de ${shopName}` });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});
