/**
 * "Descargar los datos de la florería" (ADR-079): il titolare scarica uno ZIP con un CSV per area
 * (clienti, catalogo, preventivi, ordini, pagamenti, inventario, squadra, Floral Care) e un LEEME.
 * Serve per tenere i propri dati (anche prima di eliminare la fioreria, ADR-074) o portarli altrove.
 * Si legge tutto nel contesto della fioreria, con la RLS attiva; nel registro restano solo i conteggi.
 */
import { zipSync, strToU8 } from 'fflate';
import { getDb, withTenantContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  MX_REGIONS,
  careChargeStatus,
  formatCareChargeNumber,
  formatOrderNumber,
  formatQuoteNumber,
  formatSubscriptionNumber,
  formatTimeOfDay,
  minorToDecimalString,
  toCsv,
  todayInTimeZone,
  type CsvColumn,
} from '@floral/domain';
import { recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { LABELS, NO, YES, readme } from '../export/labels-es';
import { logger } from '../logger';
import { requiredParts } from './care-internals';

export interface TenantExportFile {
  /** "gardelia-las-camelias-2026-11-24.zip". */
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

interface Section {
  readonly name: string;
  readonly what: string;
  readonly csv: string;
  readonly rows: number;
}

function section<T>(
  name: string,
  what: string,
  columns: readonly CsvColumn<T>[],
  rows: readonly T[],
): Section {
  return { name, what, csv: toCsv(columns, rows), rows: rows.length };
}

const yesNo = (value: boolean) => (value ? YES : NO);

export async function exportTenantData(
  ctx: TenantContext,
  now: Date = new Date(),
): Promise<TenantExportFile> {
  requirePermission(ctx, 'tenant:export');

  // Date e ore nel fuso della fioreria ("2026-11-24 10:30"); i giorni di calendario come sono.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ctx.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const dateTime = (value: Date | null | undefined): string | null => {
    if (!value) return null;
    const p = Object.fromEntries(parts.formatToParts(value).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  };
  const day = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : null);
  const money = (minor: number | null | undefined) =>
    minor === null || minor === undefined ? null : minorToDecimalString(minor, ctx.currency);
  const time = (minutes: number | null | undefined) =>
    minutes === null || minutes === undefined ? null : formatTimeOfDay(minutes);
  const region = (code: string | null | undefined) =>
    code ? (MX_REGIONS.find((item) => item.code === code)?.name ?? code) : null;
  const tenantId = ctx.tenantId;
  const where = { tenantId };

  const data = await withTenantContext(getDb(), ctx, async (tx) => {
    const [
      customers,
      addresses,
      occasions,
      items,
      recipeLines,
      quotes,
      quoteLines,
      orders,
      orderLines,
      payments,
      stock,
      movements,
      suppliers,
      members,
      contracts,
      visits,
      plants,
      charges,
      chargeLines,
      carePayments,
    ] = await Promise.all([
      tx.customer.findMany({ where, orderBy: { createdAt: 'asc' } }),
      tx.customerAddress.findMany({ where, orderBy: { createdAt: 'asc' } }),
      tx.customerOccasion.findMany({ where, orderBy: [{ month: 'asc' }, { day: 'asc' }] }),
      tx.catalogItem.findMany({ where, orderBy: { name: 'asc' } }),
      tx.bouquetRecipeLine.findMany({
        where,
        orderBy: [{ recipeId: 'asc' }, { sortOrder: 'asc' }],
        select: {
          quantity: true,
          ingredientItemId: true,
          recipe: { select: { catalogItemId: true } },
        },
      }),
      tx.quote.findMany({ where, orderBy: { number: 'asc' } }),
      tx.quoteLine.findMany({ where, orderBy: [{ quoteId: 'asc' }, { sortOrder: 'asc' }] }),
      tx.order.findMany({ where, orderBy: { number: 'asc' } }),
      tx.orderLine.findMany({ where, orderBy: [{ orderId: 'asc' }, { sortOrder: 'asc' }] }),
      tx.orderPayment.findMany({ where, orderBy: { createdAt: 'asc' } }),
      tx.inventoryItem.findMany({ where }),
      tx.inventoryMovement.findMany({ where, orderBy: { createdAt: 'asc' } }),
      tx.supplier.findMany({ where, orderBy: { name: 'asc' } }),
      tx.membership.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: {
          role: true,
          status: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
      tx.customerSubscription.findMany({ where, orderBy: { number: 'asc' } }),
      tx.careVisit.findMany({ where, orderBy: [{ scheduledDate: 'asc' }] }),
      tx.carePlant.findMany({ where, orderBy: [{ subscriptionId: 'asc' }, { sortOrder: 'asc' }] }),
      tx.careCharge.findMany({ where, orderBy: { number: 'asc' } }),
      tx.careChargeLine.findMany({ where, orderBy: [{ chargeId: 'asc' }, { position: 'asc' }] }),
      tx.carePayment.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        include: { allocations: { select: { chargeId: true, amountMinor: true } } },
      }),
    ]);
    return {
      customers,
      addresses,
      occasions,
      items,
      recipeLines,
      quotes,
      quoteLines,
      orders,
      orderLines,
      payments,
      stock,
      movements,
      suppliers,
      members,
      contracts,
      visits,
      plants,
      charges,
      chargeLines,
      carePayments,
    };
  });

  const customerName = new Map(data.customers.map((row) => [row.id, row.displayName]));
  const itemName = new Map(data.items.map((row) => [row.id, row.name]));
  const supplierName = new Map(data.suppliers.map((row) => [row.id, row.name]));
  const quoteNumber = new Map(data.quotes.map((row) => [row.id, formatQuoteNumber(row.number)]));
  const orderNumber = new Map(data.orders.map((row) => [row.id, formatOrderNumber(row.number)]));
  const contractNumber = new Map(
    data.contracts.map((row) => [row.id, formatSubscriptionNumber(row.number)]),
  );
  const stockItem = new Map(data.stock.map((row) => [row.id, row.catalogItemId]));
  const chargeNumber = new Map(
    data.charges.map((row) => [row.id, formatCareChargeNumber(row.number)]),
  );
  const today = todayInTimeZone(ctx.timezone);

  type Customer = (typeof data.customers)[number];
  type Address = (typeof data.addresses)[number];
  type Occasion = (typeof data.occasions)[number];
  type Item = (typeof data.items)[number];
  type RecipeLine = (typeof data.recipeLines)[number];
  type Quote = (typeof data.quotes)[number];
  type QuoteLine = (typeof data.quoteLines)[number];
  type Order = (typeof data.orders)[number];
  type OrderLine = (typeof data.orderLines)[number];
  type Payment = (typeof data.payments)[number];
  type Stock = (typeof data.stock)[number];
  type Movement = (typeof data.movements)[number];
  type Supplier = (typeof data.suppliers)[number];
  type Member = (typeof data.members)[number];
  type Contract = (typeof data.contracts)[number];
  type Visit = (typeof data.visits)[number];
  type Plant = (typeof data.plants)[number];
  type Charge = (typeof data.charges)[number];
  type ChargeLine = (typeof data.chargeLines)[number];
  type CarePaymentRow = (typeof data.carePayments)[number];

  const sections: Section[] = [
    section<Customer>(
      'clientes.csv',
      'clientes',
      [
        { header: 'id', value: (r) => r.id },
        { header: 'Nombre', value: (r) => r.displayName },
        { header: 'Tipo', value: (r) => LABELS.customerType[r.type] },
        { header: 'Razón social', value: (r) => r.legalName },
        { header: 'RFC', value: (r) => r.taxId },
        { header: 'Correo', value: (r) => r.email },
        { header: 'Teléfono', value: (r) => r.phone, numeric: true },
        { header: 'Etiquetas', value: (r) => r.tags.join(', ') },
        { header: 'Origen', value: (r) => LABELS.source[r.acquisitionSource] },
        { header: 'Cómo nos conoció', value: (r) => r.acquisitionChannel },
        { header: 'Acepta promociones', value: (r) => yesNo(r.marketingConsent) },
        { header: 'Preferencias', value: (r) => r.preferences },
        { header: 'Restricciones', value: (r) => r.restrictions },
        { header: 'Notas', value: (r) => r.notes },
        { header: 'Estado', value: (r) => LABELS.record[r.status] },
        { header: 'Creado', value: (r) => dateTime(r.createdAt) },
      ],
      data.customers,
    ),
    section<Address>(
      'direcciones.csv',
      'direcciones de los clientes',
      [
        { header: 'id', value: (r) => r.id },
        { header: 'cliente_id', value: (r) => r.customerId },
        { header: 'Cliente', value: (r) => customerName.get(r.customerId) },
        { header: 'Nombre de la dirección', value: (r) => r.label },
        { header: 'Recibe', value: (r) => r.recipientName },
        { header: 'Teléfono de quien recibe', value: (r) => r.recipientPhone, numeric: true },
        { header: 'Calle y número', value: (r) => r.addressLine1 },
        { header: 'Interior', value: (r) => r.addressLine2 },
        { header: 'Colonia', value: (r) => r.neighborhood },
        { header: 'Municipio', value: (r) => r.city },
        { header: 'Entidad federativa', value: (r) => region(r.region) },
        { header: 'Código postal', value: (r) => r.postalCode, numeric: true },
        { header: 'Referencias', value: (r) => r.deliveryNotes },
        { header: 'Principal', value: (r) => yesNo(r.isDefault) },
        { header: 'Estado del registro', value: (r) => LABELS.record[r.status] },
      ],
      data.addresses,
    ),
    section<Occasion>(
      'fechas_especiales.csv',
      'fechas especiales de los clientes',
      [
        { header: 'cliente_id', value: (r) => r.customerId },
        { header: 'Cliente', value: (r) => customerName.get(r.customerId) },
        { header: 'Tipo', value: (r) => LABELS.occasion[r.type] },
        { header: 'Nombre de la fecha', value: (r) => r.label },
        { header: 'Persona', value: (r) => r.personName },
        { header: 'Día', value: (r) => r.day, numeric: true },
        { header: 'Mes', value: (r) => r.month, numeric: true },
        { header: 'Año', value: (r) => r.year, numeric: true },
        { header: 'Notas', value: (r) => r.notes },
      ],
      data.occasions,
    ),
    section<Item>(
      'catalogo.csv',
      'productos y servicios del catálogo',
      [
        { header: 'id', value: (r) => r.id },
        { header: 'Nombre', value: (r) => r.name },
        { header: 'Tipo', value: (r) => LABELS.itemType[r.type] },
        { header: 'SKU', value: (r) => r.sku },
        { header: 'Descripción', value: (r) => r.description },
        { header: 'Unidad', value: (r) => LABELS.unit[r.saleUnit] },
        { header: 'Precio', value: (r) => money(r.priceMinor), numeric: true },
        { header: 'Costo', value: (r) => money(r.costMinor), numeric: true },
        { header: 'Moneda', value: (r) => r.currency },
        { header: 'Disponibilidad', value: (r) => LABELS.availability[r.availability] },
        { header: 'En la tienda en línea', value: (r) => yesNo(r.isOnline) },
        { header: 'Colores', value: (r) => r.colors.join(', ') },
        { header: 'Etiquetas', value: (r) => r.tags.join(', ') },
        // ADR-081: tempo di preparazione, proveedor habitual, durata e raggio dei servizi.
        { header: 'Tiempo de preparación (min)', value: (r) => r.prepMinutes, numeric: true },
        { header: 'proveedor_id', value: (r) => r.supplierId },
        {
          header: 'Proveedor habitual',
          value: (r) => (r.supplierId ? supplierName.get(r.supplierId) : null),
        },
        {
          header: 'Duración del servicio (min)',
          value: (r) => r.serviceDurationMinutes,
          numeric: true,
        },
        { header: 'Radio del servicio (km)', value: (r) => r.serviceRadiusKm, numeric: true },
        { header: 'Estado', value: (r) => LABELS.record[r.status] },
      ],
      data.items,
    ),
    section<RecipeLine>(
      'recetas.csv',
      'ingredientes de las recetas de los ramos',
      [
        { header: 'producto_id', value: (r) => r.recipe.catalogItemId },
        { header: 'Ramo', value: (r) => itemName.get(r.recipe.catalogItemId) },
        { header: 'ingrediente_id', value: (r) => r.ingredientItemId },
        { header: 'Ingrediente', value: (r) => itemName.get(r.ingredientItemId) },
        { header: 'Cantidad', value: (r) => r.quantity, numeric: true },
      ],
      data.recipeLines,
    ),
    section<Quote>(
      'cotizaciones.csv',
      'cotizaciones',
      [
        { header: 'Número', value: (r) => formatQuoteNumber(r.number) },
        { header: 'id', value: (r) => r.id },
        { header: 'cliente_id', value: (r) => r.customerId },
        { header: 'Cliente', value: (r) => customerName.get(r.customerId) },
        { header: 'Título', value: (r) => r.title },
        { header: 'Estado', value: (r) => LABELS.quoteStatus[r.status] },
        { header: 'Subtotal', value: (r) => money(r.subtotalMinor), numeric: true },
        { header: 'Descuento', value: (r) => money(r.discountMinor), numeric: true },
        { header: 'Total', value: (r) => money(r.totalMinor), numeric: true },
        { header: 'Moneda', value: (r) => r.currency },
        { header: 'Vigente hasta', value: (r) => day(r.validUntil) },
        { header: 'Notas', value: (r) => r.notes },
        { header: 'Creada', value: (r) => dateTime(r.createdAt) },
      ],
      data.quotes,
    ),
    section<QuoteLine>(
      'cotizaciones_conceptos.csv',
      'conceptos de cada cotización',
      [
        { header: 'Cotización', value: (r) => quoteNumber.get(r.quoteId) },
        { header: 'Concepto', value: (r) => r.description },
        { header: 'Tipo', value: (r) => LABELS.lineKind[r.kind] },
        { header: 'producto_id', value: (r) => r.catalogItemId },
        { header: 'Cantidad', value: (r) => r.quantity, numeric: true },
        { header: 'Precio unitario', value: (r) => money(r.unitPriceMinor), numeric: true },
        { header: 'Total', value: (r) => money(r.lineTotalMinor), numeric: true },
      ],
      data.quoteLines,
    ),
    section<Order>(
      'pedidos.csv',
      'pedidos',
      [
        { header: 'Número', value: (r) => formatOrderNumber(r.number) },
        { header: 'id', value: (r) => r.id },
        { header: 'cliente_id', value: (r) => r.customerId },
        { header: 'Cliente', value: (r) => customerName.get(r.customerId) },
        { header: 'Estado', value: (r) => LABELS.orderStatus[r.status] },
        { header: 'Entrega', value: (r) => LABELS.mode[r.fulfillmentMode] },
        { header: 'Fecha', value: (r) => day(r.scheduledDate) },
        { header: 'Desde', value: (r) => time(r.windowStartMinutes) },
        { header: 'Hasta', value: (r) => time(r.windowEndMinutes) },
        { header: 'Calle y número', value: (r) => r.deliveryAddressLine1 },
        { header: 'Interior', value: (r) => r.deliveryAddressLine2 },
        { header: 'Colonia', value: (r) => r.deliveryNeighborhood },
        { header: 'Municipio', value: (r) => r.deliveryCity },
        { header: 'Entidad federativa', value: (r) => region(r.deliveryRegion) },
        { header: 'Código postal', value: (r) => r.deliveryPostalCode, numeric: true },
        { header: 'Referencias', value: (r) => r.deliveryNotes },
        { header: 'Recibe', value: (r) => r.recipientName },
        { header: 'Teléfono de quien recibe', value: (r) => r.recipientPhone, numeric: true },
        { header: 'Mensaje de la tarjeta', value: (r) => r.cardMessage },
        { header: 'Firma de la tarjeta', value: (r) => r.cardSignature },
        { header: 'Notas internas', value: (r) => r.notes },
        { header: 'Subtotal', value: (r) => money(r.subtotalMinor), numeric: true },
        { header: 'Descuento', value: (r) => money(r.discountMinor), numeric: true },
        { header: 'Envío', value: (r) => money(r.deliveryFeeMinor), numeric: true },
        { header: 'Total', value: (r) => money(r.totalMinor), numeric: true },
        { header: 'Pagado', value: (r) => money(r.paidMinor), numeric: true },
        { header: 'Pago', value: (r) => LABELS.paymentStatus[r.paymentStatus] },
        { header: 'Moneda', value: (r) => r.currency },
        { header: 'Origen', value: (r) => LABELS.source[r.acquisitionSource] },
        { header: 'Pedido en línea', value: (r) => yesNo(r.placedOnline) },
        { header: 'Cotización', value: (r) => (r.quoteId ? quoteNumber.get(r.quoteId) : null) },
        { header: 'Motivo de cancelación', value: (r) => r.cancelReason },
        { header: 'Creado', value: (r) => dateTime(r.createdAt) },
      ],
      data.orders,
    ),
    section<OrderLine>(
      'pedidos_conceptos.csv',
      'conceptos de cada pedido',
      [
        { header: 'Pedido', value: (r) => orderNumber.get(r.orderId) },
        { header: 'Concepto', value: (r) => r.description },
        { header: 'Tipo', value: (r) => LABELS.lineKind[r.kind] },
        { header: 'producto_id', value: (r) => r.catalogItemId },
        { header: 'Cantidad', value: (r) => r.quantity, numeric: true },
        { header: 'Precio unitario', value: (r) => money(r.unitPriceMinor), numeric: true },
        { header: 'Total', value: (r) => money(r.lineTotalMinor), numeric: true },
      ],
      data.orderLines,
    ),
    section<Payment>(
      'pagos.csv',
      'pagos registrados en los pedidos',
      [
        { header: 'Pedido', value: (r) => orderNumber.get(r.orderId) },
        { header: 'Tipo', value: (r) => LABELS.paymentKind[r.kind] },
        { header: 'Forma de pago', value: (r) => LABELS.method[r.method] },
        // Le anulaciones restano il pagamento che annullano: importo negativo.
        {
          header: 'Importe',
          value: (r) => money(r.kind === 'REVERSAL' ? -r.amountMinor : r.amountMinor),
          numeric: true,
        },
        { header: 'Fecha', value: (r) => day(r.paidOn) },
        { header: 'Referencia', value: (r) => r.reference },
        { header: 'Registrado', value: (r) => dateTime(r.createdAt) },
      ],
      data.payments,
    ),
    section<Stock>(
      'inventario.csv',
      'existencias',
      [
        { header: 'producto_id', value: (r) => r.catalogItemId },
        { header: 'Producto', value: (r) => itemName.get(r.catalogItemId) },
        { header: 'Existencias', value: (r) => r.onHand, numeric: true },
        { header: 'Mínimo', value: (r) => r.minQuantity, numeric: true },
        { header: 'Costo promedio', value: (r) => money(r.avgUnitCostMinor), numeric: true },
        { header: 'Estado', value: (r) => LABELS.record[r.status] },
      ],
      data.stock,
    ),
    section<Movement>(
      'movimientos_inventario.csv',
      'entradas y salidas del inventario',
      [
        { header: 'Fecha', value: (r) => dateTime(r.createdAt) },
        { header: 'Producto', value: (r) => itemName.get(stockItem.get(r.inventoryItemId) ?? '') },
        { header: 'Tipo', value: (r) => LABELS.inventoryKind[r.kind] },
        { header: 'Cantidad', value: (r) => r.quantity, numeric: true },
        { header: 'Existencias después', value: (r) => r.balanceAfter, numeric: true },
        { header: 'Costo unitario', value: (r) => money(r.unitCostMinor), numeric: true },
        { header: 'Costo total', value: (r) => money(r.totalCostMinor), numeric: true },
      ],
      data.movements,
    ),
    section<Supplier>(
      'proveedores.csv',
      'proveedores',
      [
        { header: 'Nombre', value: (r) => r.name },
        { header: 'Teléfono', value: (r) => r.phone, numeric: true },
        { header: 'Notas', value: (r) => r.notes },
        { header: 'Estado', value: (r) => LABELS.record[r.status] },
      ],
      data.suppliers,
    ),
    section<Member>(
      'equipo.csv',
      'personas del equipo',
      [
        { header: 'Nombre', value: (r) => r.user.name },
        { header: 'Correo', value: (r) => r.user.email },
        { header: 'Rol', value: (r) => LABELS.role[r.role] },
        { header: 'Estado', value: (r) => LABELS.memberStatus[r.status] },
        { header: 'Desde', value: (r) => day(r.createdAt) },
      ],
      data.members,
    ),
    section<Contract>(
      'floral_care_contratos.csv',
      'contratos de Floral Care y entregas periódicas',
      [
        { header: 'Número', value: (r) => formatSubscriptionNumber(r.number) },
        { header: 'cliente_id', value: (r) => r.customerId },
        { header: 'Cliente', value: (r) => customerName.get(r.customerId) },
        { header: 'Tipo', value: (r) => LABELS.contractKind[r.kind] },
        { header: 'Estado', value: (r) => LABELS.contractStatus[r.status] },
        {
          header: 'Frecuencia',
          value: (r) => (r.frequency ? LABELS.frequency[r.frequency] : null),
        },
        { header: 'Inicio', value: (r) => day(r.startDate) },
        { header: 'Fin', value: (r) => day(r.endDate) },
        { header: 'Precio por visita', value: (r) => money(r.perVisitMinor), numeric: true },
        { header: 'Cargo único', value: (r) => money(r.oneTimeMinor), numeric: true },
        { header: 'Contacto', value: (r) => r.contactName },
        { header: 'Teléfono de contacto', value: (r) => r.contactPhone, numeric: true },
        { header: 'Acceso', value: (r) => r.accessNotes },
        { header: 'Notas', value: (r) => r.notes },
      ],
      data.contracts,
    ),
    section<Visit>(
      'floral_care_visitas.csv',
      'visitas de Floral Care',
      [
        { header: 'Contrato', value: (r) => contractNumber.get(r.subscriptionId) },
        { header: 'Fecha', value: (r) => day(r.scheduledDate ?? r.originalDate) },
        { header: 'Desde', value: (r) => time(r.startMinutes) },
        { header: 'Hasta', value: (r) => time(r.endMinutes) },
        { header: 'Estado', value: (r) => LABELS.visitStatus[r.status] },
        { header: 'Visita extra', value: (r) => yesNo(r.isExtra) },
        { header: 'Resultado', value: (r) => r.outcomeNote },
      ],
      data.visits,
    ),
    section<Plant>(
      'floral_care_plantas.csv',
      'plantas en las sedes de los clientes',
      [
        { header: 'Contrato', value: (r) => contractNumber.get(r.subscriptionId) },
        { header: 'Planta', value: (r) => r.name },
        { header: 'Cantidad', value: (r) => r.quantity, numeric: true },
        { header: 'Tamaño', value: (r) => LABELS.plantSize[r.size] },
        { header: 'Ubicación', value: (r) => r.location },
        { header: 'Riego', value: (r) => r.watering },
        { header: 'Cuidados', value: (r) => r.instructions },
        { header: 'Estado', value: (r) => LABELS.record[r.status] },
      ],
      data.plants,
    ),
    // Cargos e pagamenti di Floral Care (ADR-082): lo stato si calcola nel giorno della fioreria,
    // come in "Cobros".
    section<Charge>(
      'floral_care_cargos.csv',
      'cargos mensuales de Floral Care',
      [
        { header: 'Número', value: (r) => formatCareChargeNumber(r.number) },
        { header: 'id', value: (r) => r.id },
        { header: 'Contrato', value: (r) => contractNumber.get(r.subscriptionId) },
        { header: 'cliente_id', value: (r) => r.customerId },
        { header: 'Cliente', value: (r) => customerName.get(r.customerId) },
        { header: 'Mes', value: (r) => day(r.period)?.slice(0, 7) ?? null },
        { header: 'Emitido', value: (r) => day(r.issuedOn) },
        { header: 'Vence', value: (r) => day(r.dueDate) },
        { header: 'Precio por visita', value: (r) => money(r.unitPriceMinor), numeric: true },
        { header: 'Total', value: (r) => money(r.totalMinor), numeric: true },
        { header: 'Pagado', value: (r) => money(r.paidMinor), numeric: true },
        { header: 'Saldo', value: (r) => money(r.balanceMinor), numeric: true },
        {
          header: 'Estado',
          value: (r) =>
            LABELS.chargeStatus[
              careChargeStatus({
                totalMinor: r.totalMinor,
                paidMinor: r.paidMinor,
                dueDate: requiredParts(r.dueDate),
                today,
              })
            ],
        },
        { header: 'Cargo final', value: (r) => yesNo(r.final) },
        { header: 'Moneda', value: (r) => r.currency },
      ],
      data.charges,
    ),
    section<ChargeLine>(
      'floral_care_cargos_conceptos.csv',
      'conceptos de cada cargo de Floral Care',
      [
        { header: 'Cargo', value: (r) => chargeNumber.get(r.chargeId) },
        { header: 'Concepto', value: (r) => LABELS.chargeLineKind[r.kind] },
        { header: 'Descripción', value: (r) => r.label },
        { header: 'Fecha de la visita', value: (r) => day(r.visitDate) },
        {
          header: 'Motivo',
          value: (r) => (r.creditReason ? LABELS.creditReason[r.creditReason] : null),
        },
        {
          header: 'Cargo de origen',
          value: (r) => (r.sourceChargeId ? chargeNumber.get(r.sourceChargeId) : null),
        },
        { header: 'Cantidad', value: (r) => r.quantity, numeric: true },
        { header: 'Precio unitario', value: (r) => money(r.unitPriceMinor), numeric: true },
        { header: 'Importe', value: (r) => money(r.amountMinor), numeric: true },
      ],
      data.chargeLines,
    ),
    section<CarePaymentRow>(
      'floral_care_pagos.csv',
      'pagos de Floral Care (las anulaciones y devoluciones con importe negativo)',
      [
        { header: 'id', value: (r) => r.id },
        { header: 'Tipo', value: (r) => LABELS.carePaymentKind[r.kind] },
        { header: 'Estado', value: (r) => LABELS.carePaymentStatus[r.status] },
        { header: 'cliente_id', value: (r) => r.customerId },
        { header: 'Cliente', value: (r) => customerName.get(r.customerId) },
        { header: 'Fecha', value: (r) => day(r.paidOn) },
        { header: 'Forma de pago', value: (r) => LABELS.method[r.method] },
        // L'importo è già con il segno: le anulaciones e le devoluciones restano negative.
        { header: 'Importe', value: (r) => money(r.amountMinor), numeric: true },
        { header: 'Moneda', value: (r) => r.currency },
        {
          header: 'Cargos',
          value: (r) =>
            r.allocations
              .map((a) => `${chargeNumber.get(a.chargeId) ?? a.chargeId}: ${money(a.amountMinor)}`)
              .join('; ') || null,
        },
        { header: 'Anula el pago', value: (r) => r.reversedPaymentId },
        { header: 'Referencia', value: (r) => r.reference },
        { header: 'Nota', value: (r) => r.note },
        { header: 'Registrado', value: (r) => dateTime(r.createdAt) },
      ],
      data.carePayments,
    ),
  ];

  const exportedAt = dateTime(now) ?? '';
  const files: Record<string, Uint8Array> = {
    'LEEME.txt': strToU8(
      readme({
        shopName: ctx.tenantName,
        exportedAt,
        files: sections.map(({ name, what, rows }) => ({ name, what, rows })),
      }),
    ),
  };
  for (const item of sections) files[item.name] = strToU8(item.csv);
  const bytes = zipSync(files, { level: 6, mtime: now });

  const counts = Object.fromEntries(sections.map((item) => [item.name, item.rows]));
  await withTenantContext(getDb(), ctx, (tx) =>
    recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.tenantDataExported,
      entityType: 'Tenant',
      entityId: ctx.tenantId,
      metadata: { files: counts },
    }),
  );
  logger.info({ tenantId: ctx.tenantId, bytes: bytes.length }, 'dati della fioreria scaricati');
  return { fileName: `gardelia-${ctx.tenantSlug}-${exportedAt.slice(0, 10)}.zip`, bytes };
}
