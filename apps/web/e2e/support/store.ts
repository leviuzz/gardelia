import { expect, type Page } from '@playwright/test';

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
