import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { StoredEmail } from './mail-sink';

export const MAIL_DIR = fileURLToPath(new URL('../.mail', import.meta.url));

function readAll(): StoredEmail[] {
  let files: string[];
  try {
    files = readdirSync(MAIL_DIR).filter((file) => file.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return files.map((file) => JSON.parse(readFileSync(`${MAIL_DIR}/${file}`, 'utf8')) as StoredEmail);
}

/** Attende l'email più recente per un destinatario (facoltativamente con oggetto contenente `subject`). */
export async function waitForEmail(
  to: string,
  options: { subject?: string; timeoutMs?: number } = {},
): Promise<StoredEmail> {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  const address = to.toLowerCase();
  while (Date.now() < deadline) {
    const match = readAll()
      .reverse()
      .find(
        (email) =>
          email.to.includes(address) && (!options.subject || email.subject.includes(options.subject)),
      );
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Nessuna email ricevuta per ${to}`);
}

/** Primo link http(s) nel testo che contiene `fragment`. */
export function linkFrom(email: StoredEmail, fragment: string): string {
  const link = email.text.match(/https?:\/\/\S+/g)?.find((url) => url.includes(fragment));
  if (!link) throw new Error(`Link "${fragment}" non trovato nell'email "${email.subject}"`);
  return link;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@e2e.floral.local`;
}
