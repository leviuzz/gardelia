import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Link pubblici (ADR-056): il cliente apre preventivo e ordine senza account, accetta il
 * preventivo e segue l'ordine; la fioreria disattiva il link quando vuole. In più la tarjeta da
 * stampare.
 */

/** Cotización enviada para Hotel Casa Fuentes con un Ramo Clásico ($690.00). */
async function sentQuote(page: Page) {
  await page.goto('/app/las-camelias/customers?q=Hotel%20Casa%20Fuentes');
  await page.getByRole('link', { name: /Hotel Casa Fuentes/ }).click();
  await page.getByRole('link', { name: 'Nueva cotización' }).click();
  await page.getByRole('button', { name: 'Crear cotización' }).click();
  await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
  const addForm = page
    .locator('form')
    .filter({ has: page.getByRole('combobox', { name: 'Producto' }) });
  await addForm
    .getByRole('combobox', { name: 'Producto' })
    .selectOption({ label: 'Ramo Clásico 12 rosas — $690.00 por pieza' });
  await addForm.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByTestId('quote-total')).toHaveText('$690.00');
  // In bozza il link non si crea ancora.
  await expect(
    page.getByText('Marca la cotización como enviada para compartir el enlace.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Marcar como enviada' }).click();
  await expect(page.getByText('Estado actualizado: Enviada')).toBeVisible();
}

async function createLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Crear enlace' }).click();
  await expect(page.getByText('Enlace listo para compartir.')).toBeVisible();
  const url = await page.getByRole('textbox', { name: 'Enlace' }).inputValue();
  expect(url).toMatch(/\/(cotizacion|pedido)\/[A-Za-z0-9_-]{64}$/);
  return new URL(url).pathname;
}

/** Il cliente: un browser senza sessione. */
async function customerPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.describe('link pubblici (propietaria)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('il cliente accetta la cotización dal link; disattivato non vale più', async ({
    page,
    browser,
  }) => {
    await sentQuote(page);
    const quoteUrl = page.url();
    const path = await createLink(page);

    const customer = await customerPage(browser);
    await customer.goto(path);
    await expect(customer.getByRole('heading', { level: 1 })).toContainText('Cotización COT-');
    await expect(customer.getByText('Para Hotel Casa Fuentes')).toBeVisible();
    await expect(customer.getByTestId('public-total')).toHaveText('$690.00');
    await customer.getByRole('button', { name: 'Aceptar cotización' }).click();
    await expect(customer.getByText(/Aceptaste esta cotización el/)).toBeVisible();
    await expect(customer.getByRole('button', { name: 'Aceptar cotización' })).toHaveCount(0);

    // La fioreria la vede accettata e può convertirla in pedido.
    await page.goto(quoteUrl);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Aceptada');
    await expect(page.getByRole('link', { name: 'Convertir en pedido' })).toBeVisible();

    await page.getByRole('button', { name: 'Desactivar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Desactivar' }).click();
    await expect(page.getByText('Enlace desactivado.')).toBeVisible();
    await customer.reload();
    await expect(customer.getByRole('heading', { name: 'Enlace no válido' })).toBeVisible();
    await customer.context().close();
  });

  test('il cliente segue il pedido fino alla foto del ramo, e la tarjeta si stampa', async ({
    page,
    browser,
  }) => {
    await sentQuote(page);
    await page.getByRole('button', { name: 'Marcar como aceptada' }).click();
    await expect(page.getByText('Estado actualizado: Aceptada')).toBeVisible();
    await page.getByRole('link', { name: 'Convertir en pedido' }).click();
    await page.getByRole('radio', { name: 'Recoge en tienda' }).check();
    await page.getByRole('textbox', { name: 'Mensaje' }).fill('¡Gracias por todo, equipo!');
    await page.getByRole('textbox', { name: 'Firma' }).fill('Hotel Casa Fuentes');
    await page.getByRole('button', { name: 'Crear pedido' }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const orderUrl = page.url();

    const path = await createLink(page);
    const customer = await customerPage(browser);
    await customer.goto(path);
    await expect(customer.getByRole('heading', { level: 1 })).toContainText('Pedido PED-');
    await expect(customer.getByText(/Recoges en la tienda/)).toBeVisible();
    await expect(customer.getByText('¡Gracias por todo, equipo!')).toBeVisible();
    await expect(customer.getByTestId('public-total')).toHaveText('$690.00');
    const progress = customer.getByRole('list', { name: 'Avance del pedido' });
    await expect(progress.getByText('Confirmado')).toBeVisible();
    await expect(progress.getByText('Recogido')).toBeVisible();

    await page.getByRole('button', { name: 'Empezar a preparar' }).click();
    await expect(page.getByText('Pedido marcado como «En preparación»')).toBeVisible();
    await customer.reload();
    await expect(customer.getByText('paso actual')).toHaveCount(1);
    await expect(
      progress.getByRole('listitem').filter({ hasText: 'En preparación' }).getByText('paso actual'),
    ).toHaveCount(1);

    // Prova di consegna (ADR-058): foto del ramo finito e chi l'ha ritirato; il cliente le vede.
    await page.getByRole('button', { name: 'Marcar listo' }).click();
    await expect(page.getByText('Pedido marcado como «Listo»')).toBeVisible();
    await page
      .getByRole('button', { name: 'Foto del ramo terminado' })
      .setInputFiles('e2e/fixtures/ramo.jpg');
    await page.getByRole('button', { name: 'Subir foto' }).click();
    await expect(page.getByText('Se subió 1 foto')).toBeVisible();
    await expect(page.getByRole('img', { name: /Ramo terminado del pedido PED-/ })).toBeVisible();
    await page.getByRole('button', { name: 'Marcar recogido' }).click();
    await expect(page.getByText('Pedido marcado como «Recogido»')).toBeVisible();
    await page.getByRole('textbox', { name: '¿Quién lo recibió?' }).fill('Carmen');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Entrega registrada.')).toBeVisible();
    await customer.reload();
    await expect(customer.getByText('Así quedó tu ramo')).toBeVisible();
    await expect(customer.getByRole('img', { name: 'Foto de tu ramo terminado' })).toBeVisible();
    await expect(customer.getByText('Lo recibió Carmen.')).toBeVisible();
    await customer.context().close();

    await page.goto(orderUrl);
    await page.getByRole('link', { name: 'Imprimir tarjeta' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Imprimir tarjeta' })).toBeVisible();
    await expect(page.getByTestId('printed-card')).toContainText('¡Gracias por todo, equipo!');
    await expect(page.getByTestId('printed-card')).toContainText('— Hotel Casa Fuentes');
  });

  test('un link inventato non apre nulla', async ({ browser }) => {
    const customer = await customerPage(browser);
    await customer.goto(`/cotizacion/${'A'.repeat(64)}`);
    await expect(customer.getByRole('heading', { name: 'Enlace no válido' })).toBeVisible();
    await customer.goto('/pedido/no-existe');
    await expect(customer.getByRole('heading', { name: 'Enlace no válido' })).toBeVisible();
    await customer.context().close();
  });
});

test.describe('link pubblici (banco)', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('il banco non crea link', async ({ page }) => {
    await page.goto('/app/las-camelias/orders?when=all');
    await page.getByRole('link', { name: /PED-/ }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('PED-');
    await expect(page.getByRole('button', { name: 'Crear enlace' })).toHaveCount(0);
  });
});
