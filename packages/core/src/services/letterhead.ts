/**
 * Intestazione delle stampe (cotización, comanda): nome, logo, contatti, indirizzo e orario della
 * tienda principale. Il logo è quello di "Mi tienda en línea" (ADR-065), uno solo per fioreria.
 */
import { getDb, withTenantContext } from '@floral/db';
import { MX_REGIONS, hasOpeningHours, type OpeningDay } from '@floral/domain';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { loadOpeningHours } from './opening-hours';

export interface LetterheadDto {
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  /** ID del logo attuale (per l'URL dell'immagine), o null. */
  readonly logoId: string | null;
  readonly address: {
    readonly line: string;
    readonly neighborhood: string | null;
    readonly postalCode: string;
    readonly city: string;
    /** Nome dello stato ("Aguascalientes"), non il codice. */
    readonly region: string;
  } | null;
  /** Orari di apertura, o null se la fioreria non li ha indicati. */
  readonly openingHours: readonly OpeningDay[] | null;
}

export async function getLetterhead(ctx: TenantContext): Promise<LetterheadDto> {
  requirePermission(ctx, 'tenant:read');
  return withTenantContext(getDb(), ctx, async (tx) => {
    const [tenant, store, location, openingHours] = await Promise.all([
      tx.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { displayName: true, contactPhone: true, contactEmail: true },
      }),
      tx.onlineStore.findUnique({ where: { tenantId: ctx.tenantId }, select: { logoId: true } }),
      tx.location.findFirst({
        where: { tenantId: ctx.tenantId, isPrimary: true },
        select: {
          addressLine1: true,
          addressLine2: true,
          neighborhood: true,
          postalCode: true,
          city: true,
          region: true,
          phone: true,
        },
      }),
      loadOpeningHours(tx, ctx.tenantId),
    ]);
    return {
      name: tenant.displayName,
      // Il telefono della tienda, se c'è, è quello giusto per chi deve passare o chiamare.
      phone: location?.phone ?? tenant.contactPhone,
      email: tenant.contactEmail,
      logoId: store?.logoId ?? null,
      address: location
        ? {
            line: [location.addressLine1, location.addressLine2].filter(Boolean).join(' '),
            neighborhood: location.neighborhood,
            postalCode: location.postalCode,
            city: location.city,
            region:
              MX_REGIONS.find((item) => item.code === location.region)?.name ?? location.region,
          }
        : null,
      openingHours: hasOpeningHours(openingHours) ? openingHours : null,
    };
  });
}
