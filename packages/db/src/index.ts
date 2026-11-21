export { createDbClient, disconnectDb, getDb, type CreateDbClientOptions, type DbClient } from './client';
export {
  checkRlsSafety,
  onSystemContext,
  withSystemContext,
  withTenantContext,
  withUserContext,
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
  CatalogItem,
  Customer,
  Invitation,
  Location,
  Membership,
  Tenant,
  User,
} from './generated/prisma/client.ts';
export * from './generated/prisma/enums.ts';
