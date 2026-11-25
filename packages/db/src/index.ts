export {
  createDbClient,
  disconnectDb,
  getDb,
  type CreateDbClientOptions,
  type DbClient,
} from './client';
export {
  checkRlsSafety,
  onSystemContext,
  withPortalContext,
  withPortalWriteContext,
  withSystemContext,
  withTenantContext,
  withUserContext,
  type PortalEntry,
  type PortalScope,
  type RlsSafetyReport,
  type TenantScope,
  type TransactionClient,
  type TransactionOptions,
} from './tenancy';
export {
  isForeignKeyViolation,
  isRecordNotFound,
  isRlsViolation,
  isUniqueViolation,
  sqlStateOf,
} from './errors';

// Tipi ed enum generati da Prisma (nessun accesso diretto al client).
export { Prisma } from './generated/prisma/client.ts';
export type {
  AuditLog,
  BouquetRecipe,
  BouquetRecipeLine,
  CanonicalFlower,
  CareEmail,
  CareFollowUp,
  CarePhoto,
  CarePlant,
  CareService,
  CareSettings,
  CareSlot,
  CareVisit,
  CareVisitMaterial,
  CareVisitPlantResult,
  CareVisitServiceResult,
  CatalogItem,
  Customer,
  CustomerSubscription,
  Invitation,
  Location,
  Membership,
  Tenant,
  User,
} from './generated/prisma/client.ts';
export * from './generated/prisma/enums.ts';
