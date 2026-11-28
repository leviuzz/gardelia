import { expect, test, type Locator } from '@playwright/test';
import { expectFitsAt320 } from './support/floral-care';
import { linkFrom, waitForEmail } from './support/mailbox';
import { runSystemSql } from './support/sql';
import { closeStore, ensurePublishedWithOrders, newBuyer, sendOrder } from './support/store';

/**
 * Marketplace M3-2 «Cambi da confermare» (ADR-088), dalle due parti:
 *  - il fiorista cambia la quantità di un ordine da accettare e «Pedir confirmación al cliente»:
 *    chi compra vede com'era → com'è nel conto (e per email), conferma e l'ordine è accettato;
 *  - sullo stesso ordine accettato manca una rosa: «Preguntar en la app», chi compra dice «Sí»
 *    nel filo, la casella «El cliente aceptó el cambio» è già spuntata e il fiore si cambia;
 *  - un secondo ordine: «Proponer otra fecha», chi compra risponde «No, gracias» con un motivo, il
 *    fiorista lo vede in «Por atender» e nel filtro «No a los cambios», e lo rifiuta.
 * Alla fine la tienda e la rosa tornano come prima per gli altri test.
 */

const OWNER_EMAIL = 'duena@lascamelias.test';
const SHOP = 'Florería Las Camelias';
const BOUQUET = 'Ramo Clásico 12 rosas';
const TENANT = `(SELECT "id" FROM "Tenant" WHERE "slug" = 'las-camelias')`;

/** La rosa del ramo del test esaurita (o di nuovo disponibile) nel catalogo. */
function setRoseAvailability(availability: 'OUT_OF_STOCK' | 'AVAILABLE'): void {
  runSystemSql(
    `UPDATE "CatalogItem" SET "availability" = '${availability}' WHERE "tenantId" = ${TENANT} AND "name" = 'Rosa roja';`,
  );
}

/** L'ordine dalla mail «Nuevo pedido en línea»: il percorso della pagina della fioreria. */
async function shopOrderPath(number: string): Promise<string> {
  const mail = await waitForEmail(OWNER_EMAIL, { subject: `Nuevo pedido en línea ${number}` });
  return new URL(linkFrom(mail, '/app/las-camelias/orders/')).pathname;
}

