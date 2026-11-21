import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAIL_PORT } from '../playwright.config';
import { startMailSink } from './support/mail-sink';
import { MAIL_DIR } from './support/mailbox';

/**
 * - avvia il pozzo SMTP (le email dell'app finiscono in e2e/.mail/*.json);
 * - garantisce i dati demo con il seed (idempotente, non distruttivo).
 */
export default async function globalSetup(): Promise<void> {
  rmSync(MAIL_DIR, { recursive: true, force: true });
  const server = await startMailSink(MAIL_PORT, MAIL_DIR);
  (globalThis as { __mailSink?: typeof server }).__mailSink = server;

  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  execFileSync('pnpm', ['--filter', '@floral/db', 'run', 'seed'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}
