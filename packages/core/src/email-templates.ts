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
        `Gracias por crear tu cuenta en ${escapeHtml(BRAND.productName)}. Confirma tu correo para empezar a configurar tu florería.`,
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
