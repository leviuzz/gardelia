/**
 * Log strutturati JSON (pino). Mai loggare password, token, cookie o contenuti delle email:
 * i percorsi sensibili sono oscurati. Per i dati personali si logga l'ID, non l'email.
 */
import { pino, type Logger } from 'pino';

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'floral-os' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'password',
      '*.password',
      'token',
      '*.token',
      'secret',
      '*.secret',
      'headers.cookie',
      'headers.authorization',
      'email',
      '*.email',
      'html',
      'text',
    ],
    censor: '[redacted]',
  },
});

export type { Logger };
