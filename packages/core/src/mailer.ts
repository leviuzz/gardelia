/**
 * Invio email transazionali tramite adattatori (porta `Mailer`):
 *  - SmtpMailer:    qualsiasi provider SMTP (Resend, Postmark, SES, Mailgun) o Mailpit in locale.
 *  - ConsoleMailer: SOLO sviluppo, quando SMTP_URL non è impostata. Non invia nulla:
 *                   scrive destinatario, oggetto e link nel log del server, dichiarandolo.
 *  - MemoryMailer:  test automatici.
 * In produzione senza SMTP_URL l'app si rifiuta di creare il mailer (nessun invio "finto").
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { BRAND } from '@floral/domain';
import { emailConfig } from './config';
import { logger } from './logger';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** Categoria per log/metriche (es. "invitation"). */
  readonly category: string;
}

export interface Mailer {
  readonly kind: 'smtp' | 'console' | 'memory';
  send(message: EmailMessage): Promise<void>;
}

export class SmtpMailer implements Mailer {
  readonly kind = 'smtp' as const;
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    logger.info({ category: message.category }, 'email inviata');
  }
}

export class ConsoleMailer implements Mailer {
  readonly kind = 'console' as const;

  async send(message: EmailMessage): Promise<void> {
    // Volutamente fuori dal logger strutturato (che oscura i testi): è uno strumento di sviluppo.
    console.info(
      [
        '',
        '──────── EMAIL NON INVIATA (sviluppo: SMTP_URL non configurata) ────────',
        `Per:     ${message.to}`,
        `Oggetto: ${message.subject}`,
        '',
        message.text,
        '──────────────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  }
}

export class MemoryMailer implements Mailer {
  readonly kind = 'memory' as const;
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  lastTo(to: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === to);
  }
}

/** SMTP se configurato; in sviluppo, senza SMTP, le email finiscono nel log (config.ts). */
export function createMailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const config = emailConfig(env);
  const from = config.EMAIL_FROM ?? `${BRAND.productName} <no-reply@localhost>`;
  return config.SMTP_URL ? new SmtpMailer(config.SMTP_URL, from) : new ConsoleMailer();
}

let mailer: Mailer | null = null;

export function getMailer(): Mailer {
  mailer ??= createMailerFromEnv();
  return mailer;
}

/** Solo per i test: sostituisce il mailer del processo. */
export function setMailer(next: Mailer | null): void {
  mailer = next;
}
