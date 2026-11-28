/**
 * Pezzi comuni alle richieste dei servizi (M5, ADR-089) per chi compra e per la fioreria: cosa si
 * legge di una richiesta e come diventa il DTO. Le regole stanno nel dominio
 * (`storefront-services.ts`); qui solo la lettura.
 */
import type { Prisma } from '@floral/db';
import {
  formatServiceRequestNumber,
  parseServiceRequestAnswers,
  type ServiceDeclineReason,
  type ServiceRequestAnswers,
  type ServiceRequestStatus,
  type StorefrontServiceKind,
} from '@floral/domain';
import { dateToParts, formatDateParts } from './services/quote-internals';

export const serviceRequestSelect = {
  id: true,
  number: true,
  kind: true,
  status: true,
  statusChangedAt: true,
  createdAt: true,
  buyerUserId: true,
  customerId: true,
  preferredDate: true,
  addressLine1: true,
  addressLine2: true,
  neighborhood: true,
  city: true,
  region: true,
  postalCode: true,
  addressNotes: true,
  currency: true,
  budgetMinor: true,
  contactPhone: true,
  message: true,
  answers: true,
  declineReasonCode: true,
  declineReason: true,
  service: { select: { id: true, kind: true, name: true } },
  photos: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, photoWidth: true, photoHeight: true, photoDeletedAt: true },
  },
} satisfies Prisma.ServiceRequestSelect;

export interface ServiceRequestPhotoDto {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** I file non ci sono più (30 giorni dopo la chiusura): si mostra «Foto eliminada». */
  readonly deleted: boolean;
}

export interface ServiceRequestDetailDto {
  readonly id: string;
  readonly number: number;
  readonly numberLabel: string;
  readonly kind: StorefrontServiceKind;
  readonly status: ServiceRequestStatus;
  readonly statusChangedAt: Date;
  readonly createdAt: Date;
  /** Il servizio chiesto; `name` solo per quelli della fioreria (i predefiniti dalla lingua). */
  readonly service: {
    readonly id: string;
    readonly kind: StorefrontServiceKind;
    readonly name: string | null;
  };
  /** `YYYY-MM-DD`, o null. */
  readonly preferredDate: string | null;
  readonly address: {
    readonly addressLine1: string;
    readonly addressLine2: string | null;
    readonly neighborhood: string | null;
    readonly city: string;
    readonly region: string;
    readonly postalCode: string;
    readonly notes: string | null;
  } | null;
  readonly currency: string;
  readonly budgetMinor: number | null;
  readonly contactPhone: string;
  readonly message: string | null;
  /** Le risposte del modulo (null se il JSON non è valido: non si mostra niente). */
  readonly answers: ServiceRequestAnswers | null;
  readonly declineReasonCode: ServiceDeclineReason | null;
  readonly declineReason: string | null;
  readonly photos: readonly ServiceRequestPhotoDto[];
}

type ServiceRequestRow = {
  readonly id: string;
  readonly number: number;
  readonly kind: string;
  readonly status: string;
  readonly statusChangedAt: Date;
  readonly createdAt: Date;
  readonly preferredDate: Date | null;
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly neighborhood: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postalCode: string | null;
  readonly addressNotes: string | null;
  readonly currency: string;
  readonly budgetMinor: number | null;
  readonly contactPhone: string;
  readonly message: string | null;
  readonly answers: unknown;
  readonly declineReasonCode: string | null;
  readonly declineReason: string | null;
  readonly service: { readonly id: string; readonly kind: string; readonly name: string | null };
  readonly photos: readonly {
    readonly id: string;
    readonly photoWidth: number;
    readonly photoHeight: number;
    readonly photoDeletedAt: Date | null;
  }[];
};

/** `YYYY-MM-DD` di una colonna `@db.Date`. */
export function isoDate(date: Date | null): string | null {
  return formatDateParts(dateToParts(date));
}

export function toServiceRequestDto(row: ServiceRequestRow): ServiceRequestDetailDto {
  return {
    id: row.id,
    number: row.number,
    numberLabel: formatServiceRequestNumber(row.number),
    kind: row.kind as StorefrontServiceKind,
    status: row.status as ServiceRequestStatus,
    statusChangedAt: row.statusChangedAt,
    createdAt: row.createdAt,
    service: {
      id: row.service.id,
      kind: row.service.kind as StorefrontServiceKind,
      name: row.service.name,
    },
    preferredDate: isoDate(row.preferredDate),
    address:
      row.addressLine1 && row.city && row.region && row.postalCode
        ? {
            addressLine1: row.addressLine1,
            addressLine2: row.addressLine2,
            neighborhood: row.neighborhood,
            city: row.city,
            region: row.region,
            postalCode: row.postalCode,
            notes: row.addressNotes,
          }
        : null,
    currency: row.currency,
    budgetMinor: row.budgetMinor,
    contactPhone: row.contactPhone,
    message: row.message,
    answers: parseServiceRequestAnswers(row.answers),
    declineReasonCode: row.declineReasonCode as ServiceDeclineReason | null,
    declineReason: row.declineReason,
    photos: row.photos.map((photo) => ({
      id: photo.id,
      width: photo.photoWidth,
      height: photo.photoHeight,
      deleted: photo.photoDeletedAt !== null,
    })),
  };
}
