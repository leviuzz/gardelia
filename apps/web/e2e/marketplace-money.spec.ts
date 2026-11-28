import { expect, test, type Page } from '@playwright/test';
import { expectFitsAt320 } from './support/floral-care';
import { linkFrom, waitForEmail } from './support/mailbox';
import { runSystemSql } from './support/sql';
import { closeStore, ensurePublishedWithOrders, newBuyer, sendOrder } from './support/store';

/**
 * Marketplace M3-3 «Soldi e squadra» (ADR-088), dalle due parti:
 *  - i dati per pagare non si vedono nella vetrina né nel modulo d'ordine, solo a ordine accettato;
 *  - chi compra carica la prova del pagamento («Ya pagué»), la fioreria la vede in «Por atender», la
 *    conferma («Lo confirmo» = un pagamento) e chi compra riceve «Registramos tu pago»;
 *  - l'ordine annullato si rimborsa e chi compra riceve «Te reembolsamos»;
 *  - con l'impostazione accesa lo staff accetta un ordine online; assegnato, riceve l'avviso, lo
 *    trova in «Mis entregas» e segna «Cobré en efectivo»; il proprietario conferma i contanti;
 *  - la stampa del giorno: comande e tarjetas.
 * Alla fine l'impostazione dello staff torna spenta e la tienda chiusa, come per gli altri test.
 */

const OWNER_EMAIL = 'duena@lascamelias.test';
const STAFF_EMAIL = 'staff@lascamelias.test';
const SHOP = 'Florería Las Camelias';
const CLABE = 'CLABE 012345678901234567 (BBVA)';
const TENANT = `(SELECT "id" FROM "Tenant" WHERE "slug" = 'las-camelias')`;

/** L'ordine dalla mail «Nuevo pedido en línea»: il percorso della pagina della fioreria. */
async function shopOrderPath(number: string): Promise<string> {
  const mail = await waitForEmail(OWNER_EMAIL, { subject: `Nuevo pedido en línea ${number}` });
  return new URL(linkFrom(mail, '/app/las-camelias/orders/')).pathname;
}

/** Il giorno dell'ordine (AAAA-MM-GG), per il percorso e la stampa del giorno. */
function orderDate(number: string): string {
  const out = runSystemSql(
    `SELECT to_char("scheduledDate", 'YYYY-MM-DD') FROM "Order" WHERE "tenantId" = ${TENANT} AND "number" = ${Number(number.replace(/\D/g, ''))};`,
  );
  return out.trim().split('\n').pop() ?? '';
}

