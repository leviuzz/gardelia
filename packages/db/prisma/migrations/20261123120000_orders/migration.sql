-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_ACCEPTANCE', 'CONFIRMED', 'IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PICKED_UP', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FulfillmentMode" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD_TERMINAL', 'PAYMENT_LINK', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderPaymentKind" AS ENUM ('DEPOSIT', 'BALANCE', 'REVERSAL');

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customerId" UUID NOT NULL,
    "quoteId" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" CHAR(3) NOT NULL,
    "fulfillmentMode" "FulfillmentMode" NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "windowStartMinutes" INTEGER,
    "windowEndMinutes" INTEGER,
    "customerAddressId" UUID,
    "deliveryAddressLine1" TEXT,
    "deliveryAddressLine2" TEXT,
    "deliveryNeighborhood" TEXT,
    "deliveryCity" TEXT,
    "deliveryRegion" TEXT,
    "deliveryPostalCode" TEXT,
    "deliveryCountryCode" CHAR(2),
    "deliveryNotes" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "cardMessage" TEXT,
    "cardSignature" TEXT,
    "cardAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "subtotalMinor" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "acquisitionSource" "AcquisitionSource" NOT NULL DEFAULT 'MERCHANT_DIRECT',
    "cancelReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "kind" "QuoteLineKind" NOT NULL DEFAULT 'CATALOG_ITEM',
    "catalogItemId" UUID,
    "bouquetConfigurationId" UUID,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "unitCostMinor" INTEGER,
    "lineTotalMinor" INTEGER NOT NULL,
    "snapshot" JSONB,
    "previewJobId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPayment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "kind" "OrderPaymentKind" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT,
    "reversedPaymentId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_tenantId_status_idx" ON "Order"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Order_tenantId_scheduledDate_idx" ON "Order"("tenantId", "scheduledDate");

-- CreateIndex
CREATE INDEX "Order_tenantId_customerId_idx" ON "Order"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_id_key" ON "Order"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_number_key" ON "Order"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_quoteId_key" ON "Order"("tenantId", "quoteId");

-- CreateIndex
CREATE INDEX "OrderLine_tenantId_orderId_idx" ON "OrderLine"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "OrderLine_tenantId_bouquetConfigurationId_idx" ON "OrderLine"("tenantId", "bouquetConfigurationId");

-- CreateIndex
CREATE INDEX "OrderLine_tenantId_previewJobId_idx" ON "OrderLine"("tenantId", "previewJobId");

-- CreateIndex
CREATE INDEX "OrderPayment_tenantId_orderId_idx" ON "OrderPayment"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPayment_tenantId_id_key" ON "OrderPayment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPayment_tenantId_reversedPaymentId_key" ON "OrderPayment"("tenantId", "reversedPaymentId");

