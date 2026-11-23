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
  BUYER_LIMITS,
  buyerAddressSchema,
  buyerProfileSchema,
  isUuid,
  nextStoredPlace,
  toFieldErrors,
  type MarketCountry,
} from '@floral/domain';
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
