/**
 * Email di Floral Care al cliente della fioreria. Il resoconto di una visita (ADR-078) e l'avviso
 * delle visite spostate o cancellate da un blocco di giorni (ADR-083).
 *
 * Resoconto: la fioreria scrive al suo cliente,
 * nella lingua del mercato della fioreria (ADR-042), cosa si è fatto e come stanno le piante, con
 * il pulsante per il resoconto completo con le foto (link pubblico, ADR-056). Niente immagini
 * nell'email. Testo semplice + HTML minimale con stili inline; ogni valore dinamico passa
 * dall'escape HTML.
 */
import { type CareBlockOutcome, type CarePlantTally, type SupportedLocale } from '@floral/domain';
import type { EmailMessage } from './mailer';
import type { CareVisitReportDto } from './services/care-report';

export interface CareReportEmailInput {
  readonly locale: SupportedLocale;
  readonly to: string;
  readonly customerName: string;
  readonly shop: {
    readonly name: string;
    readonly contactEmail: string | null;
    readonly contactPhone: string | null;
  };
  readonly report: CareVisitReportDto;
  /** Pagina pubblica del resoconto (`/visita/<token>`). */
  readonly reportUrl: string;
}

interface CareCopy {
  readonly subject: (date: string, shop: string) => string;
  readonly greeting: (name: string) => string;
  readonly done: (date: string) => string;
  readonly doneAt: (date: string, from: string, to: string) => string;
  readonly notDone: (date: string) => string;
  readonly by: (name: string) => string;
  readonly plants: (tally: CarePlantTally) => string;
  readonly services: string;
  readonly skipped: string;
  readonly note: string;
  readonly button: string;
  readonly photosNote: string;
  readonly reason: (shop: string) => string;
}

function plantWord(locale: SupportedLocale, count: number): string {
  if (locale === 'it-IT') return count === 1 ? 'pianta' : 'piante';
  if (locale === 'en-US') return count === 1 ? 'plant' : 'plants';
  return count === 1 ? 'planta' : 'plantas';
}

function tallyLine(
  locale: SupportedLocale,
  tally: CarePlantTally,
  labels: { ok: string; attention: string; problem: string; dead: string },
): string {
  const parts = [
    tally.ok > 0 ? `${tally.ok} ${labels.ok}` : null,
    tally.attention > 0 ? `${tally.attention} ${labels.attention}` : null,
    tally.problem > 0 ? `${tally.problem} ${labels.problem}` : null,
    tally.dead > 0 ? `${tally.dead} ${labels.dead}` : null,
  ].filter(Boolean);
  return `${tally.total} ${plantWord(locale, tally.total)}: ${parts.join(', ')}.`;
}

