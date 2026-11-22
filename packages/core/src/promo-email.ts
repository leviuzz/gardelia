/**
 * Email della promo delle date speciali (ADR-047): la fioreria scrive al suo cliente, nella lingua
 * del mercato della fioreria (ADR-042), con lo sconto, la data fino a cui vale, i contatti della
 * fioreria e il link per non ricevere più promozioni. Testo semplice + HTML minimale con stili
 * inline; tutti i valori dinamici passano dall'escape HTML.
 */
import {
  BRAND,
  formatDiscount,
  whatsappLink,
  type CalendarDate,
  type CurrencyCode,
  type Discount,
  type OccasionType,
  type SupportedLocale,
} from '@floral/domain';
import type { EmailMessage } from './mailer';

export interface PromoEmailOccasion {
  readonly type: OccasionType;
  readonly label: string | null;
  readonly personName: string | null;
  readonly date: CalendarDate;
}

export interface PromoEmailInput {
  readonly locale: SupportedLocale;
  readonly to: string;
  readonly customerName: string;
  readonly shop: {
    readonly name: string;
    readonly contactEmail: string | null;
    /** E.164: diventa il pulsante WhatsApp. */
    readonly contactPhone: string | null;
  };
  readonly currency: CurrencyCode;
  readonly discount: Discount;
  /** Le date del cliente di questo invio (di solito una), in ordine. */
  readonly occasions: readonly PromoEmailOccasion[];
  /** Pagina per non ricevere più promozioni. */
  readonly unsubscribeUrl: string;
  /** Indirizzo per la disiscrizione con un clic (RFC 8058), senza pagina. */
  readonly oneClickUnsubscribeUrl: string;
}

interface PromoCopy {
  readonly occasion: (occasion: PromoEmailOccasion) => string;
  readonly subjectOne: (discount: string, occasion: string) => string;
  readonly subjectMany: (discount: string) => string;
  readonly greeting: (name: string) => string;
  readonly introOne: (occasion: string, date: string) => string;
  readonly introMany: string;
  readonly listItem: (occasion: string, date: string) => string;
  readonly offer: (shop: string, discount: string) => string;
  readonly validity: (date: string) => string;
  readonly howTo: string;
  readonly whatsappButton: string;
  readonly whatsappText: (discount: string) => string;
  readonly reason: (shop: string) => string;
  readonly unsubscribe: string;
  readonly sentWith: (shop: string) => string;
}

function person(occasion: PromoEmailOccasion): string | null {
  return occasion.personName?.trim() || null;
}

