import { expect, test, type Page } from '@playwright/test';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';

/**
 * Ordine dalla tienda en línea (marketplace, blocco C4, ADR-067): la proprietaria accende gli
 * ordini online; chi compra si registra dal modulo, sceglie un ramo, la consegna e la tarjeta e
 * lo invia; la fioreria lo accetta e chi compra vede come pagare e lo stato in "Mis pedidos".
 * Un secondo ordine, da ritirare, chi compra lo annulla da "Mis pedidos" prima della risposta.
 * Alla fine la tienda torna com'era (ordini spenti, non pubblicata) per gli altri test.
 */

const OWNER_EMAIL = 'duena@lascamelias.test';

async function ensurePublishedWithOrders(page: Page): Promise<void> {
  // Il ramo si mostra in linea (idempotente).
  await page.goto('/app/las-camelias/catalog?q=Ramo+Cl%C3%A1sico');
  await page
    .getByRole('link', { name: /Ramo Clásico 12 rosas/ })
    .first()
    .click();
  const online = page.getByRole('checkbox', { name: /Mostrar en mi tienda en línea/ });
  if (!(await online.isChecked())) {
    await online.check();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados')).toBeVisible();
  }

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

test.describe('pedido en línea (cliente y florería)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('el cliente pide, la florería acepta y el cliente ve cómo pagar', async ({
    page,
    browser,
  }) => {
    await ensurePublishedWithOrders(page);

    // Chi compra, senza account: dal prodotto al modulo, che chiede l'accesso.
    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const shopper = await visitor.newPage();
    await shopper.goto('/f/las-camelias');
    await shopper.getByRole('link', { name: /Ramo Clásico 12 rosas/ }).click();
    await shopper.getByRole('link', { name: 'Pedir en línea' }).click();
    await expect(shopper).toHaveURL(/\/login\?next=%2Ff%2Flas-camelias%2Fpedido/);
    await expect(shopper.getByText('Entra a tu cuenta.')).toBeVisible();
    await shopper.getByRole('link', { name: 'Regístrate' }).click();

    const email = uniqueEmail('comprador');
    const password = 'una-clave-segura-789';
    await shopper.getByLabel('Nombre completo').fill('Mariana Ruiz');
    await shopper.getByLabel('Correo electrónico').fill(email);
    await shopper.getByLabel('Contraseña', { exact: true }).fill(password);
    await shopper.getByLabel('Confirma la contraseña').fill(password);
    await shopper.getByRole('button', { name: 'Crear cuenta' }).click();
    const verification = await waitForEmail(email, { subject: 'Confirma tu correo' });
    await shopper.goto(linkFrom(verification, '/api/auth/verify-email'));
    await expect(shopper).toHaveURL(/\/f\/las-camelias\/pedido\?producto=/);
    await expect(shopper.getByRole('heading', { level: 1, name: 'Hacer un pedido' })).toBeVisible();

    // 1. Prodotti: il ramo scelto c'è già; se ne aggiunge un altro.
    const quantity = shopper.getByRole('spinbutton', { name: 'Ramo Clásico 12 rosas' });
    await expect(quantity).toHaveValue('1');
    await shopper.getByRole('button', { name: 'Uno más de Ramo Clásico 12 rosas' }).click();
    await expect(quantity).toHaveValue('2');
    await shopper.getByRole('button', { name: 'Continuar' }).click();

    // 2. Consegna: senza indirizzo il passo non va avanti.
    await expect(shopper.getByLabel('Día de entrega')).toBeVisible();
    await shopper.getByRole('button', { name: 'Continuar' }).click();
    await expect(shopper.getByLabel('Día de entrega')).toBeFocused();
    // Il primo giorno ordinabile in cui la fioreria è aperta.
    const dateInput = shopper.getByLabel('Día de entrega');
    const min = (await dateInput.getAttribute('min')) ?? '';
    const day = new Date(`${min}T12:00:00Z`);
    for (let attempt = 0; attempt < 7; attempt += 1) {
      await dateInput.fill(day.toISOString().slice(0, 10));
      if ((await shopper.getByText('La florería no abre ese día: elige otro.').count()) === 0)
        break;
      day.setUTCDate(day.getUTCDate() + 1);
    }
    await shopper.getByLabel('Calle y número').fill('Av. Madero 120');
    await shopper.getByLabel('Colonia').fill('Centro');
    await shopper.getByLabel('Código postal').fill('20000');
    await shopper.getByLabel('Municipio o alcaldía').fill('Aguascalientes');
    await shopper.getByLabel('Quién recibe').fill('Lucía');
    await shopper.getByRole('button', { name: 'Continuar' }).click();

    // 3. Tarjeta.
    await shopper.getByLabel('Mensaje de la tarjeta').fill('¡Feliz cumpleaños, mamá!');
    await shopper.getByLabel('Comentarios para la florería').fill('Colores pastel, por favor.');
    await shopper.getByRole('button', { name: 'Continuar' }).click();

    // 4. Riepilogo: due ramos al prezzo del catalogo; il telefono è obbligatorio.
    await expect(shopper.getByText('2 × Ramo Clásico 12 rosas')).toBeVisible();
    await expect(shopper.getByText('Av. Madero 120, Centro, Aguascalientes')).toBeVisible();
    // Prima di inviare: i termini per chi compra (ADR-068).
    await expect(
      shopper.getByRole('link', { name: 'Términos para compradores' }).first(),
    ).toHaveAttribute('href', '/terminos/compradores');
    await shopper.getByLabel('Tu teléfono').fill('449 555 0177');
    await shopper.getByRole('button', { name: 'Enviar pedido' }).click();

    await expect(shopper).toHaveURL(/\/pedido\/[\w-]+\?enviado=1$/);
    await expect(
      shopper.getByText('¡Listo! Enviamos tu pedido a Florería Las Camelias.', { exact: false }),
    ).toBeVisible();
    await expect(shopper.getByText(/Esperando que Florería Las Camelias acepte/)).toBeVisible();
    const trackingUrl = shopper.url().replace(/\?enviado=1$/, '');

    // Email: a chi compra e alla proprietaria.
    await waitForEmail(email, { subject: 'Recibimos tu pedido' });
    const notice = await waitForEmail(OWNER_EMAIL, { subject: 'Nuevo pedido en línea' });
    const orderPath = new URL(linkFrom(notice, '/app/las-camelias/orders/')).pathname;

    // La fioreria: avviso nell'elenco, poi accetta dalla scheda.
    await page.goto('/app/las-camelias/orders');
    await expect(page.getByText(/pedidos? en línea por aceptar/)).toBeVisible();
    await page.goto(orderPath);
    const panel = page.getByTestId('online-pending');
    await expect(panel.getByText('Pedido en línea por aceptar')).toBeVisible();
    await expect(panel.getByText('Colores pastel, por favor.')).toBeVisible();
    await expect(page.getByText('En línea', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Aceptar pedido' }).click();
    await expect(
      page.getByText('Pedido aceptado: le avisamos al cliente por correo.'),
    ).toBeVisible();
    await expect(page.getByTestId('online-pending')).toHaveCount(0);

    // Chi compra: email con come pagare, lo stato e "Mis pedidos".
    const accepted = await waitForEmail(email, { subject: 'aceptó tu pedido' });
    expect(accepted.text).toContain('Transferencia');
    await shopper.goto(trackingUrl);
    await expect(shopper.getByRole('heading', { name: 'Cómo pagar' })).toBeVisible();
    await expect(shopper.getByText(/Esperando que Florería Las Camelias acepte/)).toHaveCount(0);
    await shopper.goto('/cuenta');
    const myOrder = shopper.getByRole('link', { name: /Florería Las Camelias/ });
    await expect(myOrder).toBeVisible();
    await expect(myOrder.getByText('Aceptado')).toBeVisible();

    // Un secondo ordine da ritirare, che chi compra annulla prima che la fioreria risponda.
    await shopper.goto('/f/las-camelias');
    await shopper.getByRole('link', { name: /Ramo Clásico 12 rosas/ }).click();
    await shopper.getByRole('link', { name: 'Pedir en línea' }).click();
    await expect(shopper.getByRole('heading', { level: 1, name: 'Hacer un pedido' })).toBeVisible();
    await shopper.getByRole('button', { name: 'Continuar' }).click();
    await shopper.getByRole('radio', { name: 'Recoger en la tienda' }).check();
    const pickupInput = shopper.getByLabel('Día para recoger');
    const pickupMin = (await pickupInput.getAttribute('min')) ?? '';
    const pickupDay = new Date(`${pickupMin}T12:00:00Z`);
    for (let attempt = 0; attempt < 7; attempt += 1) {
      await pickupInput.fill(pickupDay.toISOString().slice(0, 10));
      if ((await shopper.getByText('La florería no abre ese día: elige otro.').count()) === 0)
        break;
      pickupDay.setUTCDate(pickupDay.getUTCDate() + 1);
    }
    await shopper.getByRole('button', { name: 'Continuar' }).click();
    await shopper.getByRole('button', { name: 'Continuar' }).click();
    await shopper.getByLabel('Tu teléfono').fill('449 555 0177');
    await shopper.getByRole('button', { name: 'Enviar pedido' }).click();
    await expect(shopper).toHaveURL(/\/pedido\/[\w-]+\?enviado=1$/);

    await shopper.goto('/cuenta');
    const waiting = shopper.getByRole('listitem').filter({ hasText: 'Esperando a la florería' });
    await waiting.getByRole('button', { name: 'Cancelar pedido' }).click();
    await shopper
      .getByRole('dialog')
      .getByRole('button', { name: 'Sí, cancelar el pedido' })
      .click();
    await expect(shopper.getByText('Pedido cancelado.')).toBeVisible();
    await expect(
      shopper.getByRole('listitem').filter({ hasText: 'Esperando a la florería' }),
    ).toHaveCount(0);
    await expect(shopper.getByText('Cancelado', { exact: true })).toBeVisible();
    await waitForEmail(email, { subject: 'Cancelaste tu pedido' });
    await waitForEmail(OWNER_EMAIL, { subject: 'canceló el pedido' });
    await visitor.close();

    // Si rimette la tienda com'era per gli altri test.
    await page.goto('/app/las-camelias/settings/store');
    await page
      .getByRole('checkbox', { name: 'Recibir pedidos desde mi tienda en línea' })
      .uncheck();
    await page.getByRole('button', { name: 'Guardar pedidos en línea' }).click();
    await expect(page.getByText('Pedidos en línea guardados.')).toBeVisible();
    await page.getByRole('button', { name: 'Retirar mi tienda' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Retirar mi tienda' }).click();
    await expect(page.getByText('Tu tienda ya no es visible.')).toBeVisible();
  });
});