/** «Aceptar pedido» dal riquadro dell'ordine online (consegna a 0: conferma che è gratis). */
async function acceptOrder(page: Page): Promise<void> {
  await page.getByTestId('online-pending').getByRole('button', { name: 'Aceptar pedido' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Aceptar con envío gratis' }).click();
  await expect(page.getByText('Pedido aceptado: le avisamos al cliente por correo.')).toBeVisible();
}

/** Le impostazioni degli ordini online con l'interruttore dello staff. */
async function setStaffCanAccept(page: Page, on: boolean): Promise<void> {
  await page.goto('/app/las-camelias/settings/store');
  const box = page.getByTestId('store-staff-can-accept');
  if ((await box.isChecked()) !== on) {
    await box.setChecked(on);
    await page.getByRole('button', { name: 'Guardar pedidos en línea' }).click();
    await expect(page.getByText('Pedidos en línea guardados.')).toBeVisible();
  }
}

test.describe('dinero y equipo de un pedido en línea (M3-3)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });
  test.setTimeout(300_000);

  test('comprobante → pago confirmado → reembolso, sin datos para pagar en la vitrina', async ({
    page,
    browser,
  }) => {
    await ensurePublishedWithOrders(page);
    // I dati per pagare della fioreria: si vedono solo a ordine accettato.
    await page.goto('/app/las-camelias/settings/store');
    await page.getByLabel('Datos para pagar').fill(CLABE);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Tienda actualizada.')).toBeVisible();

    const { visitor, shopper, email } = await newBuyer(browser, 'Paula Pagos', 'pagos');
    // Il modulo d'ordine e la vetrina: le forme di pagamento sì, la CLABE no (nemmeno nascosta).
    await expect(shopper.getByText(CLABE)).toHaveCount(0);
    await shopper.goto('/f/las-camelias');
    await expect(shopper.getByTestId('store-payment-later')).toHaveText(
      'Te damos los datos para pagar cuando la florería acepte tu pedido.',
    );
    await expect(shopper.getByText(CLABE)).toHaveCount(0);
    await shopper.goto('/f/las-camelias/pedido');
    const number = await sendOrder(shopper, 'DELIVERY');
    const tracking = shopper.url();
    await expect(shopper.getByText(CLABE)).toHaveCount(0);

    // Accettato: la CLABE arriva nell'email e nella pagina dell'ordine.
    const path = await shopOrderPath(number);
    await page.goto(path);
    await acceptOrder(page);
    const accepted = await waitForEmail(email, { subject: `${SHOP} aceptó tu pedido ${number}` });
    expect(accepted.text).toContain(CLABE);
    await shopper.goto(tracking);
    await expect(shopper.getByText(CLABE)).toBeVisible();

    // Chi compra: «Ya pagué» dalla pagina dell'ordine del conto.
    await shopper.goto('/cuenta');
    await shopper
      .getByRole('link', { name: new RegExp(number) })
      .first()
      .click();
    await expect(shopper).toHaveURL(/\/cuenta\/pedidos\//);
    const buyerOrderUrl = shopper.url();
    const payments = shopper.getByTestId('buyer-order-payments');
    await expect(payments.getByText('Ya pagué: sube tu comprobante')).toBeVisible();
    await expect(payments.getByLabel('Importe que pagaste (MXN)')).toHaveValue('690.00');
    // Senza la foto non parte.
    await payments.getByTestId('payment-proof-submit').click();
    await expect(payments.getByText('Elige al menos una foto.')).toBeVisible();
    await payments.getByTestId('payment-proof-photo').setInputFiles('e2e/fixtures/ramo.jpg');
    await payments.getByLabel('Nota (opcional)').fill('SPEI desde BBVA');
    await payments.getByTestId('payment-proof-submit').click();
    await expect(shopper.getByText('Enviamos tu comprobante a la florería')).toBeVisible();
    const proof = payments.getByTestId('buyer-proof');
    await expect(proof).toContainText('$690.00');
    await expect(proof).toContainText('En revisión');
    await expect(proof).toContainText('SPEI desde BBVA');
    await expectFitsAt320(shopper, 'buyer-payment-proof');

    // La fioreria: l'email (senza la nota), «Por atender» e il filtro dell'elenco.
    const received = await waitForEmail(OWNER_EMAIL, {
      subject: `Comprobante de pago del pedido ${number}`,
    });
    expect(received.text).not.toContain('BBVA');
    expect(linkFrom(received, '/app/las-camelias/orders/')).toMatch(/#pagos$/);
    await page.goto('/app/las-camelias');
    const todo = page.getByTestId('todo-payment-proofs');
    await expect(todo).toContainText('comprobante');
    await todo.getByRole('link').click();
    await expect(page).toHaveURL(/money=proofs/);
    await page
      .getByRole('link', { name: new RegExp(number) })
      .first()
      .click();
    const proofs = page.getByTestId('order-proofs');
    await expect(proofs.getByTestId('order-proof')).toContainText('Por revisar');
    await expect(proofs.getByTestId('order-proof')).toContainText('SPEI desde BBVA');
    // La miniatura si vede davvero (rotta privata, alt vuoto: è decorativa accanto all'importo).
    const thumb = proofs.locator('img');
    await expect(thumb).toBeVisible();
    await expect
      .poll(() => thumb.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
    await expectFitsAt320(page, 'shop-payment-proof');
    await proofs.getByRole('button', { name: 'Confirmar el comprobante de $690.00' }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm.getByLabel('Importe (MXN)')).toHaveValue('690.00');
    await expect(confirm.getByLabel('Referencia')).toHaveValue('Comprobante del cliente');
    await confirm.getByRole('button', { name: 'Registrar pago' }).click();
    await expect(page.getByText('Pago registrado', { exact: true })).toBeVisible();
    await expect(proofs.getByTestId('order-proof')).toContainText('Confirmado');
    await expect(page.getByTestId('order-payments')).toContainText('Comprobante del cliente');
    const paid = await waitForEmail(email, {
      subject: `Registramos tu pago de $690.00 del pedido ${number}`,
    });
    expect(paid.text).toContain('no es un comprobante fiscal');
    expect(linkFrom(paid, '/cuenta/pedidos/')).toMatch(/#pagos$/);
    await shopper.goto(buyerOrderUrl);
    await expect(shopper.getByTestId('buyer-proof')).toContainText('Confirmado');
    // Pagato: niente più «Ya pagué».
    await expect(shopper.getByText('Ya pagué: sube tu comprobante')).toHaveCount(0);

    // Annullato con il pagamento: «Registrar reembolso» e l'email «Te reembolsamos».
    await page.getByRole('button', { name: 'Cancelar pedido' }).click();
    const cancel = page.getByRole('dialog');
    await cancel.getByRole('textbox').fill('No llegaron las flores del mercado');
    await cancel.getByRole('button', { name: 'Cancelar pedido' }).click();
    await expect(page.getByText('Pedido cancelado')).toBeVisible();
    const refund = page.getByTestId('refund-form');
    await expect(refund.getByLabel('Importe (MXN)')).toHaveValue('690.00');
    await refund.getByLabel('Referencia').fill('SPEI devolución');
    await refund.getByRole('button', { name: 'Registrar reembolso' }).click();
    await expect(page.getByText('Reembolso registrado')).toBeVisible();
    await expect(page.getByTestId('order-refunded')).toHaveText('Reembolsado: $690.00');
    await expect(page.getByTestId('refund-form')).toHaveCount(0);
    await waitForEmail(email, { subject: `Te reembolsamos $690.00 del pedido ${number}` });
    await shopper.goto(buyerOrderUrl);
    await expect(shopper.getByTestId('buyer-order-refunded')).toHaveText(
      `${SHOP} te reembolsó $690.00.`,
    );
    // Annullato: la CLABE sparisce anche dal link di stato.
    await shopper.goto(tracking);
    await expect(shopper.getByText(CLABE)).toHaveCount(0);
    await visitor.close();
  });

  test('el personal acepta, cobra en efectivo y la dueña confirma; impresión del día', async ({
    page,
    browser,
  }) => {
    await ensurePublishedWithOrders(page);
    await setStaffCanAccept(page, true);
    const staffContext = await browser.newContext({ storageState: 'e2e/.auth/staff.json' });
    const staff = await staffContext.newPage();
    try {
      const { visitor, shopper, email } = await newBuyer(browser, 'Sara Efectivo', 'efectivo');
      const number = await sendOrder(shopper, 'DELIVERY');
      const path = await shopOrderPath(number);

      // Lo staff accetta l'ordine online (l'impostazione è accesa).
      await staff.goto(path);
      await acceptOrder(staff);
      await waitForEmail(email, { subject: `${SHOP} aceptó tu pedido ${number}` });

      // La dueña lo assegna: allo staff arriva l'avviso per email.
      await page.goto(path);
      await page
        .getByRole('combobox', { name: 'Repartidor' })
        .selectOption({ label: 'Ana Torres' });
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await expect(page.getByText('Repartidor actualizado.')).toBeVisible();
      const assigned = await waitForEmail(STAFF_EMAIL, {
        subject: `Te asignaron la entrega del pedido ${number} para el `,
      });
      expect(assigned.text).toContain('Centro, Aguascalientes');
      expect(assigned.text).not.toContain('Av. Madero');

      // Nelle sue consegne: «Cobré en efectivo».
      const date = orderDate(number);
      await staff.goto(`/app/las-camelias/orders/route?date=${date}&mine=1`);
      const stop = staff.getByRole('article').filter({ hasText: number });
      await stop.getByTestId('cash-collect').click();
      const collect = staff.getByRole('dialog');
      await expect(collect.getByLabel('Importe (MXN)')).toHaveValue('690.00');
      await collect.getByLabel('Nota').fill('Pagó con billetes de 500 y 200');
      await collect.getByRole('button', { name: 'Guardar' }).click();
      await expect(staff.getByText('Efectivo guardado: falta que lo confirmen')).toBeVisible();
      await expect(stop.getByTestId('route-cash-pending')).toHaveText(
        'Efectivo por confirmar: $690.00',
      );
      await expect(stop.getByTestId('cash-collect')).toHaveCount(0);
      await expectFitsAt320(staff, 'route-cash');

      // La dueña: «Por atender» → il filtro → conferma i contanti.
      await page.goto('/app/las-camelias');
      const todo = page.getByTestId('todo-cash');
      await expect(todo).toContainText('efectivo por confirmar');
      await todo.getByRole('link').click();
      await expect(page).toHaveURL(/money=cash/);
      await page
        .getByRole('link', { name: new RegExp(number) })
        .first()
        .click();
      const cash = page.getByTestId('order-cash');
      await expect(cash.getByTestId('order-cash-row')).toContainText('Por confirmar');
      await expect(cash.getByTestId('order-cash-row')).toContainText('Ana Torres');
      await cash.getByRole('button', { name: 'Confirmar el efectivo de $690.00' }).click();
      const confirm = page.getByRole('dialog');
      await expect(confirm.getByLabel('Importe (MXN)')).toHaveValue('690.00');
      await confirm.getByRole('button', { name: 'Registrar pago' }).click();
      await expect(page.getByText('Pago en efectivo registrado')).toBeVisible();
      await expect(cash.getByTestId('order-cash-row')).toContainText('Confirmado');
      await expect(page.getByTestId('order-payments')).toContainText('Efectivo');
      await waitForEmail(email, { subject: `Registramos tu pago de $690.00 del pedido ${number}` });

      // La stampa del giorno: la comanda dell'ordine e la pagina delle tarjetas.
      await page.goto(`/app/las-camelias/orders/day?date=${date}`);
      await page.getByRole('link', { name: 'Imprimir comandas' }).click();
      await expect(page).toHaveURL(/\/orders\/day\/tickets\?date=/);
      const ticket = page.getByTestId('day-ticket').filter({ hasText: number });
      await expect(ticket).toContainText('Ramo Clásico 12 rosas');
      await expect(ticket).toContainText('Av. Madero 120');
      await expect(ticket).toContainText('Ana Torres');
      await expect(page.getByRole('button', { name: 'Imprimir' })).toBeVisible();
      await expectFitsAt320(page, 'day-tickets');
      await page.goto(`/app/las-camelias/orders/day?date=${date}`);
      await page.getByRole('link', { name: 'Imprimir tarjetas' }).click();
      await expect(page).toHaveURL(/\/orders\/day\/cards\?date=/);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Tarjetas del');
      await visitor.close();
    } finally {
      await staffContext.close();
      await setStaffCanAccept(page, false);
      await closeStore(page);
    }
  });
});
