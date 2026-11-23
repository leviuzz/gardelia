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

test.describe('pedido directo (propietaria)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('sin cotización: productos, concepto libre y descuento, luego se confirma', async ({
    page,
  }) => {
    await page.goto('/app/las-camelias/orders');
    await page.getByRole('link', { name: 'Nuevo pedido' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Nuevo pedido' })).toBeVisible();
    await page.getByRole('button', { name: 'Pedido para Hotel Casa Fuentes' }).click();

    // Borrador: prima i prodotti, la consegna si chiede solo quando c'è qualcosa da consegnare.
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('PED-');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Borrador');
    await expect(
      page.getByText('Agrega al menos un producto para poder confirmar el pedido.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar pedido' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Continuar' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Pasos' })).toBeVisible();

    const addForm = page
      .locator('form')
      .filter({ has: page.getByRole('combobox', { name: 'Producto' }) });
    await addForm
      .getByRole('combobox', { name: 'Producto' })
      .selectOption({ label: 'Ramo Clásico 12 rosas — $690.00 por pieza' });
    await addForm.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(page.getByTestId('order-total')).toHaveText('$690.00');

    await page.getByRole('button', { name: 'Agregar concepto libre' }).click();
    await page.getByRole('textbox', { name: 'Concepto' }).fill('Globo metálico');
    await page.getByRole('textbox', { name: 'Precio unitario (MXN)' }).fill('45.50');
    await page
      .locator('form')
      .filter({ has: page.getByRole('textbox', { name: 'Concepto' }) })
      .getByRole('button', { name: 'Agregar', exact: true })
      .click();
    await expect(page.getByTestId('order-total')).toHaveText('$735.50');

    await page.getByRole('textbox', { name: 'Descuento (MXN)' }).fill('35.50');
    await page.getByRole('button', { name: 'Aplicar descuento' }).click();
    await expect(page.getByText('Descuento actualizado.')).toBeVisible();
    await expect(page.getByTestId('order-total')).toHaveText('$700.00');
    // Nuevo pedido a passi: dai prodotti si continua alla consegna.
    await page.getByRole('link', { name: 'Continuar' }).click();
    await expect(page).toHaveURL(/\?step=delivery$/);

    // Conferma con ritiro in negozio: diventa un ordine come gli altri.
    await page.getByRole('radio', { name: 'Recoge en tienda' }).check();
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await expect(page.getByText('Pedido confirmado.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Confirmado');
    await expect(page.getByTestId('order-total')).toHaveText('$700.00');
    await expect(page.getByTestId('order-balance')).toHaveText('$700.00');
    await expect(page.getByText('«Borrador» → «Confirmado»')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Empezar a preparar' })).toBeVisible();
    // Fino a "listo" i prodotti si possono ancora cambiare.
    await expect(page.getByText('Cambiar productos o descuento')).toBeVisible();
  });

  test('un borrador se descarta sin motivo y sale de la lista', async ({ page }) => {
    await page.goto('/app/las-camelias/customers');
    await page.getByRole('link', { name: /Hotel Casa Fuentes/ }).click();
    await page.getByRole('link', { name: 'Nuevo pedido' }).click();
    await expect(page.getByText('Pedido para Hotel Casa Fuentes')).toBeVisible();
    await page.getByRole('button', { name: 'Crear pedido' }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const number = (await page.getByRole('heading', { level: 1 }).textContent())?.match(
      /PED-\d+/,
    )?.[0];
    expect(number).toBeTruthy();

    await page.goto('/app/las-camelias/orders?when=drafts');
    await page.getByRole('link', { name: new RegExp(number ?? 'PED') }).click();
    await page.getByRole('button', { name: 'Descartar borrador' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Descartar' }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await page.goto('/app/las-camelias/orders?when=drafts');
    await expect(page.getByRole('link', { name: new RegExp(number ?? 'PED') })).toHaveCount(0);
  });
});

test.describe('pedidos (banco)', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('el banco ve los pedidos pero no los crea ni convierte cotizaciones', async ({ page }) => {
    await page.goto('/app/las-camelias/orders?when=all');
    await expect(page.getByRole('heading', { level: 1, name: 'Pedidos' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nuevo pedido' })).toHaveCount(0);
    await page.goto('/app/las-camelias/orders/new');
    await expect(page.getByRole('button', { name: /Pedido para/ })).toHaveCount(0);
    await page.goto('/app/las-camelias/quotes?status=ACCEPTED');
    const accepted = page.getByRole('link', { name: /COT-/ }).first();
    if ((await accepted.count()) > 0) {
      await accepted.click();
      await expect(page.getByRole('link', { name: 'Convertir en pedido' })).toHaveCount(0);
    }
  });
});
