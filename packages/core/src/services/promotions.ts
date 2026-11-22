/**
 * Promo delle date speciali (ADR-047), impostazioni della fioreria: attivazione e sconto
 * dell'email automatica, quanti clienti la possono ricevere e l'anteprima del messaggio.
 * Gli invii li fa il lavoro giornaliero (`jobs/occasion-promos.ts`).
 */
import { getDb, withTenantContext, type TenantMode } from '@floral/db';
import {
  AUDIT_ACTIONS,
  addDays,
  diffFields,
  getMarket,
  occasionPromoFormSchema,
  resolveLocale,
  toFieldErrors,
  todayInTimeZone,
  type DiscountKind,
  type OccasionPromoSettings,
  type SupportedLocale,
} from '@floral/domain';
import { recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ValidationError } from '../errors';
import type { EmailMessage } from '../mailer';
import { occasionPromoEmail } from '../promo-email';

export interface OccasionPromoView {
  readonly settings: OccasionPromoSettings;
  /** DEMO: le email non partono mai (ADR-016). */
  readonly mode: TenantMode;
  /** Clienti attivi con almeno una data speciale, e quanti hanno email e consenso. */
  readonly reach: { readonly customersWithDates: number; readonly reachable: number };
  /** Email partite negli ultimi 30 giorni. */
  readonly sentLast30Days: number;
  /** Lingua delle email (quella del mercato della fioreria). */
  readonly emailLocale: SupportedLocale;
  /** La fioreria ha un contatto (email o telefono) da mostrare nell'email. */
  readonly hasContact: boolean;
}

const PROMO_FIELDS = ['occasionPromoEnabled', 'occasionPromoKind', 'occasionPromoValue'] as const;

async function readPromo(ctx: TenantContext) {
  return withTenantContext(getDb(), ctx, async (tx) => {
    const tenant = await tx.tenant.findFirstOrThrow({
      where: { id: ctx.tenantId },
      select: {
        displayName: true,
        contactEmail: true,
        contactPhone: true,
        timezone: true,
        occasionPromoEnabled: true,
        occasionPromoKind: true,
        occasionPromoValue: true,
      },
    });
    const withDates = {
      tenantId: ctx.tenantId,
      status: 'ACTIVE' as const,
      occasions: { some: {} },
    };
    const customersWithDates = await tx.customer.count({ where: withDates });
    const reachable = await tx.customer.count({
      where: { ...withDates, marketingConsent: true, email: { not: null } },
    });
    const sentLast30Days = await tx.occasionPromoEmail.count({
      where: {
        tenantId: ctx.tenantId,
        status: 'SENT',
        sentAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });
    return { tenant, customersWithDates, reachable, sentLast30Days };
  });
}

export async function getOccasionPromo(ctx: TenantContext): Promise<OccasionPromoView> {
  requirePermission(ctx, 'promotions:manage');
  const { tenant, customersWithDates, reachable, sentLast30Days } = await readPromo(ctx);
  return {
    settings: {
      enabled: tenant.occasionPromoEnabled,
      kind: tenant.occasionPromoKind,
      value: tenant.occasionPromoValue,
    },
    mode: ctx.mode,
    reach: { customersWithDates, reachable },
    sentLast30Days,
    emailLocale: resolveLocale(getMarket(ctx.country).defaultLocale),
    hasContact: Boolean(tenant.contactEmail || tenant.contactPhone),
  };
}

export async function updateOccasionPromo(ctx: TenantContext, rawInput: unknown): Promise<void> {
  requirePermission(ctx, 'promotions:manage');
  const parsed = occasionPromoFormSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const next = {
    occasionPromoEnabled: parsed.data.enabled,
    occasionPromoKind: parsed.data.kind,
    occasionPromoValue: parsed.data.value,
  };
  await withTenantContext(getDb(), ctx, async (tx) => {
    const before = await tx.tenant.findFirstOrThrow({
      where: { id: ctx.tenantId },
      select: { occasionPromoEnabled: true, occasionPromoKind: true, occasionPromoValue: true },
    });
    const changes = diffFields(before, next, PROMO_FIELDS);
    if (Object.keys(changes).length === 0) return;
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: next });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.tenantPromoUpdated,
      entityType: 'Tenant',
      entityId: ctx.tenantId,
      metadata: { changes: JSON.parse(JSON.stringify(changes)) },
    });
  });
}

/** Nome d'esempio del cliente nell'anteprima, nella lingua delle email. */
const SAMPLE_CUSTOMER: Readonly<Record<SupportedLocale, string>> = {
  'es-MX': 'María',
  'it-IT': 'Giulia',
  'en-US': 'Emily',
};

/**
 * Anteprima dell'email con lo sconto salvato: un cliente d'esempio con il compleanno fra 7
 * giorni. null finché la fioreria non sceglie lo sconto. I link non portano da nessuna parte.
 */
export async function previewOccasionPromoEmail(
  ctx: TenantContext,
  now: Date = new Date(),
): Promise<EmailMessage | null> {
  requirePermission(ctx, 'promotions:manage');
  const { tenant } = await readPromo(ctx);
  if (tenant.occasionPromoValue === null) return null;
  const locale = resolveLocale(getMarket(ctx.country).defaultLocale);
  const kind: DiscountKind = tenant.occasionPromoKind;
  return occasionPromoEmail({
    locale,
    to: 'preview@example.invalid',
    customerName: SAMPLE_CUSTOMER[locale],
    shop: {
      name: tenant.displayName,
      contactEmail: tenant.contactEmail,
      contactPhone: tenant.contactPhone,
    },
    currency: ctx.currency,
    discount: { kind, value: tenant.occasionPromoValue },
    occasions: [
      {
        type: 'BIRTHDAY',
        label: null,
        personName: null,
        date: addDays(todayInTimeZone(tenant.timezone, now), 7),
      },
    ],
    unsubscribeUrl: '#',
    oneClickUnsubscribeUrl: '#',
  });
}