const COPY: Readonly<Record<SupportedLocale, PromoCopy>> = {
  'es-MX': {
    occasion: (o) => {
      const who = person(o);
      if (o.type === 'BIRTHDAY') return who ? `el cumpleaños de ${who}` : 'tu cumpleaños';
      if (o.type === 'ANNIVERSARY') return who ? `el aniversario de ${who}` : 'tu aniversario';
      return o.label ?? 'tu fecha especial';
    },
    subjectOne: (discount, occasion) => `${discount} de descuento para ${occasion}`,
    subjectMany: (discount) => `${discount} de descuento para tus fechas especiales`,
    greeting: (name) => `Hola, ${name}:`,
    introOne: (occasion, date) => `Se acerca ${occasion}, el ${date}.`,
    introMany: 'Se acercan tus fechas especiales:',
    listItem: (occasion, date) => `${occasion}, el ${date}`,
    offer: (shop, discount) =>
      `Para celebrarlo, en ${shop} tienes ${discount} de descuento en tu próximo ramo.`,
    validity: (date) => `La promoción vale hasta el ${date}.`,
    howTo: 'Muéstranos este correo en la tienda o escríbenos para hacer tu pedido.',
    whatsappButton: 'Escribir por WhatsApp',
    whatsappText: (discount) =>
      `Hola, recibí su promoción de ${discount} de descuento y quiero pedir un ramo.`,
    reason: (shop) => `Recibes este correo porque aceptaste recibir promociones de ${shop}.`,
    unsubscribe: 'Ya no quiero recibir promociones',
    sentWith: (shop) => `Enviado por ${shop} con ${BRAND.productName}.`,
  },
  'it-IT': {
    occasion: (o) => {
      const who = person(o);
      if (o.type === 'BIRTHDAY') return who ? `il compleanno di ${who}` : 'il tuo compleanno';
      if (o.type === 'ANNIVERSARY') return who ? `l'anniversario di ${who}` : 'il tuo anniversario';
      return o.label ?? 'la tua data speciale';
    },
    subjectOne: (discount, occasion) => `${discount} di sconto per ${occasion}`,
    subjectMany: (discount) => `${discount} di sconto per le tue date speciali`,
    greeting: (name) => `Ciao ${name},`,
    introOne: (occasion, date) => `Si avvicina ${occasion}, il ${date}.`,
    introMany: 'Si avvicinano le tue date speciali:',
    listItem: (occasion, date) => `${occasion}, il ${date}`,
    offer: (shop, discount) =>
      `Per festeggiare, da ${shop} hai ${discount} di sconto sul tuo prossimo mazzo di fiori.`,
    validity: (date) => `La promozione vale fino al ${date}.`,
    howTo: 'Mostraci questa email in negozio o scrivici per ordinare.',
    whatsappButton: 'Scrivici su WhatsApp',
    whatsappText: (discount) =>
      `Ciao, ho ricevuto la vostra promozione con ${discount} di sconto e vorrei ordinare un mazzo.`,
    reason: (shop) => `Ricevi questa email perché hai accettato di ricevere promozioni da ${shop}.`,
    unsubscribe: 'Non voglio più ricevere promozioni',
    sentWith: (shop) => `Inviata da ${shop} con ${BRAND.productName}.`,
  },
  'en-US': {
    occasion: (o) => {
      const who = person(o);
      if (o.type === 'BIRTHDAY') return who ? `${who}'s birthday` : 'your birthday';
      if (o.type === 'ANNIVERSARY') return who ? `${who}'s anniversary` : 'your anniversary';
      return o.label ?? 'your special date';
    },
    subjectOne: (discount, occasion) => `${discount} off for ${occasion}`,
    subjectMany: (discount) => `${discount} off for your special dates`,
    greeting: (name) => `Hi ${name},`,
    introOne: (occasion, date) => `It's almost ${occasion} (${date}).`,
    introMany: 'Your special dates are coming up:',
    listItem: (occasion, date) => `${occasion}, ${date}`,
    offer: (shop, discount) =>
      `To celebrate, ${shop} is giving you ${discount} off your next bouquet.`,
    validity: (date) => `The offer is valid until ${date}.`,
    howTo: 'Show us this email in store or message us to place your order.',
    whatsappButton: 'Message us on WhatsApp',
    whatsappText: (discount) =>
      `Hi, I got your ${discount} off offer and I'd like to order a bouquet.`,
    reason: (shop) =>
      `You're receiving this email because you agreed to get promotions from ${shop}.`,
    unsubscribe: "I don't want to receive promotions anymore",
    sentWith: (shop) => `Sent by ${shop} with ${BRAND.productName}.`,
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** "14 de diciembre", "14 dicembre", "December 14" (giorno di calendario, senza fuso). */
function dayAndMonth(date: CalendarDate, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(date.year, date.month - 1, date.day, 12)),
  );
}

