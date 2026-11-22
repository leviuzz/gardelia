import { expect, test } from '@playwright/test';

/**
 * Calendario della fioreria: le date speciali dei clienti nelle viste mese, settimana, giorno e
 * agenda, con le azioni sulla data. Vista e data stanno nell'URL (?view=…&date=…).
 */
test.describe('calendario (proprietario)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('una data nuova appare in ogni vista e sparisce se il cliente viene archiviato', async ({
    page,
  }) => {
    const stamp = Date.now();
    const customer = `Cliente calendario ${stamp}`;
    const occasion = `Boda ${stamp}`;

    await page.goto('/app/las-camelias/customers/new');
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(customer);
    await page.getByRole('button', { name: 'Agregar fecha' }).click();
    const row = page.getByRole('group', { name: 'Fecha 1' });
    await row
      .getByRole('combobox', { name: 'Tipo', exact: true })
      .selectOption({ label: 'Otra fecha' });
    await row.getByRole('textbox', { name: 'Nombre de la fecha' }).fill(occasion);
    await row.getByRole('spinbutton', { name: 'Día', exact: true }).fill('9');
    await row
      .getByRole('combobox', { name: 'Mes', exact: true })
      .selectOption({ label: 'septiembre' });
    await row.getByLabel('Año (opcional)').fill('2015');
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
    const customerPath = new URL(page.url()).pathname;

    // Dal menu laterale: il calendario si apre sul mese di oggi.
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .first()
      .getByRole('link', { name: 'Calendario' })
      .click();
    await expect(page).toHaveURL(/\/calendar$/);
    const views = page.getByRole('navigation', { name: 'Vista' });
    await expect(views.getByRole('link', { name: 'Mes' })).toHaveAttribute('aria-current', 'page');

    // Mese: la data cade il 9 settembre 2027 (le date si ripetono ogni anno).
    await page.goto('/app/las-camelias/calendar?view=month&date=2027-09-01');
    await expect(page.getByRole('heading', { name: 'septiembre de 2027' })).toBeVisible();
    await expect(page.getByRole('link', { name: customer })).toBeVisible();
    await page.getByRole('link', { name: / 9 de septiembre de 2027: / }).click();

    // Giorno: tutti i dettagli e le azioni (senza telefono, niente WhatsApp).
    await expect(page).toHaveURL(/\?view=day&date=2027-09-09$/);
    const card = page.getByRole('article').filter({ hasText: occasion });
    await expect(card).toContainText('12 años');
    await expect(card.getByRole('link', { name: 'Nueva cotización' })).toHaveAttribute(
      'href',
      /\/quotes\/new\?customerId=[0-9a-f-]{36}$/,
    );
    await expect(card.getByRole('link', { name: 'WhatsApp' })).toHaveCount(0);

    // Settimana: la stessa data, con tipo e cliente; la settimana dopo è vuota.
    await views.getByRole('link', { name: 'Semana' }).click();
    await expect(page).toHaveURL(/\?view=week&date=2027-09-09$/);
    await expect(page.getByRole('link', { name: new RegExp(occasion) })).toBeVisible();
    await page.getByRole('link', { name: 'Siguiente', exact: true }).click();
    await expect(page).toHaveURL(/\?view=week&date=2027-09-16$/);
    await expect(page.getByRole('link', { name: new RegExp(occasion) })).toHaveCount(0);

    // Agenda: i giorni con date, uno sotto l'altro; "Ver cliente" porta alla scheda.
    await page.goto('/app/las-camelias/calendar?view=agenda&date=2027-09-01');
    const agendaCard = page.getByRole('article').filter({ hasText: occasion });
    await expect(agendaCard).toBeVisible();
    await agendaCard.getByRole('link', { name: 'Ver cliente' }).click();
    await expect(page).toHaveURL(new RegExp(`${customerPath}$`));

    // Un cliente archiviato esce dal calendario.
    await page.getByRole('button', { name: 'Archivar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByText('Este cliente está archivado.')).toBeVisible();
    await page.goto('/app/las-camelias/calendar?view=day&date=2027-09-09');
    await expect(page.getByRole('article').filter({ hasText: occasion })).toHaveCount(0);

    // "Hoy" riporta alla data di oggi nella stessa vista.
    await page.getByRole('link', { name: 'Hoy', exact: true }).click();
    await expect(page).toHaveURL(/\?view=day&date=\d{4}-\d{2}-\d{2}$/);
  });
});

test.describe('calendario (staff)', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('lo staff vede le date e scrive su WhatsApp, ma non crea preventivi', async ({ page }) => {
    // Dati demo: María Fernanda compie gli anni il 14 dicembre (nata nel 1991).
    await page.goto('/app/las-camelias/calendar?view=day&date=2027-12-14');
    const card = page.getByRole('article').filter({ hasText: 'María Fernanda López' });
    await expect(card).toContainText('cumple 36');
    await expect(card.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/524495550142\?text=Hola%20Mar%C3%ADa%20Fernanda/,
    );
    await expect(card.getByRole('link', { name: 'Ver cliente' })).toBeVisible();
    await expect(card.getByRole('link', { name: 'Nueva cotización' })).toHaveCount(0);
  });
});
