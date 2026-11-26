import { expect, test } from '@playwright/test';
import { expectFitsAt320 } from './support/floral-care';
import { linkFrom, waitForEmail } from './support/mailbox';
import { closeStore, ensurePublishedWithOrders, newBuyer, sendOrder } from './support/store';

/**
 * Marketplace M3-1 «Messaggi e avvisi» (ADR-088), dalle due parti:
 *  - chi compra ordina, apre il suo ordine in «Mis pedidos», scrive alla fioreria con una foto;
 *  - la fioreria lo vede in «Por atender» e con il numero su «Pedidos», filtra «Con mensajes por
 *    leer», legge e risponde; chi compra riceve l'avviso e vede «Nuevos»;
 *  - la fioreria accetta e fa i passi: chi compra riceve «Estamos preparando», «va en camino» ed
 *    «Entregamos», una volta sola; poi «Pedir de nuevo» rimette i prodotti nel carrello;
 *  - un secondo ordine si rifiuta con un motivo pronto, che chi compra legge.
 * Alla fine la tienda torna com'era (ordini spenti, non pubblicata) per gli altri test.
 */

const OWNER_EMAIL = 'duena@lascamelias.test';
const SHOP = 'Florería Las Camelias';

test.describe('mensajes y avisos de un pedido en línea (M3-1)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });
  test.setTimeout(240_000);

  test('cliente y florería se escriben, cada paso avisa y se puede pedir de nuevo', async ({
    page,
    browser,
  }) => {
    await ensurePublishedWithOrders(page);
    const { visitor, shopper, email } = await newBuyer(browser, 'Renata Mensajes');
    const number = await sendOrder(shopper, 'DELIVERY');

    // Il link di stato rimanda al conto per scrivere alla fioreria.
    await expect(shopper.getByTestId('write-from-account')).toContainText(
      `Escríbele a ${SHOP} desde tu cuenta`,
    );

    // Chi compra: «Mis pedidos» apre la pagina dell'ordine nel conto.
    await shopper.goto('/cuenta');
    await shopper.getByRole('link', { name: new RegExp(number) }).click();
    await expect(shopper).toHaveURL(/\/cuenta\/pedidos\/[0-9a-f-]{36}$/);
    const buyerOrderUrl = shopper.url();
    await expect(
      shopper.getByRole('heading', { level: 1, name: `Pedido ${number}` }),
    ).toBeVisible();
    await expect(shopper.getByTestId('buyer-order-waiting')).toContainText(
      'todavía no acepta tu pedido',
    );
    const buyerThread = shopper.getByTestId('buyer-order-messages');
    await expect(buyerThread.getByText(`Mensajes con ${SHOP}`)).toBeVisible();
    await expect(buyerThread.getByText('Todavía no hay mensajes.')).toBeVisible();
    const question = `¿Pueden poner girasoles en lugar de rosas? ${Date.now()}`;
    await buyerThread.getByLabel('Mensaje').fill(question);
    await buyerThread.getByTestId('message-photo-input').setInputFiles('e2e/fixtures/ramo.jpg');
    await buyerThread.getByRole('button', { name: 'Enviar' }).click();
    await expect(shopper.getByText('Mensaje enviado')).toBeVisible();
    await expect(buyerThread.getByText(question)).toBeVisible();
    await expect(buyerThread.getByText('Tú', { exact: true })).toBeVisible();
    await expect(buyerThread.getByRole('img', { name: 'Foto del mensaje' })).toBeVisible();
    await expectFitsAt320(shopper, 'buyer-order');

    // La fioreria: l'avviso per email, senza il testo.
    const shopNotice = await waitForEmail(OWNER_EMAIL, {
      subject: `Mensaje del cliente sobre el pedido ${number}`,
    });
    expect(shopNotice.text).not.toContain('girasoles');
    const orderPath = new URL(linkFrom(shopNotice, '/app/las-camelias/orders/')).pathname;

    // «Por atender» in cima alla Home e il numero su «Pedidos».
    await page.goto('/app/las-camelias');
    const todo = page.getByTestId('todo-card');
    await expect(todo.getByTestId('todo-pending')).toContainText(/pedidos? en línea por aceptar/);
    await expect(todo.getByTestId('todo-pending')).toContainText('se cancela solo');
    await expect(todo.getByTestId('todo-order-messages')).toContainText(/por leer en/);
    await expect(
      page
        .getByRole('navigation', { name: 'Navegación principal' })
        .first()
        .getByTestId('nav-badge'),
    ).toBeVisible();
    await expectFitsAt320(page, 'todo-card');
    await todo.getByRole('link', { name: 'Ver pedidos' }).click();
    await expect(page).toHaveURL(/messages=unread/);
    await expect(page.getByTestId('filter-unread-messages')).toHaveAttribute(
      'aria-current',
      'page',
    );
    const row = page.getByRole('link').filter({ hasText: number });
    await expect(row.getByTestId('row-unread')).toHaveText('1 mensaje sin leer');
    await expect(row.getByText('En línea', { exact: true })).toBeVisible();
    await expect(row.getByText(/Se cancela solo el/)).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(new RegExp(`${orderPath}$`));

    // La pagina dell'ordine: la scadenza, il segno dei messaggi e il filo.
    await expect(page.getByTestId('online-deadline')).toContainText('se cancela solo');
    await expect(page.getByTestId('order-unread-link')).toHaveText('1 mensaje sin leer');
    const shopThread = page.getByTestId('order-messages-card');
    await expect(shopThread.getByText('Mensajes con Renata Mensajes')).toBeVisible();
    await expect(shopThread.getByRole('separator')).toHaveText('Sin leer');
    await expect(shopThread.getByText(question)).toBeVisible();
    const thumb = await shopThread
      .getByRole('img', { name: 'Foto del mensaje' })
      .getAttribute('src');
    expect(thumb).toMatch(/\/orders\/[0-9a-f-]{36}\/messages\/photos\/[0-9a-f-]{36}\?size=thumb$/);
    expect((await page.request.get(thumb ?? '')).status()).toBe(200);
    // Senza sessione la foto non si vede.
    expect((await shopper.context().request.get(thumb ?? '')).status()).toBe(404);
    const reply = 'Sí, con girasoles. El precio no cambia.';
    await shopThread.getByLabel('Mensaje').fill(reply);
    await shopThread.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByText('Mensaje enviado')).toBeVisible();
    await expect(shopThread.getByText(reply)).toBeVisible();
    await expectFitsAt320(page, 'shop-order-messages');
    // Letto: ricaricando, niente più da leggere.
    await page.reload();
    await expect(page.getByTestId('order-unread-link')).toHaveCount(0);

    // Chi compra: l'avviso porta ai messaggi; «Mis pedidos» dice che c'è un messaggio nuovo.
    const buyerNotice = await waitForEmail(email, { subject: `${SHOP} te escribió` });
    expect(buyerNotice.text).not.toContain('girasoles');
    expect(linkFrom(buyerNotice, '/cuenta/pedidos/')).toMatch(/#mensajes$/);
    await shopper.goto('/cuenta');
    await expect(shopper.getByTestId('order-new-messages')).toHaveText('1 mensaje nuevo');
    await shopper.goto(buyerOrderUrl);
    await expect(buyerThread.getByRole('separator')).toHaveText('Nuevos');
    await expect(buyerThread.getByText(reply)).toBeVisible();

    // La fioreria accetta (consegna a 0: conferma che è gratis) e fa i passi.
    await page
      .getByTestId('online-pending')
      .getByRole('button', { name: 'Aceptar pedido' })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Aceptar con envío gratis' })
      .click();
    await expect(
      page.getByText('Pedido aceptado: le avisamos al cliente por correo.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Empezar a preparar' }).click();
    await expect(page.getByText('Pedido marcado como «En preparación»')).toBeVisible();
    await waitForEmail(email, { subject: `Estamos preparando tu pedido ${number}` });
    await page.getByRole('button', { name: /^Marcar listo/ }).click();
    await expect(page.getByRole('button', { name: 'Salió a entregar' })).toBeVisible();
    await page.getByRole('button', { name: 'Salió a entregar' }).click();
    await waitForEmail(email, { subject: `Tu pedido ${number} va en camino` });
    await page.getByRole('button', { name: 'Marcar entregado' }).click();
    const delivered = await waitForEmail(email, { subject: `Entregamos tu pedido ${number}` });
    expect(delivered.text).toContain('/pedido/');

    // Chi compra: ordine consegnato, «Pedir de nuevo» rimette il ramo nel carrello.
    await shopper.goto(buyerOrderUrl);
    await expect(shopper.getByText('Entregado').first()).toBeVisible();
    await shopper
      .getByTestId('buyer-reorder')
      .getByRole('button', { name: 'Pedir de nuevo' })
      .click();
    await expect(shopper).toHaveURL(/\/f\/las-camelias\/pedido\?repetido=1/);
    await expect(shopper.getByTestId('cart-reordered')).toContainText(
      'Agregamos los productos de tu pedido anterior',
    );
    await expect(shopper.getByRole('spinbutton', { name: 'Ramo Clásico 12 rosas' })).toHaveValue(
      '1',
    );

    // Un secondo ordine, da ritirare, che la fioreria rifiuta con un motivo pronto.
    const second = await sendOrder(shopper, 'PICKUP');
    const newOrder = await waitForEmail(OWNER_EMAIL, {
      subject: `Nuevo pedido en línea ${second}`,
    });
    expect(newOrder.text).toContain('1 × Ramo Clásico 12 rosas');
    expect(newOrder.text).toContain('Acéptalo o recházalo antes del');
    await page.goto(new URL(linkFrom(newOrder, '/app/las-camelias/orders/')).pathname);
    await page.getByTestId('online-pending').getByRole('button', { name: 'Rechazar' }).click();
    const reject = page.getByRole('dialog');
    await reject.getByRole('radio', { name: /No tenemos disponibilidad para ese día/ }).check();
    await reject.getByLabel('Detalle (opcional)').fill('¿Te sirve el sábado?');
    await expectFitsAt320(page, 'reject-dialog');
    await reject.getByRole('button', { name: 'Rechazar pedido' }).click();
    await expect(page.getByText('Pedido cancelado', { exact: false })).toBeVisible();
    const rejected = await waitForEmail(email, { subject: 'no puede atender' });
    expect(rejected.text).toContain('No tenemos disponibilidad para ese día. ¿Te sirve el sábado?');
    await shopper.goto('/cuenta');
    await shopper.getByRole('link', { name: new RegExp(second) }).click();
    await expect(
      shopper.getByText('No tenemos disponibilidad para ese día. ¿Te sirve el sábado?', {
        exact: false,
      }),
    ).toBeVisible();
    await visitor.close();

    // Si rimette la tienda com'era per gli altri test.
    await closeStore(page);
  });
});
