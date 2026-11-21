/**
 * Server SMTP "pozzo" per i test end-to-end: accetta qualsiasi email in arrivo e la salva
 * come JSON in una cartella, così i test (in processi diversi) possono leggerla.
 * Mai usato fuori dai test: in sviluppo si usa Mailpit (docker-compose).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';

export interface StoredEmail {
  readonly to: string[];
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly receivedAt: string;
}

export async function startMailSink(port: number, directory: string): Promise<SMTPServer> {
  mkdirSync(directory, { recursive: true });
  let counter = 0;
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, _session, callback) {
      simpleParser(stream)
        .then((parsed) => {
          const to = (Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [])
            .flatMap((address) => address.value.map((value) => (value.address ?? '').toLowerCase()));
          const email: StoredEmail = {
            to,
            subject: parsed.subject ?? '',
            text: parsed.text ?? '',
            html: typeof parsed.html === 'string' ? parsed.html : '',
            receivedAt: new Date().toISOString(),
          };
          counter += 1;
          writeFileSync(join(directory, `${Date.now()}-${counter}.json`), JSON.stringify(email));
          callback();
        })
        .catch((error: unknown) => callback(error as Error));
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return server;
}