const COPY: Readonly<Record<SupportedLocale, CareCopy>> = {
  'es-MX': {
    subject: (date, shop) => `Reporte de la visita del ${date} · ${shop}`,
    greeting: (name) => `Hola, ${name}:`,
    done: (date) => `Visitamos tus plantas el ${date}.`,
    doneAt: (date, from, to) => `Visitamos tus plantas el ${date}, de ${from} a ${to}.`,
    notDone: (date) => `Pasamos el ${date}, pero no pudimos realizar la visita.`,
    by: (name) => `Te atendió ${name}.`,
    plants: (tally) =>
      tallyLine('es-MX', tally, {
        ok: 'bien',
        attention: 'necesitan atención',
        problem: 'con problema',
        dead: 'secas',
      }),
    services: 'Lo que hicimos',
    skipped: 'no se hizo',
    note: 'Nota',
    button: 'Ver el reporte con fotos',
    photosNote: 'El reporte completo tiene las fotos de la visita.',
    reason: (shop) =>
      `Recibes este correo porque tienes un servicio de cuidado de plantas con ${shop}.`,
  },
  'it-IT': {
    subject: (date, shop) => `Resoconto della visita del ${date} · ${shop}`,
    greeting: (name) => `Ciao ${name},`,
    done: (date) => `Abbiamo curato le tue piante il ${date}.`,
    doneAt: (date, from, to) =>
      `Abbiamo curato le tue piante il ${date}, dalle ${from} alle ${to}.`,
    notDone: (date) => `Siamo passati il ${date}, ma non siamo riusciti a fare la visita.`,
    by: (name) => `È venuto/a ${name}.`,
    plants: (tally) =>
      tallyLine('it-IT', tally, {
        ok: 'bene',
        attention: 'da tenere d’occhio',
        problem: 'con un problema',
        dead: 'secche',
      }),
    services: 'Cosa abbiamo fatto',
    skipped: 'non fatto',
    note: 'Nota',
    button: 'Vedi il resoconto con le foto',
    photosNote: 'Il resoconto completo ha le foto della visita.',
    reason: (shop) =>
      `Ricevi questa email perché hai un servizio di cura delle piante con ${shop}.`,
  },
  'en-US': {
    subject: (date, shop) => `Report of the ${date} visit · ${shop}`,
    greeting: (name) => `Hi ${name},`,
    done: (date) => `We took care of your plants on ${date}.`,
    doneAt: (date, from, to) => `We took care of your plants on ${date}, from ${from} to ${to}.`,
    notDone: (date) => `We came by on ${date}, but we couldn’t do the visit.`,
    by: (name) => `${name} came to see your plants.`,
    plants: (tally) =>
      tallyLine('en-US', tally, {
        ok: 'doing well',
        attention: 'need attention',
        problem: 'with a problem',
        dead: 'dead',
      }),
    services: 'What we did',
    skipped: 'not done',
    note: 'Note',
    button: 'See the report with photos',
    photosNote: 'The full report has the photos of the visit.',
    reason: (shop) =>
      `You’re receiving this email because you have a plant care service with ${shop}.`,
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

function dayLabel(locale: SupportedLocale, isoDate: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

function timeLabel(locale: SupportedLocale, at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(
    at,
  );
}

/** Email del resoconto di una visita hecha o no realizada. */
export function careVisitReportEmail(input: CareReportEmailInput): EmailMessage {
  const copy = COPY[input.locale];
  const { report } = input;
  const date = dayLabel(input.locale, report.date);
  const intro =
    report.status === 'NOT_DONE'
      ? copy.notDone(date)
      : report.startedAt && report.finishedAt
        ? copy.doneAt(
            date,
            timeLabel(input.locale, report.startedAt, report.timezone),
            timeLabel(input.locale, report.finishedAt, report.timezone),
          )
        : copy.done(date);
  const services = report.services.map((service) =>
    service.outcome === 'DONE' ? service.name : `${service.name} (${copy.skipped})`,
  );
  const lines = [
    copy.greeting(input.customerName),
    '',
    intro,
    ...(report.visitedBy ? [copy.by(report.visitedBy)] : []),
    ...(report.status === 'DONE' && report.tally.total > 0 ? ['', copy.plants(report.tally)] : []),
    ...(services.length > 0 && report.status === 'DONE'
      ? ['', `${copy.services}:`, ...services.map((name) => `- ${name}`)]
      : []),
    ...(report.note ? ['', `${copy.note}: ${report.note}`] : []),
    '',
    `${copy.button}: ${input.reportUrl}`,
    '',
    input.shop.name,
    ...[input.shop.contactPhone, input.shop.contactEmail].filter(Boolean),
    '',
    '—',
    copy.reason(input.shop.name),
  ];
  const contacts = [input.shop.contactPhone, input.shop.contactEmail].filter(
    (value): value is string => Boolean(value),
  );
  const paragraph = (content: string) =>
    `<p style="margin:0 0 16px;line-height:1.6;color:#2f3b33">${content}</p>`;
  const html = `<!doctype html><html lang="${input.locale}"><body style="margin:0;padding:16px 12px;background:#f6f4ef;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px">
<tr><td style="padding:28px 24px">
<p style="margin:0 0 24px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#3f6b4f">${escapeHtml(input.shop.name)}</p>
${paragraph(escapeHtml(copy.greeting(input.customerName)))}
${paragraph(escapeHtml(capitalize(intro)) + (report.visitedBy ? `<br>${escapeHtml(copy.by(report.visitedBy))}` : ''))}
${report.status === 'DONE' && report.tally.total > 0 ? paragraph(escapeHtml(copy.plants(report.tally))) : ''}
${
  services.length > 0 && report.status === 'DONE'
    ? `<p style="margin:0 0 8px;font-weight:600;color:#1f2a22">${escapeHtml(copy.services)}</p><ul style="margin:0 0 16px;padding-left:20px;line-height:1.6;color:#2f3b33">${services
        .map((name) => `<li>${escapeHtml(name)}</li>`)
        .join('')}</ul>`
    : ''
}
${report.note ? paragraph(`<strong>${escapeHtml(copy.note)}:</strong> ${escapeHtml(report.note)}`) : ''}
<p style="margin:24px 0 8px"><a href="${escapeHtml(input.reportUrl)}" style="display:inline-block;background:#3f6b4f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${escapeHtml(copy.button)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#5f6b62">${escapeHtml(copy.photosNote)}</p>
<p style="margin:24px 0 0;line-height:1.6;color:#2f3b33"><strong>${escapeHtml(input.shop.name)}</strong>${
    contacts.length > 0 ? `<br>${escapeHtml(contacts.join(' · '))}` : ''
  }</p>
<hr style="margin:24px 0;border:none;border-top:1px solid #e6e2d8">
<p style="margin:0;font-size:12px;color:#8a918b">${escapeHtml(copy.reason(input.shop.name))}</p>
</td></tr></table></body></html>`;

  return {
    to: input.to,
    category: 'care_visit_report',
    subject: copy.subject(date, input.shop.name),
    text: lines.join('\n'),
    html,
    fromName: input.shop.name,
    ...(input.shop.contactEmail ? { replyTo: input.shop.contactEmail } : {}),
  };
}

// -----------------------------------------------------------------------------
// Avviso dei cambi di un blocco di giorni (blocco 4, ADR-083)
// -----------------------------------------------------------------------------

export interface CareBlockNoticeChange {
  readonly outcome: CareBlockOutcome;
  readonly from: {
    readonly date: string;
    readonly start: string | null;
    readonly end: string | null;
  };
  readonly to: { readonly date: string; readonly start: string; readonly end: string } | null;
}

export interface CareBlockNoticeEmailInput {
  readonly locale: SupportedLocale;
  readonly to: string;
  readonly customerName: string;
  readonly shop: {
    readonly name: string;
    readonly contactEmail: string | null;
    readonly contactPhone: string | null;
  };
  /** La sede del contratto (indirizzo), se c'è: un cliente con più sedi capisce quale. */
  readonly place: string | null;
  readonly changes: readonly CareBlockNoticeChange[];
}

interface BlockNoticeCopy {
  readonly subject: (shop: string) => string;
  readonly intro: (shop: string) => string;
  readonly place: (address: string) => string;
  readonly moved: (from: string, to: string) => string;
  readonly toReschedule: (from: string) => string;
  readonly cancelled: (from: string) => string;
  readonly questions: string;
}

const BLOCK_NOTICE_COPY: Readonly<Record<SupportedLocale, BlockNoticeCopy>> = {
  'es-MX': {
    subject: (shop) => `Cambios en tus visitas de cuidado de plantas · ${shop}`,
    intro: (shop) => `${shop} no podrá visitar tus plantas en estos días. Así quedan tus visitas:`,
    place: (address) => `Lugar: ${address}.`,
    moved: (from, to) => `${from}: pasa al ${to}.`,
    toReschedule: (from) => `${from}: te avisaremos la nueva fecha.`,
    cancelled: (from) => `${from}: cancelada, no se cobra.`,
    questions: 'Si algo no te funciona, escríbenos o llámanos.',
  },
  'it-IT': {
    subject: (shop) => `Cambi nelle visite di cura delle piante · ${shop}`,
    intro: (shop) => `${shop} non potrà curare le tue piante in questi giorni. Ecco le tue visite:`,
    place: (address) => `Luogo: ${address}.`,
    moved: (from, to) => `${from}: passa a ${to}.`,
    toReschedule: (from) => `${from}: ti diremo la nuova data.`,
    cancelled: (from) => `${from}: annullata, non si paga.`,
    questions: 'Se qualcosa non ti va bene, scrivici o chiamaci.',
  },
  'en-US': {
    subject: (shop) => `Changes to your plant care visits · ${shop}`,
    intro: (shop) => `${shop} can’t visit your plants on these days. Here are your visits now:`,
    place: (address) => `Place: ${address}.`,
    moved: (from, to) => `${from}: moved to ${to}.`,
    toReschedule: (from) => `${from}: we’ll let you know the new date.`,
    cancelled: (from) => `${from}: cancelled, not charged.`,
    questions: 'If something doesn’t work for you, write or call us.',
  },
};

function slotLabel(
  locale: SupportedLocale,
  when: { readonly date: string; readonly start: string | null; readonly end: string | null },
): string {
  const day = capitalize(dayLabel(locale, when.date));
  return when.start && when.end ? `${day}, ${when.start}–${when.end}` : day;
}

/** Email al cliente con le visite di un contratto spostate o cancellate da un blocco di giorni. */
export function careBlockNoticeEmail(input: CareBlockNoticeEmailInput): EmailMessage {
  const copy = BLOCK_NOTICE_COPY[input.locale];
  const shared = COPY[input.locale];
  const items = input.changes.map((change) => {
    const from = slotLabel(input.locale, change.from);
    if (change.outcome === 'MOVED' && change.to) {
      return copy.moved(
        from,
        slotLabel(input.locale, change.to).replace(/^./, (c) => c.toLowerCase()),
      );
    }
    return change.outcome === 'CANCELLED' ? copy.cancelled(from) : copy.toReschedule(from);
  });
  const contacts = [input.shop.contactPhone, input.shop.contactEmail].filter(
    (value): value is string => Boolean(value),
  );
  const lines = [
    shared.greeting(input.customerName),
    '',
    copy.intro(input.shop.name),
    ...(input.place ? [copy.place(input.place)] : []),
    '',
    ...items.map((item) => `- ${item}`),
    '',
    copy.questions,
    '',
    input.shop.name,
    ...contacts,
    '',
    '—',
    shared.reason(input.shop.name),
  ];
  const paragraph = (content: string) =>
    `<p style="margin:0 0 16px;line-height:1.6;color:#2f3b33">${content}</p>`;
  const html = `<!doctype html><html lang="${input.locale}"><body style="margin:0;padding:16px 12px;background:#f6f4ef;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px">
<tr><td style="padding:28px 24px">
<p style="margin:0 0 24px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#3f6b4f">${escapeHtml(input.shop.name)}</p>
${paragraph(escapeHtml(shared.greeting(input.customerName)))}
${paragraph(escapeHtml(copy.intro(input.shop.name)) + (input.place ? `<br>${escapeHtml(copy.place(input.place))}` : ''))}
<ul style="margin:0 0 16px;padding-left:20px;line-height:1.6;color:#2f3b33">${items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('')}</ul>
${paragraph(escapeHtml(copy.questions))}
<p style="margin:24px 0 0;line-height:1.6;color:#2f3b33"><strong>${escapeHtml(input.shop.name)}</strong>${
    contacts.length > 0 ? `<br>${escapeHtml(contacts.join(' · '))}` : ''
  }</p>
<hr style="margin:24px 0;border:none;border-top:1px solid #e6e2d8">
<p style="margin:0;font-size:12px;color:#8a918b">${escapeHtml(shared.reason(input.shop.name))}</p>
</td></tr></table></body></html>`;

  return {
    to: input.to,
    category: 'care_block_notice',
    subject: copy.subject(input.shop.name),
    text: lines.join('\n'),
    html,
    fromName: input.shop.name,
    ...(input.shop.contactEmail ? { replyTo: input.shop.contactEmail } : {}),
  };
}
