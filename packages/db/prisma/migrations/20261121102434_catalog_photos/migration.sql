-- CreateEnum
CREATE TYPE "CatalogPhotoView" AS ENUM ('FRONT', 'SIDE', 'TOP', 'DETAIL');

-- CreateTable
CREATE TABLE "CatalogItemPhoto" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "view" "CatalogPhotoView" NOT NULL DEFAULT 'FRONT',
    "color" TEXT,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItemPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleReferencePhoto" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "style" "BouquetStyle",
    "caption" TEXT,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentById" UUID NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleReferencePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogItemPhoto_tenantId_catalogItemId_status_sortOrder_idx" ON "CatalogItemPhoto"("tenantId", "catalogItemId", "status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItemPhoto_tenantId_id_key" ON "CatalogItemPhoto"("tenantId", "id");

-- CreateIndex
CREATE INDEX "StyleReferencePhoto_tenantId_status_createdAt_idx" ON "StyleReferencePhoto"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StyleReferencePhoto_tenantId_id_key" ON "StyleReferencePhoto"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "CatalogItemPhoto" ADD CONSTRAINT "CatalogItemPhoto_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemPhoto" ADD CONSTRAINT "CatalogItemPhoto_tenantId_catalogItemId_fkey" FOREIGN KEY ("tenantId", "catalogItemId") REFERENCES "CatalogItem"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleReferencePhoto" ADD CONSTRAINT "StyleReferencePhoto_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Row-Level Security (tabelle del tenant)
-- -----------------------------------------------------------------------------

SELECT app_enable_tenant_rls('"CatalogItemPhoto"');
SELECT app_enable_tenant_rls('"StyleReferencePhoto"');

-- -----------------------------------------------------------------------------
-- Vincoli: i file stanno sempre sotto la cartella del proprio tenant nell'archivio
-- (difesa in profondità contro chiavi di un'altra fioreria), misure e testi coerenti.
-- -----------------------------------------------------------------------------

ALTER TABLE "CatalogItemPhoto"
  ADD CONSTRAINT "CatalogItemPhoto_keys_check" CHECK (
    "storageKey" LIKE 'tenants/' || "tenantId"::text || '/catalog-photos/%'
    AND "thumbKey" LIKE 'tenants/' || "tenantId"::text || '/catalog-photos/%'
  ),
  ADD CONSTRAINT "CatalogItemPhoto_size_check" CHECK (
    "width" > 0 AND "height" > 0 AND "sizeBytes" > 0 AND "sortOrder" >= 0
  ),
  ADD CONSTRAINT "CatalogItemPhoto_color_check" CHECK ("color" IS NULL OR "color" ~ '^[a-z]{2,20}$');

ALTER TABLE "StyleReferencePhoto"
  ADD CONSTRAINT "StyleReferencePhoto_keys_check" CHECK (
    "storageKey" LIKE 'tenants/' || "tenantId"::text || '/style-references/%'
    AND "thumbKey" LIKE 'tenants/' || "tenantId"::text || '/style-references/%'
  ),
  ADD CONSTRAINT "StyleReferencePhoto_size_check" CHECK (
    "width" > 0 AND "height" > 0 AND "sizeBytes" > 0
  ),
  ADD CONSTRAINT "StyleReferencePhoto_caption_check" CHECK (
    "caption" IS NULL OR char_length("caption") <= 120
  );
