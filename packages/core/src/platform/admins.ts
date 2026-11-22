/**
 * Primo amministratore della piattaforma (fase 0, ambiente online di prova): senza un utente
 * SUPER_ADMIN la CLI non può assegnare piani né crediti. Questa operazione nomina il PRIMO e
 * basta: se ne esiste già uno si rifiuta (i successivi si nominano con procedure dedicate).
 * Solo CLI di piattaforma (ADR-021), mai dal web.
 */
import { getDb, withSystemContext } from '@floral/db';
import { AUDIT_ACTIONS, normalizeEmail } from '@floral/domain';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';

export async function bootstrapPlatformAdmin(input: {
  readonly email: string;
}): Promise<{ readonly userId: string }> {
  const email = normalizeEmail(input.email);
  if (!email) throw new ValidationError({ email: 'required' });

  const userId = await withSystemContext(
    getDb(),
    { reason: 'platform: primo amministratore della piattaforma' },
    async (tx) => {
      // Un'operazione alla volta: due avvii contemporanei non nominano due "primi".
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('floral:platform-admin-bootstrap'))`;
      const existing = await tx.user.count({ where: { platformRole: 'SUPER_ADMIN' } });
      if (existing > 0) throw new ConflictError('platform_admin_exists');
      const user = await tx.user.findUnique({
        where: { email },
        select: { id: true, status: true, emailVerified: true },
      });
      if (!user || user.status !== 'ACTIVE') throw new NotFoundError('User');
      // Solo un account che ha confermato l'email (o è entrato con Google verificato).
      if (!user.emailVerified) throw new ValidationError({ email: 'email_not_verified' });
      await tx.user.update({ where: { id: user.id }, data: { platformRole: 'SUPER_ADMIN' } });
      await tx.auditLog.create({
        data: {
          tenantId: null,
          actorUserId: user.id,
          action: AUDIT_ACTIONS.platformAdminBootstrapped,
          entityType: 'User',
          entityId: user.id,
        },
      });
      return user.id;
    },
  );
  logger.warn({ userId }, 'primo amministratore della piattaforma nominato');
  return { userId };
}
