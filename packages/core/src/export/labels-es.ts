/**
 * Testi dell'esportazione nella lingua del mercato (es-MX, ADR-079), come le email ai clienti:
 * sono i file del fiorista messicano, non l'interfaccia di chi li scarica. Gli stati usano le
 * stesse parole dell'app (`apps/web/messages/es-MX.json`). I tipi `Record` obbligano a tradurre
 * ogni valore nuovo di un enum.
 */
import type {
  AcquisitionSource,
  Availability,
  CareBlockAction,
  CareChargeLineKind,
  CareCreditReason,
  CareFrequency,
  CareMessageAuthor,
  CarePaymentKind,
  CarePaymentStatus,
  CarePortalInviteStatus,
  CarePortalRevokeReason,
  CareVisitStatus,
  CatalogItemType,
  CustomerSubscriptionKind,
  CustomerSubscriptionStatus,
  CustomerType,
  FulfillmentMode,
  InventoryEntryKind,
  MembershipRole,
  MembershipStatus,
  OccasionType,
  OrderPaymentKind,
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
  PlantSize,
  QuoteLineKind,
  QuoteStatus,
  RecordStatus,
  SaleUnit,
} from '@floral/db';
import type { CareChargeStatus } from '@floral/domain';

export const YES = 'sí';
export const NO = 'no';

