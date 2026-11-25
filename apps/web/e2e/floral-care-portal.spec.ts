import { expect, test, type Page } from '@playwright/test';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';
import { runSystemSql } from './support/sql';

/**
 * Floral Care, blocco 5a (ADR-084): la pagina del cliente. La proprietaria (fioreria demo: niente
 * email, il link sì) invita una persona dal contratto; la persona si registra dal link, accetta e
 * trova "Mi Floral Care"; cambia la data della visita a un altro orario libero dello stesso giorno;
 * la fioreria lo vede nell'Agenda; "Quitar acceso" chiude la pagina. Poi un altro conto e un invito
 * scaduto. Alla fine il contratto finisce, gli orari si archiviano e il preavviso torna a 24 ore.
 */
const SHOP = '/app/las-camelias';

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

function weekdayName(iso: string): string {
  const name = new Intl.DateTimeFormat('es-MX', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  );
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Un orario libero per il giorno della settimana di `day`; restituisce etichetta e orari. */
async function addSlot(page: Page, day: string, after = 0) {
  const form = page.locator('form').filter({ hasText: 'Nuevo horario' });
  const starts = Array.from({ length: 56 }, (_, index) => 300 + index * 15)
    .filter((start) => start > after)
    .sort(() => Math.random() - 0.5);
  for (const start of starts) {
    const label = `${weekdayName(day)} · ${hhmm(start)}–${hhmm(start + 60)}`;
    if ((await page.getByText(label).count()) > 0) continue;
    await form.getByLabel('Día').selectOption({ label: weekdayName(day) });
    await form.getByLabel('Desde').fill(hhmm(start));
    await form.getByLabel('Hasta').fill(hhmm(start + 60));
    await form.getByLabel('Visitas a la vez').fill('2');
    await form.getByRole('button', { name: 'Agregar horario' }).click();
    await expect(page.getByText('Horario agregado')).toBeVisible();
    await expect(page.getByText(label)).toBeVisible();
    return { label, start, time: `${hhmm(start)}–${hhmm(start + 60)}` };
  }
  throw new Error(`Nessun orario libero il ${day}`);
}

async function saveOffer(page: Page, noticeHours: string) {
  await page.goto(`${SHOP}/settings/floral-care`);
  await page.locator('#care-visit-fee').fill('450');
  await page.locator('#care-careFeeMedium').fill('20');
  await page.locator('#care-notice').fill(noticeHours);
  await page.getByRole('checkbox', { name: /Cada semana/ }).check();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Tarifas guardadas', { exact: true })).toBeVisible();
}

/**
 * A 320 px la pagina non scorre di lato (CLAUDE.md §7). Con `E2E_SHOTS=1` salva anche la schermata
 * in test-results per guardarla.
 */
async function expectFitsAt320(page: Page, name: string) {
  const previous = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 720 });
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  if (process.env.E2E_SHOTS === '1') {
    await page.screenshot({ path: `test-results/portal-320-${name}.png`, fullPage: true });
  }
  expect({ name, scroll }).toEqual({ name, scroll: client });
  if (previous) await page.setViewportSize(previous);
}

async function archiveSlot(page: Page, label: string) {
  await page.goto(`${SHOP}/settings/floral-care`);
  await page.getByRole('button', { name: `Archivar ${label}` }).click();
  const archive = page.getByRole('dialog');
  const notice = archive.getByRole('checkbox', { name: 'Sí, avisé al cliente' });
  if ((await notice.count()) > 0) await notice.check();
  await archive.getByRole('button', { name: 'Archivar', exact: true }).click();
  await expect(page.getByText(/Horario archivado\./)).toBeVisible();
}

