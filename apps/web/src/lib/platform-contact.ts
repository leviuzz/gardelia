import 'server-only';
import { whatsappLink } from '@floral/domain';
import { serverEnv } from './env';

/**
 * Link WhatsApp della piattaforma per comprare crediti (immagini AI nella fase di prova, D-29;
 * Asistente de plantas, ADR-085), con il messaggio già scritto; null se il numero non è
 * configurato (`PLATFORM_WHATSAPP`).
 */
export function aiCreditsWhatsappLink(text: string): string | null {
  const phone = serverEnv().PLATFORM_WHATSAPP;
  return phone ? whatsappLink(phone, text) : null;
}
