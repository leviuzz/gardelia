import { expect, type Page } from '@playwright/test';

/**
 * Il passo "Cliente" di "Nuevo pedido" e "Nueva cotización" mostra solo i primi 20 clienti in
 * ordine alfabetico, e sullo stesso database ogni esecuzione dei test ne aggiunge altri: un
 * cliente del seed può uscire dall'elenco. Qui lo si cerca per nome, come farebbe la fioreria.
 */
async function searchCustomer(page: Page, name: string): Promise<void> {
  await page.getByRole('searchbox', { name: 'Buscar cliente' }).fill(name);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  // Aspetta l'elenco filtrato: un clic sull'elenco di prima partirebbe durante la navigazione.
  await expect(page).toHaveURL(/[?&]q=/);
}

/** Sceglie il cliente nel passo "Cliente" di "Nuevo pedido". */
export async function pickOrderCustomer(page: Page, name: string): Promise<void> {
  await searchCustomer(page, name);
  await page.getByRole('button', { name: `Pedido para ${name}` }).click();
}

/** Sceglie il cliente nel passo "Cliente" di "Nueva cotización". */
export async function pickQuoteCustomer(page: Page, name: string): Promise<void> {
  await searchCustomer(page, name);
  await page.getByRole('button', { name: `Cotización para ${name}` }).click();
}
