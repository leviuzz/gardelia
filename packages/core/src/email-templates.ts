/**
 * Template delle email transazionali (es-MX). Testo semplice + HTML minimale con stili inline.
 * Tutti i valori dinamici vengono sottoposti a escape HTML.
 */
import { BRAND, type MembershipRole } from '@floral/domain';
import type { EmailMessage } from './mailer';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function layout(
  title: string,
  paragraphs: readonly string[],
  action: { label: string; url: string },
  footer: string,
): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;color:#2f3b33">${p}</p>`)
    .join('');
  // Il margine sta nella cella (non nella tabella): sui telefoni la scheda non esce dallo schermo.
  return `<!doctype html><html lang="es-MX"><body style="margin:0;padding:16px 12px;background:#f6f4ef;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px">
<tr><td style="padding:28px 24px">
<p style="margin:0 0 24px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#3f6b4f">${escapeHtml(BRAND.productName)}</p>
<h1 style="margin:0 0 16px;font-size:22px;color:#1f2a22">${escapeHtml(title)}</h1>
${body}
<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#3f6b4f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#6b746d">Si el botón no funciona, copia este enlace en tu navegador:</p>
<p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${escapeHtml(action.url)}" style="color:#3f6b4f">${escapeHtml(action.url)}</a></p>
<p style="margin:0;font-size:12px;color:#8a918b">${escapeHtml(footer)}</p>
</td></tr></table></body></html>`;
}

export function verificationEmail(input: { to: string; name: string; url: string }): EmailMessage {
  const subject = `Confirma tu correo en ${BRAND.productName}`;
  return {
    to: input.to,
    category: 'email_verification',
    subject,
    text: [
      `Hola ${input.name}:`,
      '',
      `Gracias por crear tu cuenta en ${BRAND.productName}. Confirma tu correo con este enlace:`,
      input.url,
      '',
      'El enlace vence en 1 hora. Si no creaste esta cuenta, ignora este mensaje.',
    ].join('\n'),
    html: layout(
      'Confirma tu correo',
      [
        `Hola ${escapeHtml(input.name)}:`,
        `Gracias por crear tu cuenta en ${escapeHtml(BRAND.productName)}. Confirma tu correo para empezar.`,
      ],
      { label: 'Confirmar correo', url: input.url },
      'El enlace vence en 1 hora. Si no creaste esta cuenta, ignora este mensaje.',
    ),
  };
}

export function passwordResetEmail(input: { to: string; name: string; url: string }): EmailMessage {
  return {
    to: input.to,
    category: 'password_reset',
    subject: `Restablece tu contraseña de ${BRAND.productName}`,
    text: [
      `Hola ${input.name}:`,
      '',
      'Recibimos una solicitud para restablecer tu contraseña. Usa este enlace:',
      input.url,
      '',
      'El enlace vence en 1 hora. Si no fuiste tú, ignora este mensaje: tu contraseña no cambiará.',
    ].join('\n'),
    html: layout(
      'Restablece tu contraseña',
      [
        `Hola ${escapeHtml(input.name)}:`,
        'Recibimos una solicitud para restablecer tu contraseña.',
      ],
      { label: 'Elegir nueva contraseña', url: input.url },
      'El enlace vence en 1 hora. Si no fuiste tú, ignora este mensaje: tu contraseña no cambiará.',
    ),
  };
}

const ROLE_LABELS_ES: Record<MembershipRole, string> = {
  OWNER: 'Propietario/a',
  MANAGER: 'Gerente',
  STAFF: 'Equipo',
};

