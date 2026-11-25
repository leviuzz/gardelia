/**
 * Email di Floral Care al cliente della fioreria. Il resoconto di una visita (ADR-078) e l'avviso
 * delle visite spostate o cancellate da un blocco di giorni (ADR-083), l'invito alla pagina del
 * cliente e, alla fioreria, il cambio di data fatto dal cliente (ADR-084).
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

// -----------------------------------------------------------------------------
// Pagina del cliente (blocco 5a, ADR-084)
// -----------------------------------------------------------------------------

export interface CarePortalInviteEmailInput {
  readonly locale: SupportedLocale;
  readonly to: string;
  readonly customerName: string;
  readonly shop: {
    readonly name: string;
    readonly contactEmail: string | null;
    readonly contactPhone: string | null;
  };
  readonly url: string;
  readonly expiresInDays: number;
}

interface PortalInviteCopy {
  readonly subject: (shop: string) => string;
  readonly greeting: string;
  readonly intro: (shop: string, customer: string) => string;
  readonly button: string;
  readonly account: (days: number) => string;
  readonly reason: (shop: string) => string;
}

const PORTAL_INVITE_COPY: Readonly<Record<SupportedLocale, PortalInviteCopy>> = {
  'es-MX': {
    subject: (shop) => `${shop} te invita a ver el cuidado de tus plantas`,
    greeting: 'Hola:',
    intro: (shop, customer) =>
      `${shop} te invita a Mi Floral Care, donde verás el servicio de ${customer}: las próximas visitas, los reportes con fotos y las indicaciones para tus plantas.`,
    button: 'Aceptar la invitación',
    account: (days) =>
      `Entra o crea tu cuenta con este mismo correo. La invitación vence en ${days} días.`,
    reason: (shop) => `Recibes este correo porque ${shop} te invitó a ver su servicio.`,
  },
  'it-IT': {
    subject: (shop) => `${shop} ti invita a vedere la cura delle tue piante`,
    greeting: 'Ciao,',
    intro: (shop, customer) =>
      `${shop} ti invita a Mi Floral Care, dove vedrai il servizio di ${customer}: le prossime visite, i resoconti con le foto e le indicazioni per le tue piante.`,
    button: 'Accetta l’invito',
    account: (days) =>
      `Entra o crea il tuo account con questa stessa email. L’invito scade fra ${days} giorni.`,
    reason: (shop) => `Ricevi questa email perché ${shop} ti ha invitato a vedere il suo servizio.`,
  },
  'en-US': {
    subject: (shop) => `${shop} invites you to follow your plant care`,
    greeting: 'Hi,',
    intro: (shop, customer) =>
      `${shop} invites you to Mi Floral Care, where you’ll see the service for ${customer}: upcoming visits, reports with photos and care tips for your plants.`,
    button: 'Accept the invitation',
    account: (days) =>
      `Sign in or create your account with this same email. The invitation expires in ${days} days.`,
    reason: (shop) => `You’re receiving this email because ${shop} invited you to see its service.`,
  },
};

/** L'invito di una persona alla pagina del cliente, nella lingua del mercato della fioreria. */
export function carePortalInviteEmail(input: CarePortalInviteEmailInput): EmailMessage {
  const copy = PORTAL_INVITE_COPY[input.locale];
  const contacts = [input.shop.contactPhone, input.shop.contactEmail].filter(
    (value): value is string => Boolean(value),
  );
  const intro = copy.intro(input.shop.name, input.customerName);
  const account = copy.account(input.expiresInDays);
  const lines = [
    copy.greeting,
    '',
    intro,
    '',
    `${copy.button}: ${input.url}`,
    '',
    account,
    '',
    input.shop.name,
    ...contacts,
    '',
    '—',
    copy.reason(input.shop.name),
  ];
  const paragraph = (content: string) =>
    `<p style="margin:0 0 16px;line-height:1.6;color:#2f3b33">${content}</p>`;
  const html = `<!doctype html><html lang="${input.locale}"><body style="margin:0;padding:16px 12px;background:#f6f4ef;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px">
<tr><td style="padding:28px 24px">
<p style="margin:0 0 24px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#3f6b4f">${escapeHtml(input.shop.name)}</p>
${paragraph(escapeHtml(copy.greeting))}
${paragraph(escapeHtml(intro))}
<p style="margin:24px 0 16px"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#3f6b4f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${escapeHtml(copy.button)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#5f6b62">${escapeHtml(account)}</p>
<p style="margin:24px 0 0;line-height:1.6;color:#2f3b33"><strong>${escapeHtml(input.shop.name)}</strong>${
    contacts.length > 0 ? `<br>${escapeHtml(contacts.join(' · '))}` : ''
  }</p>
<hr style="margin:24px 0;border:none;border-top:1px solid #e6e2d8">
<p style="margin:0;font-size:12px;color:#8a918b">${escapeHtml(copy.reason(input.shop.name))}</p>
</td></tr></table></body></html>`;

  return {
    to: input.to,
    category: 'care_portal_invite',
    subject: copy.subject(input.shop.name),
    text: lines.join('\n'),
    html,
    fromName: input.shop.name,
    ...(input.shop.contactEmail ? { replyTo: input.shop.contactEmail } : {}),
  };
}

