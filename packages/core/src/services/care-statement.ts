/**
 * Estado de cuenta di Floral Care di un cliente (ADR-082): tutte le sue sedi (contratti), i cargos
 * degli ultimi 12 mesi più tutti quelli ancora aperti o a favore, i movimenti di soldi e i totali
 * (da pagare, vencido, a favore). Da qui un solo pagamento si distribuisce sui cargos più vecchi
 * (`recordCustomerCarePayment`). Vuole `subscriptions:payments`; non chiede il piano.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  CARE_CHARGE_LIMITS,
  addCarePeriods,
  carePeriodOf,
  formatCareChargeNumber,
  formatSubscriptionNumber,
  isUuid,
  todayInTimeZone,
  type CarePaymentKind,
  type CarePaymentStatus,
  type CustomerSubscriptionStatus,
  type PaymentMethod,
} from '@floral/domain';
import { notFound } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { NotFoundError } from '../errors';
import { memberNamesTx, toCareChargeSummary, type CareChargeSummaryDto } from './care-charges';
import { addressLineOf, dbDate, isoOf } from './care-internals';

export interface CareStatementChargeDto extends CareChargeSummaryDto {
  readonly subscriptionId: string;
  readonly contractLabel: string;
  readonly addressLine: string | null;
}

export interface CareStatementPaymentDto {
  readonly id: string;
  readonly kind: CarePaymentKind;
  readonly status: CarePaymentStatus;
  readonly method: PaymentMethod;
  readonly paidOn: string;
  readonly reference: string | null;
  readonly note: string | null;
  /** Con il segno: pagamenti positivi, devoluciones negative, storni di segno opposto. */
  readonly amountMinor: number;
  /** Il movimento è stato annullato (ha il suo storno). */
  readonly reversed: boolean;
  /** Per uno storno: il movimento annullato. */
  readonly reversedPaymentId: string | null;
  /** Su quali cargos è andato, e quanto su ognuno. */
  readonly charges: readonly {
    readonly id: string;
    readonly subscriptionId: string;
    readonly numberLabel: string;
    readonly amountMinor: number;
  }[];
  readonly createdAt: Date;
  readonly createdByName: string | null;
}

export interface CareStatementDto {
  readonly customer: { readonly id: string; readonly name: string; readonly archived: boolean };
  readonly currency: string;
  /** Le sedi: i contratti confermati del cliente. */
  readonly contracts: readonly {
    readonly id: string;
    readonly numberLabel: string;
    readonly status: CustomerSubscriptionStatus;
    readonly addressLine: string | null;
  }[];
  readonly charges: readonly CareStatementChargeDto[];
  readonly payments: readonly CareStatementPaymentDto[];
  readonly totals: {
    /** Quanto manca da pagare in tutti i cargos. */
    readonly openMinor: number;
    readonly overdueMinor: number;
    /** Quanto deve restituire la fioreria (positivo). */
    readonly creditMinor: number;
  };
  /** Il primo mese mostrato ("2025-12-01"): prima solo i cargos ancora aperti o a favore. */
  readonly since: string;
}