export const LABELS = {
  customerType: { PERSON: 'Persona', COMPANY: 'Empresa' } satisfies Record<CustomerType, string>,
  source: {
    MERCHANT_DIRECT: 'Cliente propio',
    NETWORK_B2B: 'Gardelia Network',
    MARKETPLACE_B2C: 'Marketplace',
    IMPORT: 'Importado',
    MANUAL: 'Manual',
  } satisfies Record<AcquisitionSource, string>,
  record: { ACTIVE: 'Activo', ARCHIVED: 'Archivado' } satisfies Record<RecordStatus, string>,
  itemType: {
    CUT_FLOWER: 'Flor de corte',
    FOLIAGE: 'Follaje',
    PLANT: 'Planta',
    BOUQUET: 'Ramo',
    CONTAINER: 'Florero o maceta',
    PACKAGING: 'Empaque',
    ACCESSORY: 'Accesorio',
    SERVICE: 'Servicio',
    SERVICE_ADDON: 'Complemento de servicio',
  } satisfies Record<CatalogItemType, string>,
  unit: { STEM: 'tallo', BUNCH: 'manojo', PIECE: 'pieza', SERVICE: 'servicio' } satisfies Record<
    SaleUnit,
    string
  >,
  availability: {
    AVAILABLE: 'Disponible',
    LIMITED: 'Limitado',
    OUT_OF_STOCK: 'Agotado',
    ON_REQUEST: 'Bajo pedido',
  } satisfies Record<Availability, string>,
  quoteStatus: {
    DRAFT: 'Borrador',
    SENT: 'Enviada',
    ACCEPTED: 'Aceptada',
    REJECTED: 'Rechazada',
    EXPIRED: 'Vencida',
    CANCELLED: 'Cancelada',
  } satisfies Record<QuoteStatus, string>,
  lineKind: {
    CATALOG_ITEM: 'Catálogo',
    CUSTOM: 'Concepto libre',
    BUILDER: 'Diseñador',
  } satisfies Record<QuoteLineKind, string>,
  orderStatus: {
    DRAFT: 'Borrador',
    PENDING_ACCEPTANCE: 'Por aceptar',
    CONFIRMED: 'Confirmado',
    IN_PREPARATION: 'En preparación',
    READY: 'Listo',
    OUT_FOR_DELIVERY: 'En camino',
    DELIVERED: 'Entregado',
    PICKED_UP: 'Recogido',
    CANCELLED: 'Cancelado',
  } satisfies Record<OrderStatus, string>,
  mode: { DELIVERY: 'Envío a domicilio', PICKUP: 'Recoge en tienda' } satisfies Record<
    FulfillmentMode,
    string
  >,
  paymentStatus: { UNPAID: 'Sin pagar', PARTIAL: 'Anticipo', PAID: 'Pagado' } satisfies Record<
    OrderPaymentStatus,
    string
  >,
  paymentKind: {
    DEPOSIT: 'Anticipo',
    BALANCE: 'Pago',
    REVERSAL: 'Anulación',
    REFUND: 'Reembolso',
  } satisfies Record<OrderPaymentKind, string>,
  method: {
    CASH: 'Efectivo',
    TRANSFER: 'Transferencia',
    CARD_TERMINAL: 'Terminal (tarjeta)',
    PAYMENT_LINK: 'Link de pago',
    OTHER: 'Otro',
  } satisfies Record<PaymentMethod, string>,
  inventoryKind: {
    OPENING: 'Existencia inicial',
    PURCHASE: 'Compra',
    USE: 'Uso',
    WASTE: 'Merma',
    ADJUSTMENT: 'Conteo',
    REVERSAL: 'Anulación',
  } satisfies Record<InventoryEntryKind, string>,
  role: { OWNER: 'Propietario', MANAGER: 'Gerente', STAFF: 'Equipo' } satisfies Record<
    MembershipRole,
    string
  >,
  memberStatus: { ACTIVE: 'Activo', SUSPENDED: 'Desactivado' } satisfies Record<
    MembershipStatus,
    string
  >,
  occasion: {
    BIRTHDAY: 'Cumpleaños',
    ANNIVERSARY: 'Aniversario',
    CUSTOM: 'Otra fecha',
  } satisfies Record<OccasionType, string>,
  contractKind: {
    CARE: 'Floral Care',
    DELIVERY: 'Entregas periódicas',
  } satisfies Record<CustomerSubscriptionKind, string>,
  contractStatus: {
    DRAFT: 'Borrador',
    ACTIVE: 'Activo',
    PAUSED: 'En pausa',
    ENDED: 'Terminado',
    CANCELLED: 'Cancelado',
  } satisfies Record<CustomerSubscriptionStatus, string>,
  frequency: {
    MONTHLY_1: 'Una vez al mes',
    MONTHLY_2: 'Dos veces al mes',
    WEEKLY: 'Cada semana',
  } satisfies Record<CareFrequency, string>,
  visitStatus: {
    SCHEDULED: 'Programada',
    IN_PROGRESS: 'En curso',
    DONE: 'Hecha',
    NOT_DONE: 'No se pudo',
    CANCELLED: 'Cancelada',
    TO_RESCHEDULE: 'Por reprogramar',
  } satisfies Record<CareVisitStatus, string>,
  plantSize: { SMALL: 'Chica', MEDIUM: 'Mediana', LARGE: 'Grande' } satisfies Record<
    PlantSize,
    string
  >,
  // Cargos e pagamenti di Floral Care (ADR-082), con le parole di "Cobros" e della pagina del cargo.
  chargeStatus: {
    PENDING: 'Pendiente',
    PARTIAL: 'Pago parcial',
    OVERDUE: 'Vencido',
    PAID: 'Pagado',
    NO_BALANCE: 'Sin saldo',
    IN_FAVOR: 'A favor del cliente',
    REFUNDED: 'Devuelto',
  } satisfies Record<CareChargeStatus, string>,
  chargeLineKind: {
    VISITS: 'Visitas del mes',
    VISIT_DEBIT: 'Visita que no estaba en un cargo',
    VISIT_CREDIT: 'Crédito por una visita',
    EXTRA_VISIT: 'Visita extra',
    ONE_TIME_SERVICE: 'Servicio de una sola vez',
    CREDIT_CARRIED_IN: 'Saldo a favor de un cargo anterior',
    CREDIT_CARRIED_OUT: 'Saldo a favor que pasa al próximo cargo',
    ADJUSTMENT: 'Ajuste',
  } satisfies Record<CareChargeLineKind, string>,
  creditReason: {
    TO_RESCHEDULE: 'Por reprogramar',
    SHOP: 'La quitó la florería',
    SCHEDULE_CHANGE: 'Cambio de horario',
    CONTRACT_END: 'Fin del contrato',
    NOT_DONE: 'No pudimos ir',
    CUSTOMER: 'El cliente avisó a tiempo',
  } satisfies Record<CareCreditReason, string>,
  careBlockAction: {
    MOVE: 'Se mueven a otro día',
    CANCEL: 'Se cancelan sin cobrar',
  } satisfies Record<CareBlockAction, string>,
  careBlockWholeDay: 'Todo el día',
  carePortalInviteStatus: {
    PENDING: 'Pendiente',
    ACCEPTED: 'Aceptada',
    REVOKED: 'Revocada',
    EXPIRED: 'Vencida',
  } satisfies Record<CarePortalInviteStatus, string>,
  carePortalRevokeReason: {
    MANUAL: 'Quitado por la florería',
    CUSTOMER_ARCHIVED: 'Cliente archivado',
    CONTRACT_ENDED: 'Contrato terminado',
  } satisfies Record<CarePortalRevokeReason, string>,
  carePortalAllContracts: 'Todos los contratos del cliente',
  careMessageAuthor: {
    CUSTOMER: 'Cliente',
    SHOP: 'Florería',
  } satisfies Record<CareMessageAuthor, string>,
  careMessageDeletedAuthor: 'Cuenta eliminada',
  /** Messaggi degli ordini online (M3). */
  orderMessageAuthor: { BUYER: 'Cliente', SHOP: 'Florería' },
  /** M3-2: domande «sì / no» e risposte nei messaggi, e lo stato dei cambi da confermare. */
  orderMessageKind: { MESSAGE: 'Mensaje', QUESTION: 'Pregunta (sí / no)', ANSWER: 'Respuesta' },
  orderQuestionAnswer: { YES: 'Sí', NO: 'No' },
  orderChangeStatus: {
    EDITING: 'En cambio',
    ASKED: 'Esperando al cliente',
    CONFIRMED: 'Confirmados',
    DECLINED: 'No aceptados',
  },
  careMessagePhotoGone: 'quitada',
  /** M3-3: prove di pagamento e contanti di chi consegna. */
  moneyReviewStatus: { PENDING: 'En revisión', CONFIRMED: 'Confirmado', REJECTED: 'Rechazado' },
  proofPhotoDeleted: 'borrada',
  carePaymentKind: {
    PAYMENT: 'Pago',
    REVERSAL: 'Anulación',
    REFUND: 'Devolución',
  } satisfies Record<CarePaymentKind, string>,
  carePaymentStatus: {
    RECORDED: 'Registrado',
    PENDING: 'Por registrar',
    REJECTED: 'Rechazado',
  } satisfies Record<CarePaymentStatus, string>,
} as const;

/** Il file che spiega lo ZIP, in testa all'archivio. */
export function readme(input: {
  readonly shopName: string;
  readonly exportedAt: string;
  readonly files: readonly {
    readonly name: string;
    readonly rows: number;
    readonly what: string;
  }[];
}): string {
  return [
    `Datos de ${input.shopName}`,
    `Descargados el ${input.exportedAt} desde Gardelia.`,
    '',
    'Cada archivo .csv se abre con Excel, Numbers o Google Sheets. Los importes están en pesos,',
    'con punto decimal; las fechas, en la zona horaria de tu florería. La columna "id" sirve para',
    'relacionar archivos (por ejemplo, el cliente de cada pedido).',
    '',
    'Archivos:',
    ...input.files.map((file) => `- ${file.name}: ${file.what} (${file.rows})`),
    '',
    'No incluye las fotos (catálogo, ramos, entregas, visitas), las imágenes del Diseñador ni el',
    'registro de actividad. Los datos siguen en Gardelia: descargarlos no borra nada.',
    '',
  ].join('\r\n');
}
