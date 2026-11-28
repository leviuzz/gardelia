import { expect, test } from '@playwright/test';
import { expectFitsAt320 } from './support/floral-care';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';
import { ownClientHeaders } from './support/network';
import { closeStore, ensurePublishedWithOrders, setItemOnline } from './support/store';

/**
 * Ordine dalla tienda en línea (marketplace, blocco C4, ADR-067): la proprietaria accende gli
 * ordini online; chi compra si registra dal modulo, sceglie un ramo, la consegna e la tarjeta e
 * lo invia; la fioreria lo accetta e chi compra vede come pagare e lo stato in "Mis pedidos".
 * Un secondo ordine, da ritirare, chi compra lo annulla da "Mis pedidos" prima della risposta.
 * Alla fine la tienda torna com'era (ordini spenti, non pubblicata) per gli altri test.
 */

const OWNER_EMAIL = 'duena@lascamelias.test';

test.describe('pedido en línea (cliente y florería)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('el cliente pide, la florería acepta y el cliente ve cómo pagar', async ({
    page,
    browser,
  }) => {
    await ensurePublishedWithOrders(page);

    // Chi compra, senza account: dal prodotto al modulo, che chiede l'accesso.
    const visitor = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: ownClientHeaders(),
    });
    const shopper = await visitor.newPage();
    await shopper.goto('/f/las-camelias');
    await shopper
      .getByRole('link', { name: /Ramo Clásico 12 rosas/ })
      .first()
      .click();
    // «Pedir ahora» (M1): il ramo va nel carrello della fioreria e si apre il modulo.
    await shopper.getByRole('button', { name: 'Pedir ahora' }).click();
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
    // Il carrello (cookie della fioreria) è sopravvissuto alla registrazione.
    await expect(shopper).toHaveURL(/\/f\/las-camelias\/pedido$/);
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
    // L'avviso dell'elenco (il numero sulla voce «Pedidos» del menu ha un testo simile, M3).
    await expect(page.getByText(/^Tienes \d+ pedidos? en línea por aceptar/)).toBeVisible();
    await page.goto(orderPath);
    const panel = page.getByTestId('online-pending');
    await expect(panel.getByText('Pedido en línea por aceptar')).toBeVisible();
    await expect(panel.getByText('Colores pastel, por favor.')).toBeVisible();
    // Chi ha ordinato, con telefono ed email per chiamarlo o scrivergli (M0).
    const contact = panel.getByTestId('online-contact');
    await expect(contact).toContainText('Mariana Ruiz');
    await expect(contact.getByRole('link', { name: '449 555 0177' })).toHaveAttribute(
      'href',
      'tel:+524495550177',
    );
    await expect(contact.getByRole('link', { name: email })).toHaveAttribute(
      'href',
      `mailto:${email}`,
    );
    await expect(page.getByText('En línea', { exact: true })).toBeVisible();
    // La fioreria di prova non ha un costo di consegna: prima di accettare conferma che è gratis.
    await panel.getByRole('button', { name: 'Aceptar pedido' }).click();
    const freeDelivery = page.getByRole('dialog');
    await expect(freeDelivery.getByText('¿Envío sin costo?')).toBeVisible();
    await expectFitsAt320(page, 'online-free-delivery');
    await freeDelivery.getByRole('button', { name: 'Aceptar con envío gratis' }).click();
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
    // Dopo l'invio il carrello è vuoto: niente barra «Tu pedido».
    await expect(shopper.getByTestId('cart-bar')).toHaveCount(0);
    await shopper
      .getByRole('link', { name: /Ramo Clásico 12 rosas/ })
      .first()
      .click();
    await shopper.getByRole('button', { name: 'Pedir ahora' }).click();
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
    // Mentre ordina, la fioreria toglie il ramo dalla vetrina: l'errore lo dice accanto al
    // prodotto, non «no se puede cotizar» (M0). Rimesso in vetrina, l'ordine parte.
    await setItemOnline(page, 'Ramo Clásico 12 rosas', false);
    await shopper.getByRole('button', { name: 'Enviar pedido' }).click();
    await expect(
      shopper.getByText('Un producto que elegiste ya no está disponible', { exact: false }),
    ).toBeVisible();
    await expect(shopper.getByText('Ya no está disponible: pon 0 para quitarlo.')).toBeVisible();
    await expect(
      shopper.getByRole('spinbutton', { name: 'Ramo Clásico 12 rosas' }),
    ).toHaveAttribute('aria-invalid', 'true');
    await setItemOnline(page, 'Ramo Clásico 12 rosas', true);
    for (let next = 0; next < 3; next += 1) {
      await shopper.getByRole('button', { name: 'Continuar' }).click();
    }
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

    // Un prodotto che non c'è più (link vecchio): lo si dice e si torna alla tienda (M0).
    await shopper.goto('/f/las-camelias/p/0192f5c1-6b2f-7000-8000-00000000dead');
    await expect(shopper.getByTestId('item-gone')).toBeVisible();
    await expect(
      shopper.getByRole('heading', { name: 'Este producto ya no está disponible' }),
    ).toBeVisible();
    await shopper.getByRole('link', { name: 'Ver los productos de Florería Las Camelias' }).click();
    await expect(shopper).toHaveURL(/\/f\/las-camelias$/);
    await visitor.close();

    // Si rimette la tienda com'era per gli altri test.
    await closeStore(page);
  });
});