export function invitationEmail(input: {
  to: string;
  inviterName: string;
  tenantName: string;
  role: MembershipRole;
  url: string;
  expiresInDays: number;
}): EmailMessage {
  const role = ROLE_LABELS_ES[input.role];
  return {
    to: input.to,
    category: 'invitation',
    subject: `${input.inviterName} te invitó a ${input.tenantName} en ${BRAND.productName}`,
    text: [
      'Hola:',
      '',
      `${input.inviterName} te invitó a unirte a ${input.tenantName} en ${BRAND.productName} con el rol "${role}".`,
      'Acepta la invitación con este enlace:',
      input.url,
      '',
      `La invitación vence en ${input.expiresInDays} días y solo puede aceptarse con esta dirección de correo.`,
    ].join('\n'),
    html: layout(
      `Te invitaron a ${input.tenantName}`,
      [
        `${escapeHtml(input.inviterName)} te invitó a unirte a <strong>${escapeHtml(input.tenantName)}</strong> en ${escapeHtml(BRAND.productName)} con el rol <strong>${escapeHtml(role)}</strong>.`,
      ],
      { label: 'Aceptar invitación', url: input.url },
      `La invitación vence en ${input.expiresInDays} días y solo puede aceptarse con esta dirección de correo.`,
    ),
  };
}

// -----------------------------------------------------------------------------
// Ordini dalla tienda en línea (ADR-067). Nella lingua del mercato della fioreria (es-MX).
// -----------------------------------------------------------------------------

/** Dati comuni delle email di un ordine online, già formattati per chi legge. */
export interface OnlineOrderEmailFacts {
  readonly shopName: string;
  readonly numberLabel: string;
  readonly mode: 'DELIVERY' | 'PICKUP';
  /** Es. "martes 25 de noviembre, de 9:00 a 12:00". */
  readonly when: string;
  readonly totalLabel: string;
}

function modeLine(facts: OnlineOrderEmailFacts): string {
  return facts.mode === 'DELIVERY'
    ? `entrega a domicilio el ${facts.when}`
    : `recoger en la tienda el ${facts.when}`;
}

/** Testo semplice e HTML con lo stesso contenuto (i paragrafi sono testo, senza markup). */
function plainAndHtml(
  greeting: string,
  paragraphs: readonly string[],
  action: { label: string; url: string },
  footer: string,
  title: string,
): { text: string; html: string } {
  return {
    text: [
      greeting,
      '',
      ...paragraphs.flatMap((p) => [p, '']),
      `${action.label}: ${action.url}`,
      '',
      footer,
    ].join('\n'),
    html: layout(
      title,
      [escapeHtml(greeting), ...paragraphs.map((p) => escapeHtml(p).replaceAll('\n', '<br>'))],
      action,
      footer,
    ),
  };
}

/** A chi compra, appena manda l'ordine: lo riceve la fioreria, ancora da confermare. */
export function onlineOrderReceivedEmail(input: {
  to: string;
  name: string;
  facts: OnlineOrderEmailFacts;
  acceptDays: number;
  url: string;
  replyTo: string | null;
}): EmailMessage {
  const { facts } = input;
  const body = plainAndHtml(
    `Hola ${input.name}:`,
    [
      `${facts.shopName} recibió tu pedido ${facts.numberLabel}: ${modeLine(facts)}. Total: ${facts.totalLabel}.`,
      'La florería lo revisa y te escribimos en cuanto lo acepte, con las instrucciones para pagar. Todavía no pagues nada.',
      `Si la florería no responde en ${input.acceptDays} días, cancelamos el pedido y te avisamos.`,
    ],
    { label: 'Ver mi pedido', url: input.url },
    `Recibiste este correo porque hiciste un pedido en ${BRAND.productName}.`,
    'Recibimos tu pedido',
  );
  return {
    to: input.to,
    category: 'online_order_received',
    subject: `Recibimos tu pedido ${facts.numberLabel} para ${facts.shopName}`,
    fromName: facts.shopName,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...body,
  };
}

/** A propietari e gerenti della fioreria: un ordine online da accettare o rifiutare. */
export function newOnlineOrderEmail(input: {
  to: string;
  buyerName: string;
  itemCount: number;
  facts: OnlineOrderEmailFacts;
  acceptDays: number;
  url: string;
}): EmailMessage {
  const { facts } = input;
  const items = input.itemCount === 1 ? '1 producto' : `${input.itemCount} productos`;
  const body = plainAndHtml(
    'Hola:',
    [
      `${input.buyerName} hizo el pedido ${facts.numberLabel} desde tu tienda en línea: ${items}, ${modeLine(facts)}. Total: ${facts.totalLabel}.`,
      `Acéptalo o recházalo en ${BRAND.productName}. Si nadie responde en ${input.acceptDays} días, se cancela solo y le avisamos al cliente.`,
    ],
    { label: 'Revisar el pedido', url: input.url },
    `Recibes este correo porque eres propietario/a o gerente de ${facts.shopName}.`,
    'Nuevo pedido en línea',
  );
  return {
    to: input.to,
    category: 'online_order_new',
    subject: `Nuevo pedido en línea ${facts.numberLabel}`,
    ...body,
  };
}