export async function getCustomerCareStatement(
  ctx: TenantContext,
  customerId: string,
): Promise<CareStatementDto> {
  requirePermission(ctx, 'subscriptions:payments');
  if (!isUuid(customerId)) throw new NotFoundError('Customer');
  const today = todayInTimeZone(ctx.timezone);
  const since = addCarePeriods(carePeriodOf(today), -(CARE_CHARGE_LIMITS.statementMonths - 1));
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { tenantId: ctx.tenantId, id: customerId },
      select: { id: true, displayName: true, status: true },
    });
    if (!customer) return null;
    const scope = { tenantId: ctx.tenantId, customerId };
    const [contracts, charges, payments, open, overdue, credit] = await Promise.all([
      tx.customerSubscription.findMany({
        where: { ...scope, kind: 'CARE', confirmedAt: { not: null } },
        orderBy: { number: 'asc' },
        select: {
          id: true,
          number: true,
          status: true,
          customerAddress: { select: { addressLine1: true, neighborhood: true } },
        },
      }),
      tx.careCharge.findMany({
        where: { ...scope, OR: [{ period: { gte: dbDate(since) } }, { balanceMinor: { not: 0 } }] },
        orderBy: [{ period: 'desc' }, { number: 'desc' }],
        select: {
          id: true,
          number: true,
          period: true,
          issuedOn: true,
          dueDate: true,
          totalMinor: true,
          paidMinor: true,
          balanceMinor: true,
          currency: true,
          final: true,
          subscription: {
            select: {
              id: true,
              number: true,
              customerAddress: { select: { addressLine1: true, neighborhood: true } },
            },
          },
        },
      }),
      tx.carePayment.findMany({
        where: { ...scope, paidOn: { gte: dbDate(since) } },
        orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          kind: true,
          status: true,
          method: true,
          paidOn: true,
          reference: true,
          note: true,
          amountMinor: true,
          reversedPaymentId: true,
          createdAt: true,
          createdById: true,
          reversal: { select: { id: true } },
          allocations: {
            orderBy: [{ charge: { period: 'asc' } }, { charge: { number: 'asc' } }],
            select: {
              amountMinor: true,
              charge: { select: { id: true, number: true, subscriptionId: true } },
            },
          },
        },
      }),
      tx.careCharge.aggregate({
        where: { ...scope, balanceMinor: { gt: 0 } },
        _sum: { balanceMinor: true },
      }),
      tx.careCharge.aggregate({
        where: { ...scope, balanceMinor: { gt: 0 }, dueDate: { lt: dbDate(today) } },
        _sum: { balanceMinor: true },
      }),
      tx.careCharge.aggregate({
        where: { ...scope, balanceMinor: { lt: 0 } },
        _sum: { balanceMinor: true },
      }),
    ]);
    const names = await memberNamesTx(tx, ctx.tenantId, [
      ...new Set(payments.flatMap((payment) => payment.createdById ?? [])),
    ]);
    return { customer, contracts, charges, payments, open, overdue, credit, names };
  });
  if (!found) return notFound(ctx, 'Customer', customerId);
  return {
    customer: {
      id: found.customer.id,
      name: found.customer.displayName,
      archived: found.customer.status !== 'ACTIVE',
    },
    currency: ctx.currency,
    contracts: found.contracts.map((contract) => ({
      id: contract.id,
      numberLabel: formatSubscriptionNumber(contract.number),
      status: contract.status,
      addressLine: contract.customerAddress ? addressLineOf(contract.customerAddress) : null,
    })),
    charges: found.charges.map((charge) => ({
      ...toCareChargeSummary(charge, today),
      subscriptionId: charge.subscription.id,
      contractLabel: formatSubscriptionNumber(charge.subscription.number),
      addressLine: charge.subscription.customerAddress
        ? addressLineOf(charge.subscription.customerAddress)
        : null,
    })),
    payments: found.payments.map((payment) => ({
      id: payment.id,
      kind: payment.kind,
      status: payment.status,
      method: payment.method,
      paidOn: isoOf(payment.paidOn) ?? '',
      reference: payment.reference,
      note: payment.note,
      amountMinor: payment.amountMinor,
      reversed: payment.reversal !== null,
      reversedPaymentId: payment.reversedPaymentId,
      charges: payment.allocations.map((allocation) => ({
        id: allocation.charge.id,
        subscriptionId: allocation.charge.subscriptionId,
        numberLabel: formatCareChargeNumber(allocation.charge.number),
        amountMinor: allocation.amountMinor,
      })),
      createdAt: payment.createdAt,
      createdByName: payment.createdById ? (found.names.get(payment.createdById) ?? null) : null,
    })),
    totals: {
      openMinor: found.open._sum.balanceMinor ?? 0,
      overdueMinor: found.overdue._sum.balanceMinor ?? 0,
      creditMinor: -(found.credit._sum.balanceMinor ?? 0),
    },
    since: isoOf(dbDate(since)) ?? '',
  };
}
