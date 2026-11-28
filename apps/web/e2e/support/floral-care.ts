import { expect, type Browser, type Page } from '@playwright/test';
import { linkFrom, waitForEmail } from './mailbox';
import { ownClientHeaders } from './network';

/**
 * Passi comuni dei test di Floral Care con la pagina del cliente (blocco 5, ADR-084): orari,
 * tarifas, un contratto confermato, l'invito e la persona che lo accetta, il controllo a 320 px.
 */
export const SHOP = '/app/las-camelias';

/** Il giorno di oggi + `offset` nel fuso della fioreria demo (AAAA-MM-GG). */
export function dayInShop(offset: number): string {
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

export function weekdayName(iso: string): string {
  const name = new Intl.DateTimeFormat('es-MX', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  );
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Un orario libero per il giorno della settimana di `day`; restituisce etichetta e orari. */
export async function addSlot(page: Page, day: string, after = 0) {
  const form = page.locator('form').filter({ hasText: 'Nuevo horario' });
  const activeSlots = page.getByTestId('care-slots-active');
  const starts = Array.from({ length: 56 }, (_, index) => 300 + index * 15)
    .filter((start) => start > after)
    .sort(() => Math.random() - 0.5);
  for (const start of starts) {
    const label = `${weekdayName(day)} · ${hhmm(start)}–${hhmm(start + 60)}`;
    // Solo gli orari attivi: il server rifiuta un doppione di quelli, non degli archiviati.
    if ((await activeSlots.getByText(label, { exact: true }).count()) > 0) continue;
    await form.getByLabel('Día').selectOption({ label: weekdayName(day) });
    await form.getByLabel('Desde').fill(hhmm(start));
    await form.getByLabel('Hasta').fill(hhmm(start + 60));
    await form.getByLabel('Visitas a la vez').fill('2');
    await form.getByRole('button', { name: 'Agregar horario' }).click();
    await expect(page.getByText('Horario agregado')).toBeVisible();
    await expect(activeSlots.getByText(label, { exact: true })).toBeVisible();
    return { label, start, time: `${hhmm(start)}–${hhmm(start + 60)}` };
  }
  throw new Error(`Nessun orario libero il ${day}`);
}

/** Tarifas di Floral Care con il preavviso dato (ore). */
export async function saveOffer(page: Page, noticeHours: string) {
  await page.goto(`${SHOP}/settings/floral-care`);
  await page.locator('#care-visit-fee').fill('450');
  await page.locator('#care-careFeeMedium').fill('20');
  await page.locator('#care-notice').fill(noticeHours);
  await page.getByRole('checkbox', { name: /Cada semana/ }).check();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Tarifas guardadas', { exact: true })).toBeVisible();
}

export async function archiveSlot(page: Page, label: string) {
  await page.goto(`${SHOP}/settings/floral-care`);
  await page.getByRole('button', { name: `Archivar ${label}` }).click();
  const archive = page.getByRole('dialog');
  const notice = archive.getByRole('checkbox', { name: 'Sí, avisé al cliente' });
  if ((await notice.count()) > 0) await notice.check();
  await archive.getByRole('button', { name: 'Archivar', exact: true }).click();
  await expect(page.getByText(/Horario archivado\./)).toBeVisible();
}

/**
 * A 320 px la pagina non scorre di lato (CLAUDE.md §7). Con `E2E_SHOTS=1` salva anche la schermata
 * in test-results per guardarla.
 */
export async function expectFitsAt320(page: Page, name: string) {
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

/**
 * Un cliente nuovo con una sede, un contratto settimanale da `firstDay` nell'orario dato, quattro
 * piante e la conferma. Restituisce la pagina del contratto e il suo numero.
 */
export async function createConfirmedContract(
  page: Page,
  options: { readonly customer: string; readonly slotLabel: string; readonly firstDay: string },
) {
  await page.goto(`${SHOP}/customers/new`);
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(options.customer);
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
  await page.getByRole('checkbox', { name: options.slotLabel }).check();
  await page.getByRole('textbox', { name: 'Primer día' }).fill(options.firstDay);
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
  return { contractUrl, number: number ?? '' };
}

/**
 * "Acceso del cliente" nella pagina del contratto: una fioreria demo non manda email, il link sì.
 * Restituisce il percorso dell'invito.
 */
export async function inviteFromContract(page: Page, email: string): Promise<string> {
  const card = page.getByTestId('portal-access-card');
  await expect(card.getByText(/no se envían correos/)).toBeVisible();
  await card.getByLabel('Correo').fill(email);
  await card.getByRole('button', { name: 'Invitar' }).click();
  await expect(page.getByText('Invitación lista: copia el enlace y mándalo.')).toBeVisible();
  const inviteUrl = await card.getByTestId('portal-invite-url').first().inputValue();
  expect(inviteUrl).toContain('/cuenta/floral-care/invitacion/');
  return new URL(inviteUrl).pathname;
}

/**
 * La persona invitata, in un browser suo: dal link alla registrazione, verifica dell'email e
 * "Aceptar invitación". Restituisce il contesto (da chiudere), la pagina e l'URL del contratto.
 */
export async function acceptInviteAsNewPerson(
  browser: Browser,
  options: { readonly invitePath: string; readonly email: string; readonly name: string },
) {
  const visitor = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: ownClientHeaders(),
  });
  const person = await visitor.newPage();
  await person.goto(options.invitePath);
  await expect(person.getByText(`La invitación es para ${options.email}.`)).toBeVisible();
  await expectFitsAt320(person, 'invite');
  await person.getByRole('link', { name: 'Crear mi cuenta' }).click();
  const password = 'una-clave-segura-789';
  await person.getByLabel('Nombre completo').fill(options.name);
  await person.getByLabel('Correo electrónico').fill(options.email);
  await person.getByLabel('Contraseña', { exact: true }).fill(password);
  await person.getByLabel('Confirma la contraseña').fill(password);
  await person.getByRole('button', { name: 'Crear cuenta' }).click();
  const verification = await waitForEmail(options.email, { subject: 'Confirma tu correo' });
  await person.goto(linkFrom(verification, '/api/auth/verify-email'));
  await expect(person).toHaveURL(
    new RegExp(options.invitePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  await person.getByRole('button', { name: 'Aceptar invitación' }).click();
  await expect(person).toHaveURL(/\/cuenta\/floral-care\/[0-9a-f-]{36}$/);
  return { visitor, person, portalUrl: person.url() };
}

/** "Terminar contrato" con l'ultimo giorno dato (la fioreria ha avvisato il cliente). */
export async function endContract(page: Page, contractUrl: string, lastDay: string) {
  await page.goto(contractUrl);
  await page.getByRole('button', { name: 'Terminar contrato' }).click();
  const end = page.getByRole('dialog');
  await end.getByLabel('Último día de servicio').fill(lastDay);
  await end.getByRole('checkbox', { name: 'Sí, avisé al cliente' }).check();
  await end.getByRole('button', { name: 'Terminar contrato' }).click();
  await expect(page.getByText(/Fin del contrato guardado/)).toBeVisible();
}
