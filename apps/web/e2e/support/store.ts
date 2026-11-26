import { expect, type Browser, type Page } from '@playwright/test';
import { linkFrom, uniqueEmail, waitForEmail } from './mailbox';

/** Un prodotto della fioreria di prova in vetrina o no (idempotente). */
export async function setItemOnline(page: Page, name: string, online: boolean): Promise<void> {
  await page.goto(`/app/las-camelias/catalog?q=${encodeURIComponent(name)}`);
  await page
    .getByRole('link', { name: new RegExp(name) })
    .first()
    .click();
  const box = page.getByRole('checkbox', { name: /Mostrar en mi tienda en línea/ });
  if ((await box.isChecked()) !== online) {
    await box.setChecked(online);
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados')).toBeVisible();
  }
}

/** Il ramo del test in vetrina, la tienda pubblicata e gli ordini online accesi (idempotente). */
export async function ensurePublishedWithOrders(page: Page): Promise<void> {
  await setItemOnline(page, 'Ramo Clásico 12 rosas', true);
  await page.goto('/app/las-camelias/settings/store');
  const transfer = page.getByRole('checkbox', { name: 'Transferencia' });
  if (!(await transfer.isChecked())) {
    await transfer.check();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Tienda actualizada.')).toBeVisible();
  }
  const publish = page.getByRole('button', { name: 'Publicar mi tienda' });
  if ((await publish.count()) > 0) {
    await publish.click();
    await expect(page.getByText('Tu tienda está publicada.')).toBeVisible();
  }
  const enabled = page.getByRole('checkbox', { name: 'Recibir pedidos desde mi tienda en línea' });
  if (!(await enabled.isChecked())) {
    await enabled.check();
    await page.getByLabel('Anticipación mínima').selectOption('1');
    await page.getByRole('button', { name: 'Guardar pedidos en línea' }).click();
    await expect(page.getByText('Pedidos en línea guardados.')).toBeVisible();
  }
  await expect(page.getByText('Activos', { exact: true })).toBeVisible();
}

/** Gli ordini online spenti e la tienda ritirata, com'era per gli altri test. */
export async function closeStore(page: Page): Promise<void> {
  await page.goto('/app/las-camelias/settings/store');
  const enabled = page.getByRole('checkbox', { name: 'Recibir pedidos desde mi tienda en línea' });
  if (await enabled.isChecked()) {
    await enabled.uncheck();
    await page.getByRole('button', { name: 'Guardar pedidos en línea' }).click();
    await expect(page.getByText('Pedidos en línea guardados.')).toBeVisible();
  }
  if ((await page.getByRole('button', { name: 'Retirar mi tienda' }).count()) > 0) {
    await page.getByRole('button', { name: 'Retirar mi tienda' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Retirar mi tienda' }).click();
    await expect(page.getByText('Tu tienda ya no es visible.')).toBeVisible();
  }
}

/** Il primo giorno che il campo propone e in cui la fioreria è aperta. */
export async function pickOpenDay(shopper: Page, label: string): Promise<void> {
  const input = shopper.getByLabel(label);
  const min = (await input.getAttribute('min')) ?? '';
  const day = new Date(`${min}T12:00:00Z`);
  for (let attempt = 0; attempt < 7; attempt += 1) {
    await input.fill(day.toISOString().slice(0, 10));
    if ((await shopper.getByText('La florería no abre ese día: elige otro.').count()) === 0) return;
    day.setUTCDate(day.getUTCDate() + 1);
  }
}

/**
 * Una persona nuova che si registra dalla tienda e arriva al modulo con il ramo nel carrello
 * (M3, ordini online). `prefix`: l'inizio dell'email di prova.
 */
export async function newBuyer(browser: Browser, name: string, prefix = 'mensajes') {
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const shopper = await visitor.newPage();
  await shopper.goto('/f/las-camelias');
  await shopper
    .getByRole('link', { name: /Ramo Clásico 12 rosas/ })
    .first()
    .click();
  await shopper.getByRole('button', { name: 'Pedir ahora' }).click();
  await shopper.getByRole('link', { name: 'Regístrate' }).click();
  const email = uniqueEmail(prefix);
  const password = 'una-clave-segura-789';
  await shopper.getByLabel('Nombre completo').fill(name);
  await shopper.getByLabel('Correo electrónico').fill(email);
  await shopper.getByLabel('Contraseña', { exact: true }).fill(password);
  await shopper.getByLabel('Confirma la contraseña').fill(password);
  await shopper.getByRole('button', { name: 'Crear cuenta' }).click();
  const verification = await waitForEmail(email, { subject: 'Confirma tu correo' });
  await shopper.goto(linkFrom(verification, '/api/auth/verify-email'));
  await expect(shopper).toHaveURL(/\/f\/las-camelias\/pedido$/);
  return { visitor, shopper, email };
}

/** Dal modulo con il ramo nel carrello: consegna (o ritiro) e invio. Restituisce «PED-…». */
export async function sendOrder(shopper: Page, mode: 'DELIVERY' | 'PICKUP'): Promise<string> {
  await expect(shopper.getByRole('heading', { level: 1, name: 'Hacer un pedido' })).toBeVisible();
  await shopper.getByRole('button', { name: 'Continuar' }).click();
  if (mode === 'PICKUP') {
    await shopper.getByRole('radio', { name: 'Recoger en la tienda' }).check();
    await pickOpenDay(shopper, 'Día para recoger');
  } else {
    await pickOpenDay(shopper, 'Día de entrega');
    await shopper.getByLabel('Calle y número').fill('Av. Madero 120');
    await shopper.getByLabel('Colonia').fill('Centro');
    await shopper.getByLabel('Código postal').fill('20000');
    await shopper.getByLabel('Municipio o alcaldía').fill('Aguascalientes');
    await shopper.getByLabel('Quién recibe').fill('Lucía');
  }
  await shopper.getByRole('button', { name: 'Continuar' }).click();
  await shopper.getByRole('button', { name: 'Continuar' }).click();
  await shopper.getByLabel('Tu teléfono').fill('449 555 0188');
  await shopper.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(shopper).toHaveURL(/\/pedido\/[\w-]+\?enviado=1$/);
  const title = (await shopper.getByRole('heading', { level: 1 }).textContent()) ?? '';
  const number = /PED-\d+/.exec(title)?.[0];
  expect(number).toBeTruthy();
  return number!;
}
