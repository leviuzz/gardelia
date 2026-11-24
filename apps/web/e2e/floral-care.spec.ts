import { expect, test, type Page } from '@playwright/test';

/**
 * Floral Care (ADR-075, blocco 1): la fiorista prepara l'offerta e un orario di visita, fa un
 * contratto dalla scheda del cliente con le piante della diagnosi, lo conferma (il prezzo lo
 * calcola il server) e trova la visita nell'Agenda; spostarla chiede "Sí, avisé al cliente".
 * Alla fine il contratto finisce e l'orario si archivia, così le esecuzioni non si sommano.
 */
const SHOP = '/app/las-camelias';

/** Domani nel calendario della fioreria (Città del Messico), "AAAA-MM-GG". */
function tomorrowInShop(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(`${parts}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function weekdayName(iso: string): string {
  const name = new Intl.DateTimeFormat('es-MX', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  );
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

async function saveOffer(page: Page) {
  await page.goto(`${SHOP}/settings/floral-care`);
  await page.locator('#care-visit-fee').fill('450');
  await page.locator('#care-careFeeMedium').fill('20');
  await page.getByRole('checkbox', { name: /Cada semana/ }).check();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Tarifas guardadas')).toBeVisible();
}

test.describe('Floral Care (propietaria)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('offerta, contratto con piante, visita nell’Agenda, spostamento con avviso', async ({
    page,
  }) => {
    const stamp = Date.now();
    const tomorrow = tomorrowInShop();
    const day = weekdayName(tomorrow);
    // Un quarto d'ora a caso fra le 5:00 e le 18:45: gli orari delle esecuzioni passate non pesano.
    const start = 300 + Math.floor(Math.random() * 56) * 15;
    const slotLabel = `${day} · ${hhmm(start)}–${hhmm(start + 60)}`;

    await saveOffer(page);
    const addSlot = page.locator('form').filter({ hasText: 'Nuevo horario' });
    await addSlot.getByLabel('Día').selectOption({ label: day });
    await addSlot.getByLabel('Desde').fill(hhmm(start));
    await addSlot.getByLabel('Hasta').fill(hhmm(start + 60));
    await addSlot.getByLabel('Visitas a la vez').fill('2');
    await addSlot.getByRole('button', { name: 'Agregar horario' }).click();
    await expect(page.getByText('Horario agregado')).toBeVisible();
    await expect(page.getByText(slotLabel)).toBeVisible();

    // Un cliente con la dirección del lugar con le piante.
    await page.goto(`${SHOP}/customers/new`);
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(`Oficinas Verdes ${stamp}`);
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
    await page.getByRole('button', { name: 'Agregar dirección' }).click();
    await page.getByRole('textbox', { name: 'Calle y número' }).fill('Av. Universidad 100');
    await page.getByRole('textbox', { name: 'Código postal' }).fill('20000');
    await page.getByRole('textbox', { name: 'Municipio o alcaldía' }).fill('Aguascalientes');
    await page.getByRole('button', { name: 'Agregar dirección' }).click();
    await expect(page.getByText('Dirección agregada')).toBeVisible();

    // La bozza: frequenza settimanale nell'orario appena creato, da domani.
    await page.getByRole('link', { name: 'Nuevo contrato' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Nuevo contrato de Floral Care' }),
    ).toBeVisible();
    await page.getByRole('radio', { name: /Cada semana/ }).check();
    await page.getByRole('checkbox', { name: slotLabel }).check();
    await page.getByRole('textbox', { name: 'Primer día' }).fill(tomorrow);
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page).toHaveURL(/\/subscriptions\/[0-9a-f-]{36}\?created=1$/);
    await expect(page.getByText('Borrador creado: agrega las plantas y confirma.')).toBeVisible();
    const contractUrl = page.url().replace('?created=1', '');

    await page.getByRole('button', { name: 'Agregar plantas' }).click();
    const plants = page.getByRole('dialog');
    await plants.getByLabel('Nombre').fill('Potos en jardinera');
    await plants.getByLabel('Cantidad').fill('10');
    await plants.getByRole('radio', { name: 'Mediana' }).check();
    await plants.getByRole('button', { name: 'Agregar plantas' }).click();
    await expect(page.getByText('Plantas agregadas')).toBeVisible();
    await expect(page.getByText('10 × Potos en jardinera')).toBeVisible();
    // 450 por visita + 10 plantas medianas × 20 (la dirección non è sulla mappa: niente distanza).
    await expect(page.getByText('Por visita', { exact: true })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: '$650.00' }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Confirmar contrato' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(page.getByText(/Contrato confirmado: \d+ visitas agendadas\./)).toBeVisible();
    const number = (await page.getByRole('heading', { level: 1 }).textContent())?.match(
      /SUS-\d+/,
    )?.[0];
    expect(number).toBeTruthy();

    // L'Agenda di domani: la visita nel suo orario.
    await page.goto(`${SHOP}/agenda?date=${tomorrow}`);
    const card = page.getByRole('article').filter({ hasText: number ?? 'SUS' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Programada')).toBeVisible();
    await expect(card.getByText('10 plantas')).toBeVisible();

    // Spostarla: senza la casella il server non salva.
    await card.getByRole('link', { name: 'Detalles' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(number ?? 'SUS');
    await page.getByLabel('Nuevo día y horario').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Cambiar fecha' }).click();
    await expect(
      page.getByText('Marca «Sí, avisé al cliente» para guardar este cambio.'),
    ).toBeVisible();
    await page.getByRole('checkbox', { name: 'Sí, avisé al cliente' }).check();
    await page.getByRole('button', { name: 'Cambiar fecha' }).click();
    await expect(page.getByText('Fecha cambiada')).toBeVisible();

    // Fine del contratto (con l'avviso) e orario archiviato: niente resta per la prossima volta.
    await page.goto(contractUrl);
    await page.getByRole('button', { name: 'Terminar contrato' }).click();
    const end = page.getByRole('dialog');
    await end.getByLabel('Último día de servicio').fill(tomorrow);
    await end.getByRole('checkbox', { name: 'Sí, avisé al cliente' }).check();
    await end.getByRole('button', { name: 'Terminar contrato' }).click();
    await expect(page.getByText(/Fin del contrato guardado/)).toBeVisible();

    await page.goto(`${SHOP}/settings/floral-care`);
    await page.getByRole('button', { name: `Archivar ${slotLabel}` }).click();
    const archive = page.getByRole('dialog');
    const notice = archive.getByRole('checkbox', { name: 'Sí, avisé al cliente' });
    if ((await notice.count()) > 0) await notice.check();
    await archive.getByRole('button', { name: 'Archivar', exact: true }).click();
    await expect(page.getByText(/Horario archivado\./)).toBeVisible();
  });
});

test.describe('Floral Care (banco)', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('il banco vede l’Agenda e l’offerta, ma non cambia tariffe né contratti', async ({
    page,
  }) => {
    await page.goto(`${SHOP}/agenda`);
    await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Visitas de Floral Care' })).toBeVisible();
    await page.goto(`${SHOP}/subscriptions`);
    await expect(page.getByRole('heading', { level: 1, name: 'Floral Care' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nuevo contrato' })).toHaveCount(0);
    await page.goto(`${SHOP}/settings/floral-care`);
    await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toHaveCount(0);
  });
});
