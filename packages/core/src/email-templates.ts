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

/**
 * Ai titolari della fioreria quando qualcuno ne programma l'eliminazione (ADR-074): data della
 * cancellazione definitiva e come recuperarla. Se non è stato lui, se ne accorge subito.
 */
export function tenantDeletionScheduledEmail(input: {
  to: string;
  name: string;
  tenantName: string;
  /** Data già scritta per chi legge, es. "24 de diciembre de 2026". */
  deleteOn: string;
  url: string;
}): EmailMessage {
  const footer =
    'Si no fuiste tú, recupera la florería con el botón y cambia tu contraseña. Para cualquier duda escríbenos a soporte@gardelia.co.';
  return {
    to: input.to,
    category: 'tenant_deletion_scheduled',
    subject: `${input.tenantName} se eliminará el ${input.deleteOn}`,
    text: [
      `Hola ${input.name}:`,
      '',
      `Se programó la eliminación de ${input.tenantName} en ${BRAND.productName}. Ya nadie la ve: ni tu equipo, ni tus clientes, ni tu tienda en línea.`,
      `El ${input.deleteOn} se borrará definitivamente con todos sus datos: clientes, pedidos, catálogo, inventario y fotos.`,
      '',
      'Hasta ese día puedes recuperarla desde aquí:',
      input.url,
      '',
      footer,
    ].join('\n'),
    html: layout(
      `${input.tenantName} se eliminará el ${input.deleteOn}`,
      [
        `Hola ${escapeHtml(input.name)}:`,
        `Se programó la eliminación de <strong>${escapeHtml(input.tenantName)}</strong> en ${escapeHtml(BRAND.productName)}. Ya nadie la ve: ni tu equipo, ni tus clientes, ni tu tienda en línea.`,
        `El <strong>${escapeHtml(input.deleteOn)}</strong> se borrará definitivamente con todos sus datos: clientes, pedidos, catálogo, inventario y fotos. Hasta ese día puedes recuperarla.`,
      ],
      { label: 'Recuperar la florería', url: input.url },
      footer,
    ),
  };
}