/** Prima lettera maiuscola (frasi che iniziano con "tu cumpleaños", "your birthday"…). */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function occasionPromoEmail(input: PromoEmailInput): EmailMessage {
  const copy = COPY[input.locale];
  const discount = formatDiscount(input.discount, input.currency, input.locale);
  const occasions = input.occasions.map((occasion) => ({
    name: copy.occasion(occasion),
    date: dayAndMonth(occasion.date, input.locale),
  }));
  const [first] = occasions;
  if (!first) throw new TypeError('occasionPromoEmail: almeno una data');
  const single = occasions.length === 1;
  const lastDate = occasions[occasions.length - 1]?.date ?? first.date;
  const subject = capitalize(
    single ? copy.subjectOne(discount, first.name) : copy.subjectMany(discount),
  );
  const whatsapp = input.shop.contactPhone
    ? whatsappLink(input.shop.contactPhone, copy.whatsappText(discount))
    : null;
  const contacts = [input.shop.contactPhone, input.shop.contactEmail].filter(
    (value): value is string => Boolean(value),
  );

  const text = [
    copy.greeting(input.customerName),
    '',
    ...(single
      ? [copy.introOne(first.name, first.date)]
      : [copy.introMany, ...occasions.map((o) => `- ${copy.listItem(o.name, o.date)}`)]),
    copy.offer(input.shop.name, discount),
    '',
    `${copy.validity(lastDate)} ${copy.howTo}`,
    ...(whatsapp ? ['', `${copy.whatsappButton}: ${whatsapp}`] : []),
    '',
    input.shop.name,
    ...(contacts.length > 0 ? [contacts.join(' · ')] : []),
    '',
    '—',
    copy.reason(input.shop.name),
    `${copy.unsubscribe}: ${input.unsubscribeUrl}`,
  ].join('\n');

  const paragraph = (content: string, style = 'margin:0 0 16px;line-height:1.6;color:#2f3b33') =>
    `<p style="${style}">${content}</p>`;
  const intro = single
    ? paragraph(escapeHtml(capitalize(copy.introOne(first.name, first.date))))
    : paragraph(escapeHtml(copy.introMany), 'margin:0 0 8px;line-height:1.6;color:#2f3b33') +
      `<ul style="margin:0 0 16px;padding-left:20px;color:#2f3b33;line-height:1.6">${occasions
        .map((o) => `<li>${escapeHtml(copy.listItem(o.name, o.date))}</li>`)
        .join('')}</ul>`;
  // Il margine sta nella cella (non nella tabella): sui telefoni la scheda non esce dallo schermo.
  const html = `<!doctype html><html lang="${input.locale}"><body style="margin:0;padding:16px 12px;background:#f6f4ef;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px">
<tr><td style="padding:28px 24px">
<p style="margin:0 0 24px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#3f6b4f">${escapeHtml(input.shop.name)}</p>
${paragraph(escapeHtml(copy.greeting(input.customerName)))}
${intro}
<p style="margin:0 0 16px;font-size:28px;font-weight:700;color:#1f2a22">${escapeHtml(discount)}</p>
${paragraph(escapeHtml(copy.offer(input.shop.name, discount)))}
${paragraph(escapeHtml(`${copy.validity(lastDate)} ${copy.howTo}`))}
${
  whatsapp
    ? `<p style="margin:24px 0"><a href="${escapeHtml(whatsapp)}" style="display:inline-block;background:#3f6b4f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${escapeHtml(copy.whatsappButton)}</a></p>`
    : ''
}
<p style="margin:24px 0 0;line-height:1.6;color:#2f3b33"><strong>${escapeHtml(input.shop.name)}</strong>${
    contacts.length > 0 ? `<br>${escapeHtml(contacts.join(' · '))}` : ''
  }</p>
<hr style="margin:24px 0;border:none;border-top:1px solid #e6e2d8">
<p style="margin:0 0 8px;font-size:12px;color:#8a918b">${escapeHtml(copy.reason(input.shop.name))} <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#3f6b4f">${escapeHtml(copy.unsubscribe)}</a></p>
<p style="margin:0;font-size:12px;color:#8a918b">${escapeHtml(copy.sentWith(input.shop.name))}</p>
</td></tr></table></body></html>`;

  return {
    to: input.to,
    category: 'occasion_promo',
    subject,
    text,
    html,
    fromName: input.shop.name,
    ...(input.shop.contactEmail ? { replyTo: input.shop.contactEmail } : {}),
    headers: {
      'List-Unsubscribe': `<${input.oneClickUnsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