/** A chi compra: la fioreria ha accettato, ecco come pagare (pagamento diretto, D-26). */
export function onlineOrderAcceptedEmail(input: {
  to: string;
  name: string;
  facts: OnlineOrderEmailFacts;
  /** Forme di pagamento già tradotte (es. "Transferencia, Efectivo"). */
  paymentMethods: readonly string[];
  paymentInstructions: string | null;
  url: string;
  replyTo: string | null;
}): EmailMessage {
  const { facts } = input;
  const payment =
    input.paymentMethods.length > 0
      ? `Cómo pagar: ${input.paymentMethods.join(', ')}.`
      : 'La florería te contactará para acordar el pago.';
  const body = plainAndHtml(
    `Hola ${input.name}:`,
    [
      `${facts.shopName} aceptó tu pedido ${facts.numberLabel}: ${modeLine(facts)}. Total: ${facts.totalLabel}.`,
      payment,
      ...(input.paymentInstructions ? [input.paymentInstructions] : []),
      `Le pagas directamente a la florería: ${BRAND.productName} no recibe tu dinero.`,
    ],
    { label: 'Ver mi pedido', url: input.url },
    `Recibiste este correo porque hiciste un pedido en ${BRAND.productName}.`,
    'Tu pedido fue aceptado',
  );
  return {
    to: input.to,
    category: 'online_order_accepted',
    subject: `${facts.shopName} aceptó tu pedido ${facts.numberLabel}`,
    fromName: facts.shopName,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...body,
  };
}

/**
 * A chi compra, quando l'ordine non si fa: rifiutato dalla fioreria, annullato dopo averlo
 * accettato, o scaduto senza risposta.
 */
export function onlineOrderCancelledEmail(input: {
  to: string;
  name: string;
  facts: OnlineOrderEmailFacts;
  kind: 'rejected' | 'cancelled' | 'expired';
  reason: string | null;
  url: string;
  searchUrl: string;
  replyTo: string | null;
}): EmailMessage {
  const { facts } = input;
  const reason = input.reason ? [`Motivo: ${input.reason}`] : [];
  const paragraphs =
    input.kind === 'rejected'
      ? [
          `${facts.shopName} no puede atender tu pedido ${facts.numberLabel} (${modeLine(facts)}).`,
          ...reason,
          'No tienes que pagar nada. Puedes buscar otra florería que entregue en tu zona.',
        ]
      : input.kind === 'expired'
        ? [
            `${facts.shopName} no confirmó a tiempo tu pedido ${facts.numberLabel} (${modeLine(facts)}), así que lo cancelamos.`,
            'No tienes que pagar nada. Puedes buscar otra florería que entregue en tu zona.',
          ]
        : [
            `${facts.shopName} canceló tu pedido ${facts.numberLabel} (${modeLine(facts)}).`,
            ...reason,
            'Si ya pagaste, ponte en contacto con la florería para la devolución.',
          ];
  const action =
    input.kind === 'cancelled'
      ? { label: 'Ver mi pedido', url: input.url }
      : { label: 'Buscar otra florería', url: input.searchUrl };
  const body = plainAndHtml(
    `Hola ${input.name}:`,
    paragraphs,
    action,
    `Recibiste este correo porque hiciste un pedido en ${BRAND.productName}.`,
    'Tu pedido no se realizará',
  );
  return {
    to: input.to,
    category: 'online_order_cancelled',
    subject:
      input.kind === 'rejected'
        ? `${facts.shopName} no puede atender tu pedido ${facts.numberLabel}`
        : `Tu pedido ${facts.numberLabel} fue cancelado`,
    fromName: facts.shopName,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...body,
  };
}
