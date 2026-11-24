import { expect, test, type Page } from '@playwright/test';

/**
 * Floral Care (ADR-075, blocco 1): la fiorista prepara l'offerta e un orario di visita, fa un
 * contratto dalla scheda del cliente con le piante della diagnosi, lo conferma (il prezzo lo
 * calcola il server) e trova la visita nell'Agenda; spostarla chiede "Sí, avisé al cliente".
 * Blocco 2 (ADR-078): lo staff fa la visita di oggi dal telefono (servizi, piante, foto, nota,
 * avviso) e la termina; il cliente apre il resoconto senza account; la proprietaria vede l'avviso
 * e la visita nella ruta. Blocco 2b: una visita extra a un'ora libera, una pianta di stagione, la
 * cotización del cambio legata al contratto e il ritiro "en la cotización". Blocco 3a (ADR-079):
 * il cargo del mese nasce alla conferma, si paga e si annulla; l'estado de cuenta paga due sedi
 * con un solo pagamento. Alla fine il contratto finisce e l'orario si archivia, così le
 * esecuzioni non si sommano.
 */
const SHOP = '/app/las-camelias';

/** Un giorno nel calendario della fioreria (Città del Messico), "AAAA-MM-GG": oggi + `offset`. */
function dayInShop(offset: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(`${parts}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function tomorrowInShop(): string {
  return dayInShop(1);
}

function weekdayName(iso: string): string {
  const name = new Intl.DateTimeFormat('es-MX', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  );
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Un orario per il giorno della settimana di `day`, a un quarto d'ora a caso (5:00–18:45). Un
 * orario uguale già nell'elenco (di un altro test o di un'esecuzione interrotta) si salta: il
 * server lo rifiuterebbe ("Ya tienes un horario igual").
 */
async function addSlot(page: Page, day: string): Promise<string> {
  const form = page.locator('form').filter({ hasText: 'Nuevo horario' });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const start = 300 + Math.floor(Math.random() * 56) * 15;
    const label = `${weekdayName(day)} · ${hhmm(start)}–${hhmm(start + 60)}`;
    if ((await page.getByText(label).count()) > 0) continue;
    await form.getByLabel('Día').selectOption({ label: weekdayName(day) });
    await form.getByLabel('Desde').fill(hhmm(start));
    await form.getByLabel('Hasta').fill(hhmm(start + 60));
    await form.getByLabel('Visitas a la vez').fill('2');
    await form.getByRole('button', { name: 'Agregar horario' }).click();
    await expect(page.getByText('Horario agregado')).toBeVisible();
    await expect(page.getByText(label)).toBeVisible();
    return label;
  }
  throw new Error(`Nessun orario libero il ${day}`);
}

/** Cliente con la dirección del lugar delle piante, dalla sua scheda. */
async function newCustomerWithAddress(page: Page, name: string) {
  await page.goto(`${SHOP}/customers/new`);
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Crear cliente' }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
  await page.getByRole('button', { name: 'Agregar dirección' }).click();
  await page.getByRole('textbox', { name: 'Calle y número' }).fill('Av. Universidad 100');
  await page.getByRole('textbox', { name: 'Código postal' }).fill('20000');
  await page.getByRole('textbox', { name: 'Municipio o alcaldía' }).fill('Aguascalientes');
  await page.getByRole('button', { name: 'Agregar dirección' }).click();
  await expect(page.getByText('Dirección agregada')).toBeVisible();
}

/** Fine del contratto (con l'avviso) e orario archiviato: niente resta per la prossima volta. */
async function cleanUp(page: Page, contractUrl: string, lastDay: string, slotLabel: string) {
  await page.goto(contractUrl);
  await page.getByRole('button', { name: 'Terminar contrato' }).click();
  const end = page.getByRole('dialog');
  await end.getByLabel('Último día de servicio').fill(lastDay);
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
}

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

    await saveOffer(page);
    // Un orario nuovo, diverso da quelli (anche archiviati) delle esecuzioni passate.
    const slotLabel = await addSlot(page, tomorrow);

    // Un cliente con la dirección del lugar con le piante.
    await page.goto(`${SHOP}/customers/new`);
    await page
      .getByRole('textbox', { name: 'Nombre', exact: true })
      .fill(`Oficinas Verdes ${stamp}`);
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

test.describe('Floral Care: la visita dal telefono', () => {
  test('lo staff fa la visita di oggi, il cliente apre il resoconto, la proprietaria vede l’avviso', async ({
    browser,
  }) => {
    const stamp = Date.now();
    const today = dayInShop(0);
    const owner = await browser.newContext({ storageState: 'e2e/.auth/owner.json' });
    const page = await owner.newPage();

    await saveOffer(page);
    const slotLabel = await addSlot(page, today);
    const customer = `Hotel Visita ${stamp}`;
    await newCustomerWithAddress(page, customer);
    await page.getByRole('link', { name: 'Nuevo contrato' }).click();
    await page.getByRole('radio', { name: /Cada semana/ }).check();
    await page.getByRole('checkbox', { name: slotLabel }).check();
    await page.getByRole('textbox', { name: 'Primer día' }).fill(today);
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page).toHaveURL(/\/subscriptions\/[0-9a-f-]{36}\?created=1$/);
    const contractUrl = page.url().replace('?created=1', '');
    for (const [name, quantity] of [
      ['Potos en jardinera', '3'],
      ['Monstera', '1'],
    ] as const) {
      await page.getByRole('button', { name: 'Agregar plantas' }).click();
      const plants = page.getByRole('dialog');
      await plants.getByLabel('Nombre').fill(name);
      await plants.getByLabel('Cantidad').fill(quantity);
      await plants.getByRole('radio', { name: 'Mediana' }).check();
      await plants.getByRole('button', { name: 'Agregar plantas' }).click();
      await expect(page.getByText(`${quantity} × ${name}`)).toBeVisible();
    }
    await page.getByRole('button', { name: 'Confirmar contrato' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(page.getByText(/Contrato confirmado: \d+ visitas agendadas\./)).toBeVisible();
    const number = (await page.getByRole('heading', { level: 1 }).textContent())?.match(
      /SUS-\d+/,
    )?.[0];
    expect(number).toBeTruthy();

    // Lo staff, dal telefono: Agenda di oggi → Empezar → la visita.
    const staffContext = await browser.newContext({
      storageState: 'e2e/.auth/staff.json',
      viewport: { width: 360, height: 740 },
    });
    const phone = await staffContext.newPage();
    await phone.goto(`${SHOP}/agenda`);
    const card = phone.getByRole('article').filter({ hasText: number ?? 'SUS' });
    await card.getByRole('button', { name: /Empezar visita/ }).click();
    await expect(phone.getByText('Visita empezada')).toBeVisible();
    await card.getByRole('link', { name: 'Continuar visita' }).click();
    await expect(phone.getByRole('heading', { level: 1 })).toContainText(number ?? 'SUS');
    await expect(phone.getByText('En curso').first()).toBeVisible();

    const firstService = phone.getByRole('button', { name: 'Hecho' }).first();
    if ((await firstService.count()) > 0) {
      await firstService.click();
      await expect(
        phone.getByRole('button', { name: 'Hecho', pressed: true }).first(),
      ).toBeVisible();
    }
    const potos = phone.getByRole('form', { name: '¿Cómo está Potos en jardinera?' });
    await potos.getByRole('button', { name: 'Problema' }).click();
    await expect(potos.getByRole('button', { name: 'Problema', pressed: true })).toBeVisible();
    await phone.getByRole('button', { name: 'Todas bien' }).first().click();
    await expect(phone.getByText('1 planta marcada como bien')).toBeVisible();

    await phone.getByTestId('care-photo-gallery').setInputFiles('e2e/fixtures/ramo.jpg');
    await expect(phone.getByText('Se subió 1 foto')).toBeVisible();
    await expect(phone.getByRole('img', { name: 'Foto de la visita' })).toBeVisible();

    await phone
      .locator('#visit-note')
      .fill('Regamos todo; el potos de la entrada tiene hojas amarillas.');
    await phone.getByRole('button', { name: 'Guardar nota' }).click();
    await expect(phone.getByText('Nota guardada')).toBeVisible();
    const request = `Pide una visita el viernes antes de su evento (${stamp}).`;
    await phone.locator('#follow-up-note').fill(request);
    await phone.getByRole('button', { name: 'Avisar' }).click();
    await expect(phone.getByText('Aviso enviado')).toBeVisible();

    await phone.getByRole('button', { name: 'Terminar visita' }).first().click();
    const finish = phone.getByRole('dialog');
    // Florería de demostración: niente email ai clienti, si condivide il link.
    await expect(finish.getByText(/Florería de demostración/)).toBeVisible();
    await finish.getByRole('button', { name: 'Terminar visita' }).click();
    await expect(phone.getByText('Visita terminada')).toBeVisible();
    await expect(phone.getByRole('heading', { name: 'Reporte de la visita' })).toBeVisible();
    const reportUrl = await phone.getByRole('textbox', { name: 'Enlace' }).inputValue();
    expect(reportUrl).toMatch(/\/visita\/[A-Za-z0-9_-]{64}$/);

    // Il cliente, senza account: il resoconto con la foto e la nota.
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    await visitor.goto(reportUrl);
    await expect(
      visitor.getByRole('heading', { level: 1, name: 'Reporte de tu visita' }),
    ).toBeVisible();
    await expect(visitor.getByText(/hojas amarillas/)).toBeVisible();
    await expect(visitor.getByRole('img', { name: 'Foto de la visita' }).first()).toBeVisible();
    await expect(visitor.getByText(request)).toHaveCount(0);
    await anonymous.close();
    await staffContext.close();

    // La proprietaria: l'avviso nell'Agenda e la visita nella ruta del giorno.
    await page.goto(`${SHOP}/agenda`);
    await expect(page.getByText(/aviso(s)? del equipo/)).toBeVisible();
    await page.goto(`${SHOP}/agenda/follow-ups`);
    const followUp = page.getByRole('listitem').filter({ hasText: request });
    await followUp.getByRole('button', { name: 'Atendido' }).click();
    await expect(page.getByText('Aviso resuelto')).toBeVisible();
    await page.goto(`${SHOP}/agenda/route`);
    await expect(page.getByRole('heading', { level: 1, name: 'Ruta del día' })).toBeVisible();
    await page.getByText(/paradas? hechas?/).click();
    await expect(page.getByRole('article').filter({ hasText: number ?? 'SUS' })).toBeVisible();

    await cleanUp(page, contractUrl, today, slotLabel);
    await owner.close();
  });
});

test.describe('Floral Care: visite extra e cambio di stagione', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('visita extra a un’ora libera, pianta di stagione, cotización del cambio e ritiro', async ({
    page,
  }) => {
    const stamp = Date.now();
    const today = dayInShop(0);
    const later = dayInShop(2);
    await saveOffer(page);
    const slotLabel = await addSlot(page, today);
    await newCustomerWithAddress(page, `Oficinas Temporada ${stamp}`);
    await page.getByRole('link', { name: 'Nuevo contrato' }).click();
    await page.getByRole('radio', { name: /Cada semana/ }).check();
    await page.getByRole('checkbox', { name: slotLabel }).check();
    await page.getByRole('textbox', { name: 'Primer día' }).fill(today);
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page).toHaveURL(/\/subscriptions\/[0-9a-f-]{36}\?created=1$/);
    const contractUrl = page.url().replace('?created=1', '');
    for (const [name, quantity, seasonal] of [
      ['Potos', '2', false],
      ['Nochebuena', '4', true],
    ] as const) {
      await page.getByRole('button', { name: 'Agregar plantas' }).click();
      const plants = page.getByRole('dialog');
      await plants.getByLabel('Nombre').fill(name);
      await plants.getByLabel('Cantidad').fill(quantity);
      await plants.getByRole('radio', { name: 'Mediana' }).check();
      if (seasonal) await plants.getByRole('checkbox', { name: /De temporada/ }).check();
      await plants.getByRole('button', { name: 'Agregar plantas' }).click();
      await expect(page.getByText(`${quantity} × ${name}`)).toBeVisible();
    }
    await expect(page.getByText('Temporada', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar contrato' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(page.getByText(/Contrato confirmado: \d+ visitas agendadas\./)).toBeVisible();

    // Una visita extra fuori dagli orari: non occupa posti e il costo lo dice il server.
    await page.getByRole('button', { name: 'Visita extra' }).click();
    const extra = page.getByRole('dialog');
    await expect(extra.getByRole('heading', { name: 'Agendar una visita extra' })).toBeVisible();
    await extra.getByRole('radio', { name: 'A otra hora' }).check();
    await extra.getByRole('textbox', { name: 'Día', exact: true }).fill(later);
    await extra.getByRole('textbox', { name: 'Desde', exact: true }).fill('17:15');
    await extra.getByRole('textbox', { name: 'Hasta', exact: true }).fill('18:00');
    await extra.getByRole('radio', { name: 'Sin costo' }).check();
    await extra.getByLabel('Nota para quien la hace').fill('Revisar el riego de la terraza');
    await extra.getByRole('button', { name: 'Agendar visita' }).click();
    await expect(page.getByText('Visita extra agendada')).toBeVisible();
    await expect(page.getByText('Extra · Trabajo extra').first()).toBeVisible();

    await page.goto(`${SHOP}/agenda?date=${later}`);
    await expect(page.getByText('A otra hora · sin lugares')).toBeVisible();
    const card = page.getByRole('article').filter({ hasText: `Oficinas Temporada ${stamp}` });
    await expect(card.getByText('Extra · Trabajo extra')).toBeVisible();

    // Il cambio di stagione: la cotización nasce dal contratto, poi il ritiro "en la cotización".
    await page.goto(contractUrl);
    await page.getByRole('button', { name: 'Cotizar el cambio de temporada' }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('textbox', { name: 'Título' })).toHaveValue(
      /^Cambio de temporada · SUS-\d+$/,
    );
    await page.goto(contractUrl);
    await expect(page.getByText('Cotizaciones del contrato')).toBeVisible();
    await page.getByRole('button', { name: 'Agendar el retiro' }).click();
    const pickup = page.getByRole('dialog');
    await expect(pickup.getByRole('radio', { name: 'En la cotización' })).toBeChecked();
    await pickup.getByRole('radio', { name: 'A otra hora' }).check();
    await pickup.getByRole('textbox', { name: 'Día', exact: true }).fill(today);
    await pickup.getByRole('textbox', { name: 'Desde', exact: true }).fill('21:00');
    await pickup.getByRole('textbox', { name: 'Hasta', exact: true }).fill('21:45');
    await pickup.getByRole('button', { name: 'Agendar visita' }).click();
    await expect(page.getByText('Visita extra agendada')).toBeVisible();
    await expect(page.getByText('Extra · Retiro de temporada').first()).toBeVisible();

    await cleanUp(page, contractUrl, today, slotLabel);
  });
});

test.describe('Floral Care: cargos y pagos', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('il cargo nasce alla conferma, si paga e si annulla; l’estado de cuenta paga due sedi', async ({
    page,
  }) => {
    const stamp = Date.now();
    const today = dayInShop(0);
    const customerName = `Corporativo Cobros ${stamp}`;
    await saveOffer(page);
    const slotLabel = await addSlot(page, today);
    await newCustomerWithAddress(page, customerName);
    const customerUrl = page.url().replace('?created=1', '');
    await page.getByRole('button', { name: 'Agregar dirección' }).click();
    await page.getByRole('textbox', { name: 'Calle y número' }).fill('Blvd. Norte 200');
    await page.getByRole('textbox', { name: 'Código postal' }).fill('20000');
    await page.getByRole('textbox', { name: 'Municipio o alcaldía' }).fill('Aguascalientes');
    await page.getByRole('button', { name: 'Agregar dirección' }).click();
    await expect(page.getByText('Dirección agregada')).toBeVisible();

    // Due sedi dello stesso cliente, ognuna con il suo contratto settimanale da oggi.
    const contracts: string[] = [];
    for (const street of ['Av. Universidad 100', 'Blvd. Norte 200']) {
      await page.goto(customerUrl);
      await page.getByRole('link', { name: 'Nuevo contrato' }).click();
      await page.getByRole('radio', { name: new RegExp(street) }).check();
      await page.getByRole('radio', { name: /Cada semana/ }).check();
      await page.getByRole('checkbox', { name: slotLabel }).check();
      await page.getByRole('textbox', { name: 'Primer día' }).fill(today);
      await page.getByRole('button', { name: 'Crear borrador' }).click();
      await expect(page).toHaveURL(/\/subscriptions\/[0-9a-f-]{36}\?created=1$/);
      contracts.push(page.url().replace('?created=1', ''));
      await page.getByRole('button', { name: 'Agregar plantas' }).click();
      const plants = page.getByRole('dialog');
      await plants.getByLabel('Nombre').fill('Potos');
      await plants.getByLabel('Cantidad').fill('2');
      await plants.getByRole('radio', { name: 'Mediana' }).check();
      await plants.getByRole('button', { name: 'Agregar plantas' }).click();
      await expect(page.getByText('2 × Potos')).toBeVisible();
      await page.getByRole('button', { name: 'Confirmar contrato' }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Confirmar', exact: true })
        .click();
      await expect(page.getByText(/Contrato confirmado: \d+ visitas agendadas\./)).toBeVisible();
    }

    // Alla conferma nasce il cargo del mese: le visite che restano × 450 + 2 × 20.
    await expect(page.getByRole('heading', { name: 'Reglas del contrato' })).toBeVisible();
    await page
      .getByRole('link', { name: /CAR-\d+/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1, name: /^Cargo CAR-\d+$/ })).toBeVisible();
    // Le righe ci sono due volte: sullo schermo e nel documento nascosto per la stampa.
    await expect(
      page.getByText(/^\d+ visitas? × \$490\.00$/).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/^Precios finales, sin impuestos\./).filter({ visible: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Registrar pago' }).click();
    const pay = page.getByRole('dialog');
    await expect(pay.getByRole('heading', { name: 'Registrar pago' })).toBeVisible();
    await pay.getByLabel('Forma de pago').selectOption('TRANSFER');
    await pay.getByLabel('Referencia').fill('SPEI 123');
    await pay.getByRole('button', { name: 'Registrar pago' }).click();
    await expect(page.getByText('Pago registrado', { exact: true })).toBeVisible();
    await expect(page.getByText('Pago · Transferencia')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0);

    // "Anular": resta nello storico e il cargo torna da pagare.
    await page.getByRole('button', { name: /^Anular el movimiento de/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Anular', exact: true }).click();
    await expect(page.getByText('Movimiento anulado')).toBeVisible();
    await expect(page.getByText('Anulación · Transferencia')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar pago' })).toBeVisible();

    // Estado de cuenta: un solo pagamento per le due sedi, ai cargos più vecchi.
    await page.getByRole('link', { name: 'Estado de cuenta' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Estado de cuenta' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^CAR-\d+$/ })).toHaveCount(2);
    await page.getByRole('button', { name: 'Registrar pago del cliente' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Registrar pago' }).click();
    await expect(page.getByText('Pago registrado en 2 cargos')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar pago del cliente' })).toHaveCount(0);

    await page.goto(
      `${SHOP}/subscriptions/charges?view=paid&q=${encodeURIComponent(customerName)}`,
    );
    await expect(page.getByRole('heading', { level: 1, name: 'Cobros' })).toBeVisible();
    await expect(page.getByRole('link').filter({ hasText: customerName })).toHaveCount(2);

    await page.goto(contracts[0]!);
    await page.getByRole('button', { name: 'Terminar contrato' }).click();
    const end = page.getByRole('dialog');
    await end.getByLabel('Último día de servicio').fill(today);
    await end.getByRole('checkbox', { name: 'Sí, avisé al cliente' }).check();
    await end.getByRole('button', { name: 'Terminar contrato' }).click();
    await expect(page.getByText(/Fin del contrato guardado/)).toBeVisible();
    await cleanUp(page, contracts[1]!, today, slotLabel);
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
    // I soldi dei contratti li vede solo chi li gestisce (ADR-079).
    await page.goto(`${SHOP}/subscriptions/charges`);
    await expect(page.getByRole('heading', { name: 'Cobros' })).toHaveCount(0);
  });
});