/** Il giorno dopo quello nel campo (AAAA-MM-GG). */
async function nextDay(scope: Locator, label: string): Promise<string> {
  const value =
    (await scope.getByLabel(label).inputValue()) || new Date().toISOString().slice(0, 10);
  const day = new Date(`${value}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

test.describe('cambios por confirmar de un pedido en línea (M3-2)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });
  test.setTimeout(300_000);

  test.afterAll(() => setRoseAvailability('AVAILABLE'));

  test('la florería cambia el pedido, el cliente confirma, responde sí o no y dice que no', async ({
    page,
    browser,
  }) => {
    await ensurePublishedWithOrders(page);
    const { visitor, shopper, email } = await newBuyer(browser, 'Olga Cambios', 'cambios');
    const first = await sendOrder(shopper, 'DELIVERY');
    const firstTracking = shopper.url();

    // La fioreria: due ramos invece di uno, poi «Pedir confirmación al cliente».
    const firstPath = await shopOrderPath(first);
    await page.goto(firstPath);
    const pending = page.getByTestId('online-pending');
    await expect(pending.getByRole('button', { name: 'Aceptar pedido' })).toBeVisible();
    await page.getByText('Cambiar productos o descuento').click();
    await expect(page.getByTestId('pending-lines-hint')).toBeVisible();
    const quantity = page.getByRole('spinbutton', { name: `Cantidad de ${BOUQUET}` });
    await quantity.fill('2');
    await page
      .locator('form')
      .filter({ has: quantity })
      .getByRole('button', { name: 'Actualizar' })
      .click();
    await expect(page.getByText('Cantidad actualizada')).toBeVisible();
    const changes = page.getByTestId('order-changes');
    await expect(changes.getByText('Cambiaste')).toBeVisible();
    await expect(changes.getByTestId('order-change-list')).toContainText(BOUQUET);
    await expect(changes.getByTestId('order-change-list')).toContainText('$1,380.00');
    // Con dei cambi non si accetta: si chiede conferma.
    await expect(pending.getByRole('button', { name: 'Aceptar pedido' })).toHaveCount(0);
    await expectFitsAt320(page, 'shop-order-changes');
    await pending.getByTestId('ask-order-change').click();
    const ask = page.getByRole('dialog');
    // Consegna a 0: la finestra stessa conferma che è gratis.
    await expect(ask.getByText('El envío está en $0')).toBeVisible();
    const note = `Nos quedan pocas rosas: ¿te mandamos dos ramos? ${Date.now()}`;
    await ask.getByLabel('Mensaje para el cliente (opcional)').fill(note);
    await ask.getByRole('button', { name: 'Pedir confirmación' }).click();
    await expect(page.getByText('Le pedimos al cliente que confirme los cambios')).toBeVisible();
    await expect(page.getByTestId('order-change-asked')).toContainText('Esperando al cliente');

    // Nell'elenco aspetta chi compra: non è «Por aceptar» (come nel menu), ha il suo filtro.
    await page.goto(`/app/las-camelias/orders?when=pending&q=${first}`);
    await expect(page.getByRole('link', { name: first })).toHaveCount(0);
    await page.getByTestId('filter-asked-changes').click();
    await expect(page).toHaveURL(/changes=asked/);
    await expect(page.getByTestId('filter-asked-changes')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: first }).first()).toBeVisible();

    // Chi compra: l'email con i cambi (mai il messaggio), «Mis pedidos» e il link di stato.
    const asked = await waitForEmail(email, {
      subject: `${SHOP} cambió tu pedido ${first}: confírmalo`,
    });
    expect(asked.text).toContain(`${BOUQUET}: 1 → 2`);
    expect(asked.text).toContain('$1,380.00');
    expect(asked.text).not.toContain('pocas rosas');
    const changesUrl = linkFrom(asked, '/cuenta/pedidos/');
    expect(changesUrl).toMatch(/#cambios$/);
    await shopper.goto('/cuenta');
    await expect(shopper.getByTestId('order-changes-to-confirm')).toHaveText(
      'Confirma los cambios',
    );
    await shopper.goto(firstTracking);
    await expect(shopper.getByTestId('changes-to-confirm')).toContainText(
      `${SHOP} propuso cambios a este pedido`,
    );
    await shopper.goto(changesUrl);
    const card = shopper.getByTestId('buyer-order-changes');
    await expect(card.getByText(`${SHOP} cambió tu pedido`)).toBeVisible();
    await expect(card.getByText(note)).toBeVisible();
    await expect(card.getByTestId('buyer-order-change-list')).toContainText(BOUQUET);
    await expect(card.getByTestId('buyer-order-change-list')).toContainText('$1,380.00');
    await expect(shopper.getByTestId('buyer-order-waiting')).toContainText(
      'Tu pedido espera tu respuesta',
    );
    await expectFitsAt320(shopper, 'buyer-order-changes');
    await card.getByRole('button', { name: 'Confirmar cambios' }).click();
    await shopper.getByRole('dialog').getByRole('button', { name: 'Sí, confirmar' }).click();
    await expect(
      shopper.getByText('Confirmaste los cambios: tu pedido está aceptado.'),
    ).toBeVisible();
    await expect(shopper.getByTestId('buyer-order-changes')).toHaveCount(0);
    await expect(shopper.getByText('Aceptado').first()).toBeVisible();
    await waitForEmail(email, { subject: `${SHOP} aceptó tu pedido ${first}` });
    await waitForEmail(OWNER_EMAIL, { subject: `El cliente confirmó el pedido ${first}` });

    try {
      // Sullo stesso ordine, ormai accettato, la rosa del ramo si esaurisce.
      setRoseAvailability('OUT_OF_STOCK');
      await page.goto(firstPath);
      await expect(page.getByTestId('online-pending')).toHaveCount(0);
      const panel = page.getByTestId('order-substitutions');
      await expect(panel.getByRole('heading', { name: 'Faltan flores' })).toBeVisible();
      const option = panel
        .locator('label')
        .filter({ has: page.getByRole('radio') })
        .first();
      const substitute = ((await option.locator('span.font-medium').textContent()) ?? '').trim();
      expect(substitute).not.toBe('');
      await option.getByRole('radio').check();
      await panel.getByTestId('substitution-ask-in-app').click();
      await expect(page.getByText('Le preguntamos al cliente en la app')).toBeVisible();
      await expect(panel.getByTestId('substitution-asked-in-app')).toContainText(
        `Le preguntaste en la app por ${substitute}`,
      );
      const shopThread = page.getByTestId('order-messages-card');
      await expect(shopThread.getByText('Esperando la respuesta del cliente')).toBeVisible();

      // Chi compra risponde «Sí» con un tocco, nel filo.
      await shopper.goto(changesUrl.replace(/#cambios$/, ''));
      const buyerThread = shopper.getByTestId('buyer-order-messages');
      await expect(buyerThread.getByText('Pregunta: responde sí o no')).toBeVisible();
      await expect(buyerThread.getByText(`¿Te parece si usamos ${substitute}?`)).toBeVisible();
      await buyerThread.getByTestId('question-answer').getByRole('button', { name: 'Sí' }).click();
      await expect(shopper.getByText('Respuesta enviada')).toBeVisible();
      await expect(buyerThread.getByText('Respondiste: Sí')).toBeVisible();
      await expect(buyerThread.getByTestId('question-answer')).toHaveCount(0);
      await expectFitsAt320(shopper, 'buyer-question');

      // La fioreria: «sì» nell'app, casella già spuntata, il fiore si cambia.
      await page.reload();
      await expect(panel.getByTestId('substitution-asked-in-app')).toContainText(
        'El cliente dijo que sí en la app',
      );
      await expect(shopThread.getByText('El cliente respondió: Sí')).toBeVisible();
      await expect(
        panel.getByRole('checkbox', { name: 'El cliente aceptó el cambio' }),
      ).toBeChecked();
      await panel.getByRole('button', { name: 'Cambiar flor' }).click();
      await expect(page.getByText('Flor cambiada en el ramo')).toBeVisible();
    } finally {
      setRoseAvailability('AVAILABLE');
    }

    // Un secondo ordine, da ritirare: «Proponer otra fecha» e il cliente dice di no.
    await shopper.goto('/f/las-camelias');
    await shopper
      .getByRole('link', { name: new RegExp(BOUQUET) })
      .first()
      .click();
    await shopper.getByRole('button', { name: 'Pedir ahora' }).click();
    const second = await sendOrder(shopper, 'PICKUP');
    const secondPath = await shopOrderPath(second);
    await page.goto(secondPath);
    await page.getByTestId('propose-order-date').click();
    const propose = page.getByRole('dialog');
    await propose.getByLabel('Fecha').fill(await nextDay(propose, 'Fecha'));
    await propose.getByLabel('Mensaje para el cliente (opcional)').fill('Ese día estamos llenos.');
    await expectFitsAt320(page, 'propose-date');
    await propose.getByRole('button', { name: 'Proponer y pedir confirmación' }).click();
    await expect(page.getByText('Le propusimos la nueva fecha al cliente')).toBeVisible();
    await expect(page.getByTestId('order-change-list')).toContainText('Día y horario');
    await expect(page.getByTestId('order-change-asked')).toBeVisible();

    const proposed = await waitForEmail(email, {
      subject: `${SHOP} cambió tu pedido ${second}: confírmalo`,
    });
    expect(proposed.text).toContain('Día y horario:');
    await shopper.goto(linkFrom(proposed, '/cuenta/pedidos/'));
    const secondCard = shopper.getByTestId('buyer-order-changes');
    await expect(secondCard.getByTestId('buyer-order-change-list')).toContainText('Día y horario');
    await secondCard.getByRole('button', { name: 'No, gracias' }).click();
    const decline = shopper.getByRole('dialog');
    await decline.getByLabel('¿Por qué? (opcional)').fill('Ese día no estoy en casa.');
    await decline.getByRole('button', { name: 'Enviar respuesta' }).click();
    await expect(shopper.getByText('Listo: le avisamos a la florería.')).toBeVisible();
    await expect(shopper.getByTestId('buyer-order-change-declined')).toBeVisible();
    await waitForEmail(OWNER_EMAIL, {
      subject: `El cliente no aceptó los cambios del pedido ${second}`,
    });

    // «Por atender» → «No a los cambios» → l'ordine, con il motivo, che la fioreria rifiuta.
    await page.goto('/app/las-camelias');
    const declinedRow = page.getByTestId('todo-card').getByTestId('todo-declined-changes');
    await expect(declinedRow).toContainText(/dij(o|eron) que no a los cambios/);
    await declinedRow.getByRole('link').click();
    await expect(page).toHaveURL(/changes=declined/);
    await expect(page.getByTestId('filter-declined-changes')).toHaveAttribute(
      'aria-current',
      'page',
    );
    const row = page.getByRole('link').filter({ hasText: second });
    await expect(row.getByTestId('row-change-declined')).toHaveText('El cliente dijo que no');
    await row.click();
    await expect(page.getByTestId('order-change-declined')).toContainText(
      'Ese día no estoy en casa.',
    );
    await page.getByTestId('online-pending').getByRole('button', { name: 'Rechazar' }).click();
    const reject = page.getByRole('dialog');
    await reject.getByRole('radio', { name: /No tenemos disponibilidad para ese día/ }).check();
    await reject.getByRole('button', { name: 'Rechazar pedido' }).click();
    await expect(page.getByText('Pedido cancelado', { exact: false })).toBeVisible();
    await visitor.close();

    // Si rimette la tienda com'era per gli altri test.
    await closeStore(page);
  });
});
