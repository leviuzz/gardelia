-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "bouquetPhotoId" UUID;

-- CreateTable
CREATE TABLE "BouquetPhoto" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BouquetPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BouquetPhoto_tenantId_configurationId_status_idx" ON "BouquetPhoto"("tenantId", "configurationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BouquetPhoto_tenantId_id_key" ON "BouquetPhoto"("tenantId", "id");

-- CreateIndex
CREATE INDEX "QuoteLine_tenantId_bouquetPhotoId_idx" ON "QuoteLine"("tenantId", "bouquetPhotoId");

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_tenantId_bouquetPhotoId_fkey" FOREIGN KEY ("tenantId", "bouquetPhotoId") REFERENCES "BouquetPhoto"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BouquetPhoto" ADD CONSTRAINT "BouquetPhoto_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BouquetPhoto" ADD CONSTRAINT "BouquetPhoto_tenantId_configurationId_fkey" FOREIGN KEY ("tenantId", "configurationId") REFERENCES "BouquetConfiguration"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dati della fioreria: isolamento per tenant (RLS FORCE).
SELECT app_enable_tenant_rls('"BouquetPhoto"');

-- Una sola foto ATTIVA per disegno: le precedenti restano archiviate per i preventivi.
CREATE UNIQUE INDEX "BouquetPhoto_one_active_per_configuration"
  ON "BouquetPhoto"("tenantId", "configurationId") WHERE "status" = 'ACTIVE';

-- Solo le righe nate dal Builder hanno la foto del ramo.
ALTER TABLE "QuoteLine"
  ADD CONSTRAINT "QuoteLine_photo_builder_check" CHECK ("bouquetPhotoId" IS NULL OR "kind" = 'BUILDER');