export interface CareVisitMovedByCustomerEmailInput {
  readonly locale: SupportedLocale;
  readonly to: string;
  readonly shopName: string;
  readonly customerName: string;
  readonly numberLabel: string;
  readonly from: {
    readonly date: string;
    readonly start: string | null;
    readonly end: string | null;
  };
  readonly to_: { readonly date: string; readonly start: string; readonly end: string };
  /** La pagina della visita nell'Agenda. */
  readonly url: string;
}

interface MovedByCustomerCopy {
  readonly subject: (customer: string, number: string) => string;
  readonly body: (customer: string, from: string, to: string) => string;
  readonly button: string;
  readonly reason: (shop: string) => string;
}

const MOVED_BY_CUSTOMER_COPY: Readonly<Record<SupportedLocale, MovedByCustomerCopy>> = {
  'es-MX': {
    subject: (customer, number) => `${customer} cambió la fecha de una visita · ${number}`,
    body: (customer, from, to) =>
      `${customer} cambió la fecha de su visita desde Mi Floral Care: ${from} → ${to}.`,
    button: 'Ver la visita',
    reason: (shop) => `Recibes este correo porque administras Floral Care en ${shop}.`,
  },
  'it-IT': {
    subject: (customer, number) => `${customer} ha cambiato la data di una visita · ${number}`,
    body: (customer, from, to) =>
      `${customer} ha cambiato la data della sua visita da Mi Floral Care: ${from} → ${to}.`,
    button: 'Vedi la visita',
    reason: (shop) => `Ricevi questa email perché gestisci Floral Care in ${shop}.`,
  },
  'en-US': {
    subject: (customer, number) => `${customer} changed the date of a visit · ${number}`,
    body: (customer, from, to) =>
      `${customer} changed the date of their visit from Mi Floral Care: ${from} → ${to}.`,
    button: 'See the visit',
    reason: (shop) => `You’re receiving this email because you manage Floral Care at ${shop}.`,
  },
};

/** Alla fioreria (proprietari e gerenti): il cliente ha cambiato la data di una visita. */
export function careVisitMovedByCustomerEmail(
  input: CareVisitMovedByCustomerEmailInput,
): EmailMessage {
  const copy = MOVED_BY_CUSTOMER_COPY[input.locale];
  const body = copy.body(
    input.customerName,
    slotLabel(input.locale, input.from),
    slotLabel(input.locale, input.to_).replace(/^./, (c) => c.toLowerCase()),
  );
  const lines = [body, '', `${copy.button}: ${input.url}`, '', '—', copy.reason(input.shopName)];
  const html = `<!doctype html><html lang="${input.locale}"><body style="margin:0;padding:16px 12px;background:#f6f4ef;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px">
<tr><td style="padding:28px 24px">
<p style="margin:0 0 24px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#3f6b4f">${escapeHtml(input.shopName)} · ${escapeHtml(input.numberLabel)}</p>
<p style="margin:0 0 16px;line-height:1.6;color:#2f3b33">${escapeHtml(body)}</p>
<p style="margin:24px 0 16px"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#3f6b4f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${escapeHtml(copy.button)}</a></p>
<hr style="margin:24px 0;border:none;border-top:1px solid #e6e2d8">
<p style="margin:0;font-size:12px;color:#8a918b">${escapeHtml(copy.reason(input.shopName))}</p>
</td></tr></table></body></html>`;
  return {
    to: input.to,
    category: 'care_visit_moved_by_customer',
    subject: copy.subject(input.customerName, input.numberLabel),
    text: lines.join('\n'),
    html,
  };
}

