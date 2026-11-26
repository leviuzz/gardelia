/**
 * Conto del cliente del marketplace (blocco C1, ADR-064): i dati di chi compra
 * appartengono alla persona, non a una fioreria. Ogni funzione lavora dentro `withUserContext`,
 * con la RLS per utente (`"userId" = app_current_user_id()`), e filtra comunque per `userId`
 * (difesa in profondità, come per i tenant).
 *
 * Il `BuyerContext` si costruisce solo dalla sessione (web: `getBuyerContext()`), mai da un ID
 * arrivato dal browser.
 */
import { getDb, withUserContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  BUYER_LIMITS,
  buyerAccountDeletionBlockers,
  buyerAddressSchema,
  buyerProfileSchema,
  formatOrderNumber,
  formatSubscriptionNumber,
  freshCoordinates,
  isUuid,
  nextStoredPlace,
  toFieldErrors,
  type BuyerAccountDeletionBlocker,
  type Coordinates,
  type MarketCountry,
} from '@floral/domain';
import { recordPlatformSecurityEvent } from '../audit';
import { NotFoundError, ValidationError } from '../errors';

export interface BuyerContext {
  readonly userId: string;
  /** Mercato degli indirizzi (V1: solo Messico). */
  readonly country: MarketCountry;
}

export interface BuyerAddressDto {
  readonly id: string;
  readonly label: string | null;
  readonly recipientName: string | null;
  readonly recipientPhone: string | null;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly neighborhood: string | null;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
  readonly deliveryNotes: string | null;
  readonly isDefault: boolean;
  /** Google Places (ADR-059): presente se l'indirizzo è stato scelto fra i suggerimenti. */
  readonly placeId: string | null;
}

export interface BuyerAccountDto {
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  /** Attivi, il predefinito per primo. */
  readonly addresses: readonly BuyerAddressDto[];
}

const ADDRESS_SELECT = {
  id: true,
  label: true,
  recipientName: true,
  recipientPhone: true,
  addressLine1: true,
  addressLine2: true,
  neighborhood: true,
  city: true,
  region: true,
  postalCode: true,
  deliveryNotes: true,
  isDefault: true,
  placeId: true,
} as const;

/**
 * Apre (la prima volta) e legge il conto cliente. Da quando esiste, l'accesso senza fiorerie porta
 * a "Mi cuenta" invece che alla creazione di una fioreria. Idempotente.
 */
export async function openBuyerAccount(ctx: BuyerContext): Promise<BuyerAccountDto> {
  assertBuyer(ctx);
  return withUserContext(getDb(), ctx.userId, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { name: true, email: true },
    });
    await ensureProfile(tx, ctx);
    const profile = await tx.buyerProfile.findUniqueOrThrow({
      where: { userId: ctx.userId },
      select: { phone: true },
    });
    const addresses = await tx.buyerAddress.findMany({
      where: { userId: ctx.userId, status: 'ACTIVE' },
      select: ADDRESS_SELECT,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return { name: user.name, email: user.email, phone: profile.phone, addresses };
  });
}

/** L'utente ha già aperto il conto cliente (per decidere dove portarlo dopo l'accesso). */
export async function hasBuyerAccount(ctx: Pick<BuyerContext, 'userId'>): Promise<boolean> {
  if (!isUuid(ctx.userId)) return false;
  const profile = await withUserContext(getDb(), ctx.userId, (tx) =>
    tx.buyerProfile.findUnique({ where: { userId: ctx.userId }, select: { userId: true } }),
  );
  return profile !== null;
}

/** Telefono di contatto per le fiorerie che consegnano. */
export async function updateBuyerProfile(ctx: BuyerContext, rawInput: unknown): Promise<void> {
  assertBuyer(ctx);
  const parsed = buyerProfileSchema(ctx.country).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  await withUserContext(getDb(), ctx.userId, async (tx) => {
    await ensureProfile(tx, ctx);
    await tx.buyerProfile.update({
      where: { userId: ctx.userId },
      data: { phone: parsed.data.phone },
    });
  });
}

function parseAddress(ctx: BuyerContext, rawInput: unknown) {
  const parsed = buyerAddressSchema(ctx.country).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  return parsed.data;
}

/** Campi nascosti di Google Places del form (li compila la ricerca dell'indirizzo). */
function placeFields(rawInput: unknown): Record<string, unknown> {
  return rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {};
}

/**
 * Crea il profilo se manca. `ON CONFLICT DO NOTHING` e non l'upsert di Prisma, che con due richieste
 * contemporanee (doppio clic, due schede) proverebbe a crearlo due volte.
 */
