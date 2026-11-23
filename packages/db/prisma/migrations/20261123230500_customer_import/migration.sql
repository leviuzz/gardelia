-- CreateEnum
CREATE TYPE "CustomerImportStatus" AS ENUM ('DRAFT', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "CustomerImport" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "status" "CustomerImportStatus" NOT NULL DEFAULT 'DRAFT',
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerImport_tenantId_status_createdAt_idx" ON "CustomerImport"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerImport_tenantId_id_key" ON "CustomerImport"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "CustomerImport" ADD CONSTRAINT "CustomerImport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Import di clienti da CSV (ADR-070)
-- =============================================================================

SELECT app_enable_tenant_rls('"CustomerImport"');

ALTER TABLE "CustomerImport"
  ADD CONSTRAINT "CustomerImport_file_name_check"
    CHECK (char_length(btrim("fileName")) BETWEEN 1 AND 120),
  -- Il file (al massimo 512 KB) resta solo nelle bozze: importato o annullato, si svuota.
  ADD CONSTRAINT "CustomerImport_content_check"
    CHECK (char_length("content") <= 600000 AND ("status" = 'DRAFT' OR "content" = '')),
  ADD CONSTRAINT "CustomerImport_mapping_check"
    CHECK (jsonb_typeof("mapping") = 'array'),
  ADD CONSTRAINT "CustomerImport_counts_check"
    CHECK ("rowCount" BETWEEN 0 AND 1000 AND "importedCount" >= 0 AND "skippedCount" >= 0),
  -- Concluso (importato o annullato) se e solo se ha la data di conclusione.
  ADD CONSTRAINT "CustomerImport_completed_check"
    CHECK (("status" = 'DRAFT') = ("completedAt" IS NULL));