-- CreateIndex
CREATE INDEX "OrderStatusEvent_tenantId_orderId_createdAt_idx" ON "OrderStatusEvent"("tenantId", "orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "Quote"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_customerAddressId_fkey" FOREIGN KEY ("tenantId", "customerAddressId") REFERENCES "CustomerAddress"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_tenantId_catalogItemId_fkey" FOREIGN KEY ("tenantId", "catalogItemId") REFERENCES "CatalogItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_tenantId_bouquetConfigurationId_fkey" FOREIGN KEY ("tenantId", "bouquetConfigurationId") REFERENCES "BouquetConfiguration"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_tenantId_previewJobId_fkey" FOREIGN KEY ("tenantId", "previewJobId") REFERENCES "AiJob"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_tenantId_reversedPaymentId_fkey" FOREIGN KEY ("tenantId", "reversedPaymentId") REFERENCES "OrderPayment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================
-- Sicurezza e integrità (ADR-052)
-- =============================================================================

SELECT app_enable_tenant_rls('"Order"');
SELECT app_enable_tenant_rls('"OrderLine"');
SELECT app_enable_tenant_rls('"OrderPayment"');
SELECT app_enable_tenant_rls('"OrderStatusEvent"');

-- Coerenza monetaria e di stato garantita dal database (anche in caso di bug applicativi).
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_number_check" CHECK ("number" > 0),
  ADD CONSTRAINT "Order_amounts_check" CHECK (
    "subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "discountMinor" <= "subtotalMinor"
    AND "deliveryFeeMinor" >= 0 AND "taxMinor" >= 0 AND "paidMinor" >= 0
  ),
  ADD CONSTRAINT "Order_total_consistency_check"
    CHECK ("totalMinor" = "subtotalMinor" - "discountMinor" + "deliveryFeeMinor" + "taxMinor"),
  -- Stato del pagamento sempre coerente con importo pagato e totale.
  ADD CONSTRAINT "Order_payment_status_check" CHECK (
    "paymentStatus" = (CASE
      WHEN "totalMinor" <= 0 THEN 'PAID'
      WHEN "paidMinor" <= 0 THEN 'UNPAID'
      WHEN "paidMinor" >= "totalMinor" THEN 'PAID'
      ELSE 'PARTIAL'
    END)::"OrderPaymentStatus"
  ),
  -- Fascia oraria: entrambi gli estremi o nessuno, dentro la giornata e in ordine.
  ADD CONSTRAINT "Order_window_check" CHECK (
    ("windowStartMinutes" IS NULL AND "windowEndMinutes" IS NULL)
    OR ("windowStartMinutes" >= 0 AND "windowEndMinutes" <= 1440
        AND "windowStartMinutes" < "windowEndMinutes")
  ),
  -- Una consegna a domicilio ha sempre un indirizzo completo.
  ADD CONSTRAINT "Order_delivery_address_check" CHECK (
    "fulfillmentMode" <> 'DELIVERY' OR (
      "deliveryAddressLine1" IS NOT NULL AND "deliveryCity" IS NOT NULL
      AND "deliveryRegion" IS NOT NULL AND "deliveryPostalCode" IS NOT NULL
      AND "deliveryCountryCode" IS NOT NULL
    )
  ),
  -- Il ritiro in negozio non si consegna e non ha costo di consegna.
  ADD CONSTRAINT "Order_pickup_check" CHECK (
    "fulfillmentMode" <> 'PICKUP' OR (
      "deliveryFeeMinor" = 0 AND "status" NOT IN ('OUT_FOR_DELIVERY', 'DELIVERED')
    )
  ),
  ADD CONSTRAINT "Order_delivery_status_check" CHECK (
    "fulfillmentMode" <> 'DELIVERY' OR "status" <> 'PICKED_UP'
  ),
  -- Un ordine annullato dice sempre perché; gli altri no.
  ADD CONSTRAINT "Order_cancel_reason_check" CHECK (("status" = 'CANCELLED') = ("cancelReason" IS NOT NULL));

ALTER TABLE "OrderLine"
  ADD CONSTRAINT "OrderLine_quantity_check" CHECK ("quantity" > 0 AND "unitPriceMinor" >= 0),
  ADD CONSTRAINT "OrderLine_total_consistency_check"
    CHECK ("lineTotalMinor" = "quantity" * "unitPriceMinor"),
  ADD CONSTRAINT "OrderLine_kind_item_check" CHECK (
    ("kind" = 'CATALOG_ITEM' AND "catalogItemId" IS NOT NULL AND "bouquetConfigurationId" IS NULL)
    OR ("kind" = 'CUSTOM' AND "catalogItemId" IS NULL AND "bouquetConfigurationId" IS NULL)
    OR ("kind" = 'BUILDER' AND "catalogItemId" IS NULL AND "bouquetConfigurationId" IS NOT NULL)
  ),
  ADD CONSTRAINT "OrderLine_preview_builder_check" CHECK ("previewJobId" IS NULL OR "kind" = 'BUILDER');

-- Acconti e saldi positivi; lo storno è negativo e dice quale pagamento storna.
ALTER TABLE "OrderPayment"
  ADD CONSTRAINT "OrderPayment_amount_check" CHECK (
    ("kind" = 'REVERSAL' AND "amountMinor" < 0 AND "reversedPaymentId" IS NOT NULL)
    OR ("kind" <> 'REVERSAL' AND "amountMinor" > 0 AND "reversedPaymentId" IS NULL)
  );
