/**
 * Avvio manuale del pozzo SMTP (sviluppo senza Docker):
 *   pnpm --filter @floral/web mail-sink
 * Le email vengono salvate come JSON in apps/web/.mail-sink/.
 */
import { fileURLToPath } from 'node:url';
import { startMailSink } from './mail-sink';

const port = Number(process.env.MAIL_SINK_PORT ?? '1025');
const directory = fileURLToPath(new URL('../../.mail-sink', import.meta.url));

startMailSink(port, directory)
  .then(() => console.info(`Pozzo SMTP in ascolto su smtp://127.0.0.1:${port} → ${directory}`))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
