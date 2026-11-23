-- Prova di consegna (ADR-058, blocco B2): foto del ramo finito e nome di chi lo riceve.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "handoverName" TEXT;

-- CreateTable
CREATE TABLE "OrderPhoto" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
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

    CONSTRAINT "OrderPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderPhoto_tenantId_orderId_status_idx" ON "OrderPhoto"("tenantId", "orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPhoto_tenantId_id_key" ON "OrderPhoto"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "OrderPhoto" ADD CONSTRAINT "OrderPhoto_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPhoto" ADD CONSTRAINT "OrderPhoto_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Sicurezza e integrità (ADR-058)
-- =============================================================================

SELECT app_enable_tenant_rls('"OrderPhoto"');

-- Una sola foto attiva per ordine: cambiandola, la precedente si archivia.
CREATE UNIQUE INDEX "OrderPhoto_one_active_per_order"
  ON "OrderPhoto"("tenantId", "orderId") WHERE "status" = 'ACTIVE';

ALTER TABLE "OrderPhoto"
  ADD CONSTRAINT "OrderPhoto_archived_check"
    CHECK (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL));

-- Il nome di chi riceve: breve e mai vuoto.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_handover_name_check"
    CHECK ("handoverName" IS NULL OR char_length(btrim("handoverName")) BETWEEN 1 AND 120);
