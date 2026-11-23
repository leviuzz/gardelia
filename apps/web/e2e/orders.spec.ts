import { expect, test, type Page } from '@playwright/test';

/** Cotización aceptada para Hotel Casa Fuentes con un Ramo Clásico ($690.00). */
async function acceptedQuote(page: Page) {
  await page.goto('/app/las-camelias/customers');
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
  await page.getByRole('button', { name: 'Marcar como enviada' }).click();
  await expect(page.getByText('Estado actualizado: Enviada')).toBeVisible();
  await page.getByRole('button', { name: 'Marcar como aceptada' }).click();
  await expect(page.getByText('Estado actualizado: Aceptada')).toBeVisible();
}

test.describe('pedidos (propietaria)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('de la cotización aceptada al pedido entregado, con pagos', async ({ page }) => {
    await acceptedQuote(page);
    const quoteUrl = page.url();

    // Convertir en pedido: entrega a domicilio con dirección nueva, horario y tarjeta.
    await page.getByRole('link', { name: 'Convertir en pedido' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Convertir en pedido' }),
    ).toBeVisible();
    await page.getByLabel('Desde').fill('10:00');
    await page.getByLabel('Hasta').fill('09:00');
    await page.getByRole('textbox', { name: 'Calle y número' }).fill('Av. Universidad 940');
    await page.getByRole('textbox', { name: 'Colonia' }).fill('Ciudad Universitaria');
    await page.getByRole('textbox', { name: 'Código postal' }).fill('20100');
    await page.getByRole('textbox', { name: 'Municipio o alcaldía' }).fill('Aguascalientes');
    await page.getByRole('textbox', { name: 'Nombre de quien recibe' }).fill('Recepción');
    await page.getByRole('textbox', { name: 'Mensaje' }).fill('¡Bienvenidos a Aguascalientes!');
    await page.getByRole('checkbox', { name: 'Enviar sin firma (anónimo)' }).check();
    await page.getByRole('textbox', { name: 'Costo de envío (MXN)' }).fill('80');
    await page.getByRole('button', { name: 'Crear pedido' }).click();
    // L'orario al contrario lo rifiuta il server, senza perdere i dati scritti.
    await expect(page.getByText('Indica la hora de inicio y la de fin, en orden.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Calle y número' })).toHaveValue(
      'Av. Universidad 940',
    );
    await page.getByLabel('Hasta').fill('13:00');
    await page.getByRole('button', { name: 'Crear pedido' }).click();

    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('PED-');
    await expect(page.getByTestId('order-total')).toHaveText('$770.00');
    await expect(page.getByTestId('order-balance')).toHaveText('$770.00');
    await expect(page.getByText('¡Bienvenidos a Aguascalientes!').first()).toBeVisible();
    await expect(page.getByText('Sin firma (anónimo)', { exact: true })).toBeVisible();
    await expect(page.getByText('Av. Universidad 940')).toBeVisible();
    await expect(page.getByText('10:00 a 13:00').first()).toBeVisible();

    // Anticipo: l'importo proposto è il saldo; si registra un anticipo parziale.
    await page.getByRole('textbox', { name: 'Importe (MXN)' }).fill('300');
    await page.getByRole('combobox', { name: 'Forma de pago' }).selectOption('TRANSFER');
    await page.getByRole('button', { name: 'Registrar pago' }).click();
    await expect(page.getByText('Pago registrado')).toBeVisible();
    await expect(page.getByTestId('order-balance')).toHaveText('$470.00');
    await expect(page.getByText('Con anticipo').first()).toBeVisible();

    // Un pago mayor que el saldo lo rechaza el servidor.
    await page.getByRole('textbox', { name: 'Importe (MXN)' }).fill('1000');
    await page.getByRole('button', { name: 'Registrar pago' }).click();
    await expect(page.getByText('El importe es mayor que lo que falta por cobrar.')).toBeVisible();

    // Avance hasta entregado; la historia guarda cada paso.
    for (const [step, status] of [
      ['Empezar a preparar', 'En preparación'],
      ['Marcar listo', 'Listo'],
      ['Salió a entregar', 'En camino'],
      ['Marcar entregado', 'Entregado'],
    ] as const) {
      await page.getByRole('button', { name: step }).click();
      await expect(page.getByText(`Pedido marcado como «${status}»`)).toBeVisible();
    }
    await expect(page.getByText('Este pedido ya no tiene pasos pendientes.')).toBeVisible();
    await expect(page.getByText('«En camino» → «Entregado»')).toBeVisible();
    // Uscito il pedido, entrega y tarjeta ya no se cambian.
    await expect(page.getByText('Cambiar entrega y tarjeta')).toHaveCount(0);

    // Dalla cotización si torna al pedido; il pedido è nell'elenco di oggi.
    const orderNumber = (await page.getByRole('heading', { level: 1 }).textContent())?.match(
      /PED-\d+/,
    )?.[0];
    expect(orderNumber).toBeTruthy();
    await page.goto(quoteUrl);
    await expect(page.getByRole('link', { name: `Ver pedido ${orderNumber}` })).toBeVisible();
    await page.goto('/app/las-camelias/orders?when=today');
    await expect(page.getByRole('link', { name: new RegExp(orderNumber ?? 'PED') })).toBeVisible();
  });

  test('cancelar pide el motivo y lo deja en la historia', async ({ page }) => {
    await acceptedQuote(page);
    await page.getByRole('link', { name: 'Convertir en pedido' }).click();
    await page.getByRole('radio', { name: 'Recoge en tienda' }).check();
    await page.getByRole('button', { name: 'Crear pedido' }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('order-total')).toHaveText('$690.00');

    await page.getByRole('button', { name: 'Cancelar pedido' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Motivo' }).fill('El cliente ya no lo necesita');
    await dialog.getByRole('button', { name: 'Cancelar pedido' }).click();
    await expect(page.getByText('Pedido cancelado')).toBeVisible();
    await expect(page.getByText('Cancelado: El cliente ya no lo necesita')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0);
  });
});

test.describe('pedidos (banco)', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('el banco ve los pedidos pero no convierte cotizaciones', async ({ page }) => {
    await page.goto('/app/las-camelias/orders?when=all');
    await expect(page.getByRole('heading', { level: 1, name: 'Pedidos' })).toBeVisible();
    await page.goto('/app/las-camelias/quotes?status=ACCEPTED');
    const accepted = page.getByRole('link', { name: /COT-/ }).first();
    if ((await accepted.count()) > 0) {
      await accepted.click();
      await expect(page.getByRole('link', { name: 'Convertir en pedido' })).toHaveCount(0);
    }
  });
});