/** Conferma della cancellazione del conto cliente (ADR-068): niente si cancella senza il clic. */
export function deleteAccountEmail(input: { to: string; name: string; url: string }): EmailMessage {
  const footer =
    'El enlace vence en 24 horas. Si no pediste eliminar tu cuenta, ignora este mensaje: tu cuenta sigue igual.';
  return {
    to: input.to,
    category: 'account_deletion',
    subject: `Confirma que quieres eliminar tu cuenta de ${BRAND.productName}`,
    text: [
      `Hola ${input.name}:`,
      '',
      `Recibimos tu solicitud para eliminar tu cuenta de ${BRAND.productName}. Para confirmarla, abre este enlace:`,
      input.url,
      '',
      'Se borrarán tu nombre, tu correo, tu teléfono y tus direcciones guardadas. Los pedidos que hiciste siguen en las florerías que los atendieron.',
      '',
      footer,
    ].join('\n'),
    html: layout(
      'Confirma que quieres eliminar tu cuenta',
      [
        `Hola ${escapeHtml(input.name)}:`,
        `Recibimos tu solicitud para eliminar tu cuenta de ${escapeHtml(BRAND.productName)}.`,
        'Se borrarán tu nombre, tu correo, tu teléfono y tus direcciones guardadas. Los pedidos que hiciste siguen en las florerías que los atendieron.',
      ],
      { label: 'Eliminar mi cuenta', url: input.url },
      footer,
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
  facts: OnlineOrderEmailFacts;
  /** Le righe già scritte, es. "2 × Ramo Clásico 12 rosas". */
  lines: readonly string[];
  /** Colonia e città della consegna (mai l'indirizzo intero), o null per il ritiro. */
  zone: string | null;
  recipientName: string | null;
  buyerNotes: string | null;
  /** Fino a quando si può accettare, già scritto (es. "jueves 28 de noviembre, 20:15"). */
  deadlineLabel: string;
  url: string;
}): EmailMessage {
  const { facts } = input;
  const details = [
    `${input.buyerName} hizo el pedido ${facts.numberLabel} desde tu tienda en línea: ${modeLine(facts)}.`,
    input.lines.map((line) => `• ${line}`).join('\n'),
    ...(input.zone ? [`Entrega en ${input.zone}.`] : []),
    ...(input.recipientName ? [`Recibe: ${input.recipientName}.`] : []),
    ...(input.buyerNotes ? [`Comentarios del cliente: «${input.buyerNotes}»`] : []),
    `Total: ${facts.totalLabel}.`,
    `Acéptalo o recházalo antes del ${input.deadlineLabel}: si nadie responde, se cancela solo y le avisamos al cliente.`,
  ];
  const body = plainAndHtml(
    'Hola:',
    details,
    { label: 'Ver y aceptar', url: input.url },
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
  kind: 'rejected' | 'cancelled' | 'expired' | 'withdrawn';
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
        : input.kind === 'withdrawn'
          ? [
              `Cancelaste tu pedido ${facts.numberLabel} en ${facts.shopName} (${modeLine(facts)}).`,
              'No tienes que pagar nada. Ya le avisamos a la florería.',
            ]
          : [
              `${facts.shopName} canceló tu pedido ${facts.numberLabel} (${modeLine(facts)}).`,
              ...reason,
              'Si ya pagaste, ponte en contacto con la florería para la devolución.',
            ];
  const action =
    input.kind === 'cancelled' || input.kind === 'withdrawn'
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
        : input.kind === 'withdrawn'
          ? `Cancelaste tu pedido ${facts.numberLabel}`
          : `Tu pedido ${facts.numberLabel} fue cancelado`,
    fromName: facts.shopName,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...body,
  };
}

/**
 * Al cliente di un ordine del banco (ADR-072), quando la fioreria lo conferma e ha spuntato
 * "Enviar la confirmación": riepilogo e link per seguire l'ordine. Il pagamento si accorda con la
 * fioreria (alla conferma non c'è ancora nessun pagamento registrato), quindi qui c'è solo il totale.
 */
export function counterOrderConfirmedEmail(input: {
  to: string;
  name: string;
  facts: OnlineOrderEmailFacts;
  url: string;
  replyTo: string | null;
}): EmailMessage {
  const { facts } = input;
  const body = plainAndHtml(
    `Hola ${input.name}:`,
    [
      `${facts.shopName} confirmó tu pedido ${facts.numberLabel}: ${modeLine(facts)}. Total: ${facts.totalLabel}.`,
      'Con el enlace puedes ver tu pedido y en qué paso va.',
      input.replyTo
        ? 'Si algo no está bien, responde a este correo y le llega a la florería.'
        : 'Si algo no está bien, ponte en contacto con la florería.',
    ],
    { label: 'Ver mi pedido', url: input.url },
    `Recibiste este correo porque hiciste un pedido en ${facts.shopName}.`,
    'Tu pedido está confirmado',
  );
  return {
    to: input.to,
    category: 'counter_order_confirmed',
    subject: `${facts.shopName} confirmó tu pedido ${facts.numberLabel}`,
    fromName: facts.shopName,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...body,
  };
}

/** A propietari e gerenti: chi compra ha annullato un ordine online prima che lo accettassero. */
export function onlineOrderWithdrawnEmail(input: {
  to: string;
  buyerName: string;
  facts: OnlineOrderEmailFacts;
  url: string;
}): EmailMessage {
  const { facts } = input;
  const body = plainAndHtml(
    'Hola:',
    [
      `${input.buyerName} canceló el pedido ${facts.numberLabel} (${modeLine(facts)}) antes de que lo aceptaras.`,
      'No tienes que hacer nada: el pedido queda cancelado.',
    ],
    { label: 'Ver el pedido', url: input.url },
    `Recibes este correo porque eres propietario/a o gerente de ${facts.shopName}.`,
    'Pedido cancelado por el cliente',
  );
  return {
    to: input.to,
    category: 'online_order_withdrawn',
    subject: `${input.buyerName} canceló el pedido ${facts.numberLabel}`,
    ...body,
  };
}

// -----------------------------------------------------------------------------
// Marketplace M3 (ADR-088): avvisi dei passi e dei cambi a chi compra, messaggi, promemoria
// -----------------------------------------------------------------------------

/** I passi dell'ordine che avvisano chi compra (`orderStepNotice` nel dominio). */
export type OnlineOrderStep = 'preparing' | 'ready_pickup' | 'on_the_way' | 'delivered';

const STEP_TEXTS: Readonly<
  Record<
    OnlineOrderStep,
    { title: string; subject: (n: string) => string; body: (shop: string, n: string) => string }
  >
> = {
  preparing: {
    title: 'Estamos preparando tu pedido',
    subject: (n) => `Estamos preparando tu pedido ${n}`,
    body: (shop, n) => `${shop} ya está preparando tu pedido ${n}.`,
  },
  ready_pickup: {
    title: 'Tu pedido está listo para recoger',
    subject: (n) => `Tu pedido ${n} está listo para recoger`,
    body: (shop, n) => `Tu pedido ${n} de ${shop} ya está listo para recoger.`,
  },
  on_the_way: {
    title: 'Tu pedido va en camino',
    subject: (n) => `Tu pedido ${n} va en camino`,
    body: (shop, n) => `${shop} salió a entregar tu pedido ${n}.`,
  },
  delivered: {
    title: 'Entregamos tu pedido',
    subject: (n) => `Entregamos tu pedido ${n}`,
    body: (shop, n) => `${shop} entregó tu pedido ${n}.`,
  },
};

/** A chi compra, a un passo dell'ordine: in preparazione, pronto per il ritiro, in consegna, consegnato. */
export function onlineOrderStepEmail(input: {
  to: string;
  name: string;
  facts: OnlineOrderEmailFacts;
  step: OnlineOrderStep;
  /** Per il ritiro: dove e quando (già scritti). */
  pickupAddress: string | null;
  url: string;
  replyTo: string | null;
}): EmailMessage {
  const { facts } = input;
  const texts = STEP_TEXTS[input.step];
  const paragraphs = [
    texts.body(facts.shopName, facts.numberLabel),
    ...(input.step === 'ready_pickup'
      ? [
          `Puedes recogerlo el ${facts.when}.`,
          ...(input.pickupAddress ? [`Dirección: ${input.pickupAddress}`] : []),
        ]
      : []),
    ...(input.step === 'delivered'
      ? [
          'En tu pedido puedes ver la foto de la entrega y quién lo recibió, cuando la florería los registre.',
        ]
      : []),
  ];
  const body = plainAndHtml(
    `Hola ${input.name}:`,
    paragraphs,
    { label: 'Ver mi pedido', url: input.url },
    `Recibiste este correo porque hiciste un pedido en ${BRAND.productName}.`,
    texts.title,
  );
  return {
    to: input.to,
    category: 'online_order_step',
    subject: texts.subject(facts.numberLabel),
    fromName: facts.shopName,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...body,
  };
}

/** A chi compra, quando la fioreria cambia l'ordine e lo avvisa: com'è adesso. */
export function onlineOrderChangedEmail(input: {
  to: string;
  name: string;
  facts: OnlineOrderEmailFacts;
  lines: readonly string[];
  url: string;
  replyTo: string | null;
}): EmailMessage {
  const { facts } = input;
  const body = plainAndHtml(
    `Hola ${input.name}:`,
    [
      `${facts.shopName} actualizó tu pedido ${facts.numberLabel}. Así queda: ${modeLine(facts)}.`,
      input.lines.map((line) => `• ${line}`).join('\n'),
      `Total: ${facts.totalLabel}.`,
      'Si algo no está bien, escríbele a la florería desde tu pedido.',
    ],
    { label: 'Ver mi pedido', url: input.url },
    `Recibiste este correo porque hiciste un pedido en ${BRAND.productName}.`,
    'Tu pedido cambió',
  );
  return {
    to: input.to,
    category: 'online_order_changed',
    subject: `Cambió tu pedido ${facts.numberLabel}`,
    fromName: facts.shopName,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...body,
  };
}

/** A chi compra: la fioreria ha scritto sull'ordine. Mai il testo del messaggio. */
export function orderMessageForBuyerEmail(input: {
  to: string;
  name: string;
  shopName: string;
  numberLabel: string;
  url: string;
  replyTo: string | null;
}): EmailMessage {
  const body = plainAndHtml(
    `Hola ${input.name}:`,
    [
      `Tienes un mensaje nuevo de ${input.shopName} sobre tu pedido ${input.numberLabel}.`,
      'Lo puedes leer y responder en tu cuenta.',
    ],
    { label: 'Ver el mensaje', url: input.url },
    `Recibiste este correo porque hiciste un pedido en ${BRAND.productName}.`,
    'Tienes un mensaje nuevo',
  );
  return {
    to: input.to,
    category: 'order_message_buyer',
    subject: `${input.shopName} te escribió sobre tu pedido ${input.numberLabel}`,
    fromName: input.shopName,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...body,
  };
}

/** A propietari e gerenti: chi ha fatto l'ordine ha scritto. Mai il testo del messaggio. */
export function orderMessageForShopEmail(input: {
  to: string;
  buyerName: string;
  shopName: string;
  numberLabel: string;
  url: string;
}): EmailMessage {
  const body = plainAndHtml(
    'Hola:',
    [
      `${input.buyerName} te escribió sobre el pedido ${input.numberLabel}.`,
      `Respóndele desde ${BRAND.productName}: el cliente lo lee en su cuenta.`,
    ],
    { label: 'Ver el mensaje', url: input.url },
    `Recibes este correo porque eres propietario/a o gerente de ${input.shopName}.`,
    'Mensaje de un cliente',
  );
  return {
    to: input.to,
    category: 'order_message_shop',
    subject: `Mensaje del cliente sobre el pedido ${input.numberLabel}`,
    ...body,
  };
}

/** A propietari e gerenti: un ordine online da accettare scade prima del prossimo giro. */
export function pendingOrderReminderEmail(input: {
  to: string;
  buyerName: string;
  facts: OnlineOrderEmailFacts;
  deadlineLabel: string;
  url: string;
}): EmailMessage {
  const { facts } = input;
  const body = plainAndHtml(
    'Hola:',
    [
      `${input.buyerName} hizo el pedido ${facts.numberLabel} (${modeLine(facts)}) y todavía nadie lo aceptó.`,
      `Si no lo aceptas o rechazas antes del ${input.deadlineLabel}, se cancela solo y le avisamos al cliente.`,
    ],
    { label: 'Ver y aceptar', url: input.url },
    `Recibes este correo porque eres propietario/a o gerente de ${facts.shopName}.`,
    'Un pedido está por cancelarse',
  );
  return {
    to: input.to,
    category: 'online_order_reminder',
    subject: `El pedido ${facts.numberLabel} se cancela pronto`,
    ...body,
  };
}

/** A propietari e gerenti: un ordine online si è annullato da solo perché nessuno l'ha accettato. */
export function onlineOrderExpiredShopEmail(input: {
  to: string;
  buyerName: string;
  facts: OnlineOrderEmailFacts;
  url: string;
}): EmailMessage {
  const { facts } = input;
  const body = plainAndHtml(
    'Hola:',
    [
      `Nadie aceptó a tiempo el pedido ${facts.numberLabel} de ${input.buyerName} (${modeLine(facts)}): se canceló solo y le avisamos al cliente.`,
    ],
    { label: 'Ver el pedido', url: input.url },
    `Recibes este correo porque eres propietario/a o gerente de ${facts.shopName}.`,
    'Pedido cancelado sin respuesta',
  );
  return {
    to: input.to,
    category: 'online_order_expired_shop',
    subject: `Se canceló el pedido ${facts.numberLabel}`,
    ...body,
  };
}
