-- Link pubblici di preventivi e ordini (ADR-056, blocco A3): il cliente vede il documento senza
-- account e accetta il preventivo. Il token non si salva: è firmato dal server (fioreria + ID).

-- CreateEnum
CREATE TYPE "PublicLinkKind" AS ENUM ('QUOTE', 'ORDER');

-- CreateTable
CREATE TABLE "PublicLink" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "PublicLinkKind" NOT NULL,
    "quoteId" UUID,
    "orderId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PublicLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicLink_tenantId_quoteId_idx" ON "PublicLink"("tenantId", "quoteId");

-- CreateIndex
CREATE INDEX "PublicLink_tenantId_orderId_idx" ON "PublicLink"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicLink_tenantId_id_key" ON "PublicLink"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "PublicLink" ADD CONSTRAINT "PublicLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicLink" ADD CONSTRAINT "PublicLink_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "Quote"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicLink" ADD CONSTRAINT "PublicLink_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Sicurezza e integrità (ADR-056)
-- =============================================================================

SELECT app_enable_tenant_rls('"PublicLink"');

ALTER TABLE "PublicLink"
  -- Un link punta a un solo documento, quello del suo tipo.
  ADD CONSTRAINT "PublicLink_target_check" CHECK (
    ("kind" = 'QUOTE' AND "quoteId" IS NOT NULL AND "orderId" IS NULL)
    OR ("kind" = 'ORDER' AND "orderId" IS NOT NULL AND "quoteId" IS NULL)
  ),
  ADD CONSTRAINT "PublicLink_dates_check" CHECK (
    "expiresAt" > "createdAt" AND ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
  );

-- Uno solo attivo per documento.
CREATE UNIQUE INDEX "PublicLink_active_quote_key"
  ON "PublicLink"("tenantId", "quoteId") WHERE "revokedAt" IS NULL AND "kind" = 'QUOTE';
CREATE UNIQUE INDEX "PublicLink_active_order_key"
  ON "PublicLink"("tenantId", "orderId") WHERE "revokedAt" IS NULL AND "kind" = 'ORDER';