// -----------------------------------------------------------------------------
// Messaggi (blocco 5b, ADR-084)
// -----------------------------------------------------------------------------

export interface CareMessageNoticeEmailInput {
  readonly locale: SupportedLocale;
  readonly to: string;
  readonly shop: {
    readonly name: string;
    readonly contactEmail: string | null;
    readonly contactPhone: string | null;
  };
  /** La sede del contratto (etichetta o indirizzo), se c'è. */
  readonly place: string | null;
  /** La pagina del contratto in Mi Floral Care. */
  readonly url: string;
}

interface MessageNoticeCopy {
  readonly subject: (shop: string) => string;
  readonly greeting: string;
  readonly body: (shop: string, place: string | null) => string;
  readonly button: string;
  readonly reason: (shop: string) => string;
}

const MESSAGE_NOTICE_COPY: Readonly<Record<SupportedLocale, MessageNoticeCopy>> = {
  'es-MX': {
    subject: (shop) => `${shop} te escribió`,
    greeting: 'Hola:',
    body: (shop, place) =>
      `${shop} te escribió sobre el cuidado de tus plantas${place ? ` en ${place}` : ''}. Entra a Mi Floral Care para leer el mensaje y responder.`,
    button: 'Leer el mensaje',
    reason: (shop) =>
      `Recibes este correo porque tienes acceso a Mi Floral Care de ${shop}. Te avisamos como máximo una vez al día.`,
  },
  'it-IT': {
    subject: (shop) => `${shop} ti ha scritto`,
    greeting: 'Ciao,',
    body: (shop, place) =>
      `${shop} ti ha scritto sulla cura delle tue piante${place ? ` in ${place}` : ''}. Entra in Mi Floral Care per leggere il messaggio e rispondere.`,
    button: 'Leggi il messaggio',
    reason: (shop) =>
      `Ricevi questa email perché hai accesso a Mi Floral Care di ${shop}. Ti avvisiamo al massimo una volta al giorno.`,
  },
  'en-US': {
    subject: (shop) => `${shop} sent you a message`,
    greeting: 'Hi,',
    body: (shop, place) =>
      `${shop} wrote to you about your plant care${place ? ` at ${place}` : ''}. Open Mi Floral Care to read the message and reply.`,
    button: 'Read the message',
    reason: (shop) =>
      `You’re receiving this email because you have access to Mi Floral Care from ${shop}. We notify you at most once a day.`,
  },
};

/**
 * Al cliente (alle persone con accesso): la fioreria ha scritto. Mai il testo del messaggio, che
 * si legge solo entrando; al massimo una al giorno per contratto (decisione del founder).
 */
export function careMessageNoticeEmail(input: CareMessageNoticeEmailInput): EmailMessage {
  const copy = MESSAGE_NOTICE_COPY[input.locale];
  const contacts = [input.shop.contactPhone, input.shop.contactEmail].filter(
    (value): value is string => Boolean(value),
  );
  const body = copy.body(input.shop.name, input.place);
  const lines = [
    copy.greeting,
    '',
    body,
    '',
    `${copy.button}: ${input.url}`,
    '',
    input.shop.name,
    ...contacts,
    '',
    '—',
    copy.reason(input.shop.name),
  ];
  const html = `<!doctype html><html lang="${input.locale}"><body style="margin:0;padding:16px 12px;background:#f6f4ef;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px">
<tr><td style="padding:28px 24px">
<p style="margin:0 0 24px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#3f6b4f">${escapeHtml(input.shop.name)}</p>
<p style="margin:0 0 16px;line-height:1.6;color:#2f3b33">${escapeHtml(copy.greeting)}</p>
<p style="margin:0 0 16px;line-height:1.6;color:#2f3b33">${escapeHtml(body)}</p>
<p style="margin:24px 0 16px"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#3f6b4f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${escapeHtml(copy.button)}</a></p>
<p style="margin:24px 0 0;line-height:1.6;color:#2f3b33"><strong>${escapeHtml(input.shop.name)}</strong>${
    contacts.length > 0 ? `<br>${escapeHtml(contacts.join(' · '))}` : ''
  }</p>
<hr style="margin:24px 0;border:none;border-top:1px solid #e6e2d8">
<p style="margin:0;font-size:12px;color:#8a918b">${escapeHtml(copy.reason(input.shop.name))}</p>
</td></tr></table></body></html>`;
  return {
    to: input.to,
    category: 'care_message_notice',
    subject: copy.subject(input.shop.name),
    text: lines.join('\n'),
    html,
    fromName: input.shop.name,
    ...(input.shop.contactEmail ? { replyTo: input.shop.contactEmail } : {}),
  };
}

