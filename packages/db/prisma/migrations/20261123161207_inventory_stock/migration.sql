-- CreateEnum
CREATE TYPE "InventoryEntryKind" AS ENUM ('OPENING', 'PURCHASE', 'USE', 'WASTE', 'ADJUSTMENT', 'REVERSAL');

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "avgUnitCostMinor" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "minQuantity" INTEGER,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "InventoryEntryKind" NOT NULL,
    "note" TEXT,
    "reversesEntryId" UUID,
    "createdById" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "kind" "InventoryEntryKind" NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "unitCostMinor" INTEGER,
    "expectedUnitCostMinor" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItem_tenantId_status_idx" ON "InventoryItem"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_tenantId_id_key" ON "InventoryItem"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_tenantId_catalogItemId_key" ON "InventoryItem"("tenantId", "catalogItemId");

-- CreateIndex
CREATE INDEX "InventoryEntry_tenantId_occurredAt_idx" ON "InventoryEntry"("tenantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryEntry_tenantId_id_key" ON "InventoryEntry"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryEntry_tenantId_id_kind_key" ON "InventoryEntry"("tenantId", "id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryEntry_tenantId_reversesEntryId_key" ON "InventoryEntry"("tenantId", "reversesEntryId");

-- CreateIndex
CREATE INDEX "InventoryMovement_tenantId_inventoryItemId_createdAt_idx" ON "InventoryMovement"("tenantId", "inventoryItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_tenantId_id_key" ON "InventoryMovement"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_tenantId_entryId_inventoryItemId_key" ON "InventoryMovement"("tenantId", "entryId", "inventoryItemId");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_tenantId_catalogItemId_fkey" FOREIGN KEY ("tenantId", "catalogItemId") REFERENCES "CatalogItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEntry" ADD CONSTRAINT "InventoryEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEntry" ADD CONSTRAINT "InventoryEntry_tenantId_reversesEntryId_fkey" FOREIGN KEY ("tenantId", "reversesEntryId") REFERENCES "InventoryEntry"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_tenantId_entryId_kind_fkey" FOREIGN KEY ("tenantId", "entryId", "kind") REFERENCES "InventoryEntry"("tenantId", "id", "kind") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_tenantId_inventoryItemId_fkey" FOREIGN KEY ("tenantId", "inventoryItemId") REFERENCES "InventoryItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Sicurezza e integrità dell'inventario (ADR-060)
-- =============================================================================

-- Prodotti controllati: policy standard del tenant (la giacenza si aggiorna insieme ai movimenti).
SELECT app_enable_tenant_rls('"InventoryItem"');

-- Registri e movimenti: per l'applicazione solo lettura e inserimento, come il registro di audit.
-- Uno sbaglio si annulla con un registro REVERSAL: mai UPDATE né DELETE.
ALTER TABLE "InventoryEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_entry_select ON "InventoryEntry" FOR SELECT
  USING ("tenantId" = app_current_tenant_id() OR app_rls_bypass());
CREATE POLICY inventory_entry_insert ON "InventoryEntry" FOR INSERT
  WITH CHECK ("tenantId" = app_current_tenant_id() OR app_rls_bypass());

ALTER TABLE "InventoryMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement" FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_movement_select ON "InventoryMovement" FOR SELECT
  USING ("tenantId" = app_current_tenant_id() OR app_rls_bypass());
CREATE POLICY inventory_movement_insert ON "InventoryMovement" FOR INSERT
  WITH CHECK ("tenantId" = app_current_tenant_id() OR app_rls_bypass());

-- Limiti e coerenza garantiti dal database (anche in caso di bug applicativi).
ALTER TABLE "InventoryItem"
  ADD CONSTRAINT "InventoryItem_on_hand_check" CHECK ("onHand" BETWEEN -1000000 AND 1000000),
  ADD CONSTRAINT "InventoryItem_cost_check"
    CHECK ("avgUnitCostMinor" IS NULL OR "avgUnitCostMinor" >= 0),
  ADD CONSTRAINT "InventoryItem_min_check"
    CHECK ("minQuantity" IS NULL OR "minQuantity" BETWEEN 0 AND 100000),
  ADD CONSTRAINT "InventoryItem_archived_check"
    CHECK (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL));

-- Solo un'anulación punta a un registro, e mai a se stessa.
ALTER TABLE "InventoryEntry"
  ADD CONSTRAINT "InventoryEntry_reversal_check"
    CHECK (("kind" = 'REVERSAL') = ("reversesEntryId" IS NOT NULL)),
  ADD CONSTRAINT "InventoryEntry_not_self_check"
    CHECK ("reversesEntryId" IS NULL OR "reversesEntryId" <> "id");

-- Il segno segue il tipo: existencia inicial e compra aggiungono, uso e merma tolgono, ajuste e
-- anulación in entrambi i sensi. Il tipo del movimento è quello del suo registro (FK composita).
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_quantity_check"
    CHECK ("quantity" <> 0 AND "quantity" BETWEEN -2000000 AND 2000000),
  ADD CONSTRAINT "InventoryMovement_sign_check" CHECK (CASE "kind"
    WHEN 'OPENING' THEN "quantity" > 0
    WHEN 'PURCHASE' THEN "quantity" > 0
    WHEN 'USE' THEN "quantity" < 0
    WHEN 'WASTE' THEN "quantity" < 0
    ELSE true
  END),
  ADD CONSTRAINT "InventoryMovement_balance_check"
    CHECK ("balanceAfter" BETWEEN -1000000 AND 1000000),
  ADD CONSTRAINT "InventoryMovement_cost_check" CHECK (
    ("unitCostMinor" IS NULL OR "unitCostMinor" >= 0)
    AND ("expectedUnitCostMinor" IS NULL OR "expectedUnitCostMinor" >= 0)
  );

-- -----------------------------------------------------------------------------
-- Piani: l'inventario è nel Plus (founder, 23/11/2026; domani nel Profesional, D-23). La tabella
-- ha FORCE RLS: la migrazione attiva il bypass solo per questi aggiornamenti.
-- -----------------------------------------------------------------------------

SELECT set_config('app.bypass_rls', 'on', false);
UPDATE "SaasPlan"
  SET "entitlements" = jsonb_set("entitlements", '{inventory}', 'true'::jsonb),
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "code" = 'PLUS';
UPDATE "SaasPlan"
  SET "entitlements" = jsonb_set("entitlements", '{inventory}', 'false'::jsonb),
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "code" = 'BASIC';
SELECT set_config('app.bypass_rls', '', false);