async function ensureProfile(tx: TransactionClient, ctx: BuyerContext): Promise<void> {
  await tx.$executeRaw`INSERT INTO "BuyerProfile" ("userId", "updatedAt")
    VALUES (${ctx.userId}::uuid, CURRENT_TIMESTAMP) ON CONFLICT ("userId") DO NOTHING`;
}

/**
 * Blocca il profilo della persona (e lo crea se manca): le modifiche agli indirizzi della stessa
 * persona passano una alla volta, così non nascono due predefiniti.
 */
async function lockProfile(tx: TransactionClient, ctx: BuyerContext): Promise<void> {
  await ensureProfile(tx, ctx);
  await tx.$queryRaw`SELECT "userId" FROM "BuyerProfile" WHERE "userId" = ${ctx.userId}::uuid FOR UPDATE`;
}

export async function addBuyerAddress(
  ctx: BuyerContext,
  rawInput: unknown,
): Promise<{ id: string }> {
  assertBuyer(ctx);
  const input = parseAddress(ctx, rawInput);
  return withUserContext(getDb(), ctx.userId, async (tx) => {
    await lockProfile(tx, ctx);
    const activeCount = await tx.buyerAddress.count({
      where: { userId: ctx.userId, status: 'ACTIVE' },
    });
    if (activeCount >= BUYER_LIMITS.addresses) {
      throw new ValidationError({ _form: 'too_many_items' });
    }
    // Il primo indirizzo diventa predefinito; un nuovo predefinito sostituisce il precedente.
    const isDefault = input.isDefault || activeCount === 0;
    if (isDefault) {
      await tx.buyerAddress.updateMany({
        where: { userId: ctx.userId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const address = await tx.buyerAddress.create({
      data: {
        userId: ctx.userId,
        ...input,
        ...nextStoredPlace(placeFields(rawInput), null, new Date()),
        isDefault,
        countryCode: ctx.country,
      },
      select: { id: true },
    });
    return { id: address.id };
  });
}

export async function updateBuyerAddress(
  ctx: BuyerContext,
  addressId: string,
  rawInput: unknown,
): Promise<void> {
  assertBuyer(ctx);
  if (!isUuid(addressId)) throw new NotFoundError('BuyerAddress');
  const input = parseAddress(ctx, rawInput);
  const found = await withUserContext(getDb(), ctx.userId, async (tx) => {
    await lockProfile(tx, ctx);
    const address = await tx.buyerAddress.findFirst({
      where: { id: addressId, userId: ctx.userId, status: 'ACTIVE' },
    });
    if (!address) return false;
    if (input.isDefault && !address.isDefault) {
      await tx.buyerAddress.updateMany({
        where: { userId: ctx.userId, isDefault: true },
        data: { isDefault: false },
      });
    }
    await tx.buyerAddress.update({
      where: { id: address.id },
      // Non si toglie il flag all'unico predefinito senza sceglierne un altro.
      data: {
        ...input,
        ...nextStoredPlace(placeFields(rawInput), address, new Date()),
        isDefault: input.isDefault || address.isDefault,
      },
    });
    return true;
  });
  // Un indirizzo di un'altra persona è invisibile (RLS): risponde come uno inesistente.
  if (!found) throw new NotFoundError('BuyerAddress');
}

export async function archiveBuyerAddress(ctx: BuyerContext, addressId: string): Promise<void> {
  assertBuyer(ctx);
  if (!isUuid(addressId)) throw new NotFoundError('BuyerAddress');
  const found = await withUserContext(getDb(), ctx.userId, async (tx) => {
    await lockProfile(tx, ctx);
    const address = await tx.buyerAddress.findFirst({
      where: { id: addressId, userId: ctx.userId, status: 'ACTIVE' },
    });
    if (!address) return false;
    await tx.buyerAddress.update({
      where: { id: address.id },
      data: { status: 'ARCHIVED', isDefault: false },
    });
    if (address.isDefault) {
      // Promuove a predefinito l'indirizzo attivo più vecchio, se esiste.
      const next = await tx.buyerAddress.findFirst({
        where: { userId: ctx.userId, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (next) {
        await tx.buyerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }
    return true;
  });
  if (!found) throw new NotFoundError('BuyerAddress');
}

function assertBuyer(ctx: BuyerContext): void {
  if (!isUuid(ctx.userId)) throw new TypeError('BuyerContext senza un utente valido');
}

export interface BuyerSearchAddressDto {
  readonly id: string;
  /** Etichetta o via, per dire dove si cerca. */
  readonly label: string;
  readonly city: string;
  /** Coordinate ancora valide (ADR-059), o null: allora si cerca per città. */
  readonly coordinates: Coordinates | null;
}

/**
 * Indirizzi salvati per cercare le fiorerie (ADR-066), senza aprire il conto cliente: chi non l'ha
 * mai aperto non ne ha.
 */
export async function listBuyerSearchAddresses(
  ctx: BuyerContext,
): Promise<readonly BuyerSearchAddressDto[]> {
  assertBuyer(ctx);
  const rows = await withUserContext(getDb(), ctx.userId, (tx) =>
    tx.buyerAddress.findMany({
      where: { userId: ctx.userId, status: 'ACTIVE' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        label: true,
        addressLine1: true,
        city: true,
        latitude: true,
        longitude: true,
        coordinatesAt: true,
      },
    }),
  );
  const now = new Date();
  return rows.map((row) => ({
    id: row.id,
    label: row.label ?? row.addressLine1,
    city: row.city,
    coordinates: freshCoordinates(row, now),
  }));
}

// -----------------------------------------------------------------------------
// Diritti di chi compra (ADR-068): i suoi dati e la cancellazione del conto
// -----------------------------------------------------------------------------

interface BuyerOrderStatusRow {
  readonly shop_name: string;
  readonly number: number;
  readonly status: string;
  readonly fulfillment_mode: string;
  readonly scheduled_date: Date | null;
  readonly total_minor: number;
  readonly currency: string;
  readonly created_at: Date;
}

async function buyerOrderRows(tx: TransactionClient): Promise<BuyerOrderStatusRow[]> {
  // L'utente viene solo dal contesto (`app_buyer_orders`, ADR-067).
  return tx.$queryRaw<BuyerOrderStatusRow[]>`
    SELECT shop_name, number, status, fulfillment_mode, scheduled_date, total_minor, currency,
           created_at
    FROM app_buyer_orders()`;
}

/** I dati della persona, in un documento da scaricare ("Descargar mis datos", diritto di accesso). */
export interface BuyerDataExport {
  readonly exportedAt: string;
  readonly account: {
    readonly name: string;
    readonly email: string;
    readonly language: string;
    readonly createdAt: string;
    readonly phone: string | null;
  };
  readonly addresses: readonly (Omit<BuyerAddressDto, 'id' | 'placeId'> & {
    readonly status: string;
    readonly createdAt: string;
  })[];
  readonly orders: readonly {
    readonly shop: string;
    readonly number: string;
    readonly status: string;
    readonly mode: string;
    readonly scheduledDate: string | null;
    readonly totalMinor: number;
    readonly currency: string;
    readonly createdAt: string;
  }[];
  /** I messaggi scritti dalla persona alle fiorerie sui suoi ordini online (M3, ADR-088). */
  readonly orderMessages: readonly {
    readonly shop: string;
    readonly order: string;
    readonly sentAt: string;
    readonly text: string;
    readonly withPhoto: boolean;
  }[];
  /** Floral Care (ADR-084): i contratti che la persona vede o ha visto nella pagina del cliente. */
  readonly floralCare: {
    readonly accesses: readonly {
      readonly shop: string;
      readonly customer: string;
      /** Il contratto, se l'accesso era solo per uno (SUS-0001). */
      readonly contract: string | null;
      readonly canSeeMoney: boolean;
      readonly since: string;
      readonly closedAt: string | null;
      readonly closedReason: string | null;
    }[];
    /** I messaggi scritti dalla persona nei fili dei contratti (ADR-084, blocco 5b). */
    readonly messages: readonly {
      readonly shop: string;
      readonly contract: string;
      readonly sentAt: string;
      readonly text: string;
      readonly withPhoto: boolean;
    }[];
    /** Le consultas della persona all'Asistente de plantas (ADR-085, blocco 6b). */
    readonly assistant: readonly {
      readonly shop: string;
      readonly contract: string;
      readonly askedAt: string;
      /** CARE = come curarla, PROBLEM = un problema. */
      readonly kind: string;
      readonly question: string;
      readonly answer: string;
    }[];
  };
}

export async function exportBuyerData(ctx: BuyerContext): Promise<BuyerDataExport> {
  assertBuyer(ctx);
  return withUserContext(getDb(), ctx.userId, async (tx) => {
    const [
      user,
      profile,
      addresses,
      orders,
      careAccesses,
      careMessages,
      assistantAnswers,
      orderMessages,
    ] = await Promise.all([
      tx.user.findUniqueOrThrow({
        where: { id: ctx.userId },
        select: { name: true, email: true, locale: true, createdAt: true },
      }),
      tx.buyerProfile.findUnique({ where: { userId: ctx.userId }, select: { phone: true } }),
      // Tutti, anche quelli tolti dalla rubrica: sono dati che conserviamo.
      tx.buyerAddress.findMany({
        where: { userId: ctx.userId },
        orderBy: { createdAt: 'asc' },
        select: {
          label: true,
          recipientName: true,
          recipientPhone: true,
          addressLine1: true,
          addressLine2: true,
          neighborhood: true,
          city: true,
          region: true,
          postalCode: true,
          deliveryNotes: true,
          isDefault: true,
          status: true,
          createdAt: true,
        },
      }),
      buyerOrderRows(tx),
      tx.$queryRaw<
        {
          shop_name: string;
          customer_name: string;
          contract_number: number | null;
          can_see_money: boolean;
          created_at: Date;
          revoked_at: Date | null;
          revoked_reason: string | null;
        }[]
      >`SELECT * FROM app_buyer_care_access()`,
      tx.$queryRaw<
        {
          shop_name: string;
          contract_number: number;
          created_at: Date;
          body: string;
          has_photo: boolean;
        }[]
      >`SELECT * FROM app_buyer_care_messages()`,
      tx.$queryRaw<
        {
          shop_name: string;
          contract_number: number;
          created_at: Date;
          kind: string;
          question: string;
          answer: string;
        }[]
      >`SELECT * FROM app_buyer_assistant_answers()`,
      tx.$queryRaw<
        {
          shop_name: string;
          order_number: number;
          created_at: Date;
          body: string;
          has_photo: boolean;
        }[]
      >`SELECT * FROM app_buyer_order_messages()`,
    ]);
    return {
      exportedAt: new Date().toISOString(),
      account: {
        name: user.name,
        email: user.email,
        language: user.locale,
        createdAt: user.createdAt.toISOString(),
        phone: profile?.phone ?? null,
      },
      addresses: addresses.map((address) => ({
        ...address,
        createdAt: address.createdAt.toISOString(),
      })),
      orders: orders.map((order) => ({
        shop: order.shop_name,
        number: formatOrderNumber(order.number),
        status: order.status,
        mode: order.fulfillment_mode,
        scheduledDate: order.scheduled_date
          ? order.scheduled_date.toISOString().slice(0, 10)
          : null,
        totalMinor: order.total_minor,
        currency: order.currency.trim(),
        createdAt: order.created_at.toISOString(),
      })),
      orderMessages: orderMessages.map((row) => ({
        shop: row.shop_name,
        order: formatOrderNumber(row.order_number),
        sentAt: row.created_at.toISOString(),
        text: row.body,
        withPhoto: row.has_photo,
      })),
      floralCare: {
        accesses: careAccesses.map((row) => ({
          shop: row.shop_name,
          customer: row.customer_name,
          contract:
            row.contract_number === null ? null : formatSubscriptionNumber(row.contract_number),
          canSeeMoney: row.can_see_money,
          since: row.created_at.toISOString(),
          closedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
          closedReason: row.revoked_reason,
        })),
        messages: careMessages.map((row) => ({
          shop: row.shop_name,
          contract: formatSubscriptionNumber(row.contract_number),
          sentAt: row.created_at.toISOString(),
          text: row.body,
          withPhoto: row.has_photo,
        })),
        assistant: assistantAnswers.map((row) => ({
          shop: row.shop_name,
          contract: formatSubscriptionNumber(row.contract_number),
          askedAt: row.created_at.toISOString(),
          kind: row.kind,
          question: row.question,
          answer: row.answer,
        })),
      },
    };
  });
}

/**
 * Cosa impedisce di eliminare da soli il conto (vuoto = si può). Lo usano la pagina, per spiegarlo,
 * e la cancellazione stessa, che lo ricontrolla subito prima di cancellare.
 */
export async function getBuyerAccountDeletionBlockers(
  ctx: Pick<BuyerContext, 'userId'>,
): Promise<BuyerAccountDeletionBlocker[]> {
  if (!isUuid(ctx.userId)) throw new TypeError('BuyerContext senza un utente valido');
  return withUserContext(getDb(), ctx.userId, async (tx) => {
    const [memberships, user, orders] = await Promise.all([
      // Anche quelle disattivate: il conto regge la storia della fioreria.
      tx.membership.count({ where: { userId: ctx.userId } }),
      tx.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { platformRole: true } }),
      buyerOrderRows(tx),
    ]);
    return buyerAccountDeletionBlockers({
      memberships,
      platformRole: user.platformRole,
      orderStatuses: orders.map((order) => order.status),
    });
  });
}

/**
 * Registro (di piattaforma, senza dati personali) della cancellazione di un conto cliente: lo
 * chiama l'autenticazione dopo aver cancellato la persona.
 */
export async function recordBuyerAccountDeleted(userId: string): Promise<void> {
  await recordPlatformSecurityEvent({
    action: AUDIT_ACTIONS.platformBuyerAccountDeleted,
    actorUserId: userId,
    entityType: 'User',
    entityId: userId,
  });
}