export interface CareMessageDigestEmailInput {
  readonly locale: SupportedLocale;
  readonly to: string;
  readonly shopName: string;
  /** Messaggi dei clienti non letti e contratti con almeno uno. */
  readonly unread: number;
  readonly threads: number;
  /** La pagina «Mensajes» del gestionale. */
  readonly url: string;
}

interface MessageDigestCopy {
  readonly subject: (unread: number) => string;
  readonly body: (unread: number, threads: number) => string;
  readonly button: string;
  readonly reason: (shop: string) => string;
}

const MESSAGE_DIGEST_COPY: Readonly<Record<SupportedLocale, MessageDigestCopy>> = {
  'es-MX': {
    subject: (unread) =>
      unread === 1 ? 'Floral Care: 1 mensaje sin leer' : `Floral Care: ${unread} mensajes sin leer`,
    body: (unread, threads) =>
      `Tienes ${unread === 1 ? '1 mensaje' : `${unread} mensajes`} de clientes sin leer en ${
        threads === 1 ? '1 contrato' : `${threads} contratos`
      }.`,
    button: 'Ver mensajes',
    reason: (shop) =>
      `Recibes este resumen una vez al día porque administras Floral Care en ${shop}.`,
  },
  'it-IT': {
    subject: (unread) =>
      unread === 1
        ? 'Floral Care: 1 messaggio da leggere'
        : `Floral Care: ${unread} messaggi da leggere`,
    body: (unread, threads) =>
      `Hai ${unread === 1 ? '1 messaggio' : `${unread} messaggi`} dei clienti da leggere in ${
        threads === 1 ? '1 contratto' : `${threads} contratti`
      }.`,
    button: 'Vedi i messaggi',
    reason: (shop) =>
      `Ricevi questo riassunto una volta al giorno perché gestisci Floral Care in ${shop}.`,
  },
  'en-US': {
    subject: (unread) =>
      unread === 1 ? 'Floral Care: 1 unread message' : `Floral Care: ${unread} unread messages`,
    body: (unread, threads) =>
      `You have ${unread === 1 ? '1 unread message' : `${unread} unread messages`} from customers on ${
        threads === 1 ? '1 contract' : `${threads} contracts`
      }.`,
    button: 'See messages',
    reason: (shop) =>
      `You’re receiving this summary once a day because you manage Floral Care at ${shop}.`,
  },
};

/** Alla fioreria (proprietari e gerenti): il riassunto del giorno, solo conteggi e il link. */
export function careMessageDigestEmail(input: CareMessageDigestEmailInput): EmailMessage {
  const copy = MESSAGE_DIGEST_COPY[input.locale];
  const body = copy.body(input.unread, input.threads);
  const lines = [body, '', `${copy.button}: ${input.url}`, '', '—', copy.reason(input.shopName)];
  const html = `<!doctype html><html lang="${input.locale}"><body style="margin:0;padding:16px 12px;background:#f6f4ef;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px">
<tr><td style="padding:28px 24px">
<p style="margin:0 0 24px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#3f6b4f">${escapeHtml(input.shopName)} · Floral Care</p>
<p style="margin:0 0 16px;line-height:1.6;color:#2f3b33">${escapeHtml(body)}</p>
<p style="margin:24px 0 16px"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#3f6b4f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${escapeHtml(copy.button)}</a></p>
<hr style="margin:24px 0;border:none;border-top:1px solid #e6e2d8">
<p style="margin:0;font-size:12px;color:#8a918b">${escapeHtml(copy.reason(input.shopName))}</p>
</td></tr></table></body></html>`;
  return {
    to: input.to,
    category: 'care_message_digest',
    subject: copy.subject(input.unread),
    text: lines.join('\n'),
    html,
  };
}