test.describe('Floral Care: la pagina del cliente', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('invito, registrazione, Mi Floral Care, "Cambiar fecha" e "Quitar acceso"', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const tomorrow = dayInShop(1);
    // Preavviso 0: la visita di domani si può cambiare a qualsiasi ora del giorno del test.
    await saveOffer(page, '0');
    const slot = await addSlot(page, tomorrow, 0);
    const other = await addSlot(page, tomorrow, slot.start);

    // Cliente, contratto settimanale da domani nell'orario nuovo, piante, conferma.
    const customer = `Hotel Portal ${stamp}`;
    await page.goto(`${SHOP}/customers/new`);
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(customer);
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
    await page.getByRole('button', { name: 'Agregar dirección' }).click();
    await page.getByRole('textbox', { name: 'Calle y número' }).fill('Av. Universidad 100');
    await page.getByRole('textbox', { name: 'Código postal' }).fill('20000');
    await page.getByRole('textbox', { name: 'Municipio o alcaldía' }).fill('Aguascalientes');
    await page.getByRole('button', { name: 'Agregar dirección' }).click();
    await expect(page.getByText('Dirección agregada')).toBeVisible();
    await page.getByRole('link', { name: 'Nuevo contrato' }).click();
    await page.getByRole('radio', { name: /Cada semana/ }).check();
    await page.getByRole('checkbox', { name: slot.label }).check();
    await page.getByRole('textbox', { name: 'Primer día' }).fill(tomorrow);
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page).toHaveURL(/\/subscriptions\/[0-9a-f-]{36}\?created=1$/);
    const contractUrl = page.url().replace('?created=1', '');
    await page.getByRole('button', { name: 'Agregar plantas' }).click();
    const plants = page.getByRole('dialog');
    await plants.getByLabel('Nombre').fill('Potos en jardinera');
    await plants.getByLabel('Cantidad').fill('4');
    await plants.getByRole('radio', { name: 'Mediana' }).check();
    await plants.getByRole('button', { name: 'Agregar plantas' }).click();
    await expect(page.getByText('Plantas agregadas')).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar contrato' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(page.getByText(/Contrato confirmado: \d+ visitas agendadas\./)).toBeVisible();
    const number = (await page.getByRole('heading', { level: 1 }).textContent())?.match(
      /SUS-\d+/,
    )?.[0];
    expect(number).toBeTruthy();

    // "Acceso del cliente": una fioreria demo non manda email, il link sì.
    const card = page.getByTestId('portal-access-card');
    await expect(card.getByText(/no se envían correos/)).toBeVisible();
    const email = uniqueEmail('portal');
    await card.getByLabel('Correo').fill(email);
    await card.getByRole('button', { name: 'Invitar' }).click();
    await expect(page.getByText('Invitación lista: copia el enlace y mándalo.')).toBeVisible();
    const inviteUrl = await card.getByTestId('portal-invite-url').inputValue();
    expect(inviteUrl).toContain('/cuenta/floral-care/invitacion/');
    const invitePath = new URL(inviteUrl).pathname;

    // Con il conto della fioreria (altra email) l'invito chiede di cambiare conto.
    await page.goto(invitePath);
    await expect(page.getByText(/pero la invitación es para/)).toBeVisible();

    // La persona: dal link alla registrazione, verifica dell'email, accetta.
    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const person = await visitor.newPage();
    await person.goto(invitePath);
    await expect(person.getByText(`La invitación es para ${email}.`)).toBeVisible();
    await expectFitsAt320(person, 'invite');
    await person.getByRole('link', { name: 'Crear mi cuenta' }).click();
    const password = 'una-clave-segura-789';
    await person.getByLabel('Nombre completo').fill('Lucía Recepción');
    await person.getByLabel('Correo electrónico').fill(email);
    await person.getByLabel('Contraseña', { exact: true }).fill(password);
    await person.getByLabel('Confirma la contraseña').fill(password);
    await person.getByRole('button', { name: 'Crear cuenta' }).click();
    const verification = await waitForEmail(email, { subject: 'Confirma tu correo' });
    await person.goto(linkFrom(verification, '/api/auth/verify-email'));
    await expect(person).toHaveURL(new RegExp(invitePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await person.getByRole('button', { name: 'Aceptar invitación' }).click();
    await expect(person).toHaveURL(/\/cuenta\/floral-care\/[0-9a-f-]{36}$/);
    const portalUrl = person.url();
    await expect(person.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(person.getByText('Próximas visitas')).toBeVisible();
    await expect(person.getByText('Potos en jardinera')).toBeVisible();
    await expect(person.getByTestId('my-care-charges')).toBeVisible();
    await expectFitsAt320(person, 'contract');

    // "Cambiar fecha": l'altro orario dello stesso giorno.
    await person
      .getByTestId('my-care-upcoming')
      .getByRole('link', { name: 'Cambiar fecha' })
      .first()
      .click();
    await expect(person.getByRole('heading', { level: 1, name: 'Cambiar fecha' })).toBeVisible();
    await expectFitsAt320(person, 'change');
    await person
      .getByTestId('change-date-options')
      .getByRole('radio', { name: other.time })
      .first()
      .check();
    await person.getByRole('button', { name: 'Cambiar a este horario' }).click();
    await expect(person).toHaveURL(/\?cambiada=/);
    await expect(person.getByText(/Listo: tu visita quedó el/)).toBeVisible();
    await expect(person.getByText('Fecha elegida por ti').first()).toBeVisible();

    // La fioreria lo vede nell'Agenda di domani.
    await page.goto(`${SHOP}/agenda?date=${tomorrow}`);
    const visit = page.getByRole('article').filter({ hasText: number ?? 'SUS' });
    await expect(visit.getByText('Cambiada por el cliente')).toBeVisible();

    // "Quitar acceso": la pagina del cliente non si apre più.
    await page.goto(contractUrl);
    const people = page.getByTestId('portal-people');
    await expect(people.getByText('Lucía Recepción')).toBeVisible();
    await expectFitsAt320(page, 'shop-card');
    await people.getByRole('button', { name: 'Quitar acceso' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Quitar acceso' }).click();
    await expect(page.getByText('Acceso quitado.')).toBeVisible();
    const gone = await person.goto(portalUrl);
    expect(gone?.status()).toBe(404);
    await visitor.close();

    // Un invito scaduto lo dice.
    await card.getByLabel('Correo').fill(uniqueEmail('portal-tarde'));
    await card.getByRole('button', { name: 'Invitar' }).click();
    await expect(page.getByText('Invitación lista: copia el enlace y mándalo.')).toBeVisible();
    const lateUrl = await card.getByTestId('portal-invite-url').first().inputValue();
    runSystemSql(
      `UPDATE "CarePortalInvite" SET "createdAt" = now() - interval '9 days', "expiresAt" = now() - interval '1 day' WHERE "status" = 'PENDING' AND "email" LIKE 'portal-tarde-%';`,
    );
    await page.goto(new URL(lateUrl).pathname);
    await expect(
      page.getByText('La invitación venció. Pide a la florería que te mande otra.'),
    ).toBeVisible();

    // Fine: contratto finito, orari archiviati, preavviso come prima.
    await page.goto(contractUrl);
    await page.getByRole('button', { name: 'Terminar contrato' }).click();
    const end = page.getByRole('dialog');
    await end.getByLabel('Último día de servicio').fill(tomorrow);
    await end.getByRole('checkbox', { name: 'Sí, avisé al cliente' }).check();
    await end.getByRole('button', { name: 'Terminar contrato' }).click();
    await expect(page.getByText(/Fin del contrato guardado/)).toBeVisible();
    await archiveSlot(page, slot.label);
    await archiveSlot(page, other.label);
    await saveOffer(page, '24');
  });
});
