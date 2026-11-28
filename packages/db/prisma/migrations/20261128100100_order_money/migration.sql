-- Marketplace M3-3 «Soldi e squadra» (ADR-088): prove di pagamento di chi compra, contanti di chi
-- consegna, rimborsi sugli ordini annullati e lo staff che accetta gli ordini online.

-- AlterTable
ALTER TABLE "OnlineStore" ADD COLUMN     "staffCanAccept" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OrderPaymentProof" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "buyerUserId" UUID,
    "amountMinor" INTEGER NOT NULL,
    "note" TEXT,
    "photoKey" TEXT NOT NULL,
    "photoThumbKey" TEXT NOT NULL,
    "photoWidth" INTEGER NOT NULL,
    "photoHeight" INTEGER NOT NULL,
    "photoDeletedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentId" UUID,
    "rejectReason" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "submitKey" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPaymentProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCashCollection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "collectedByMembershipId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentId" UUID,
    "rejectReason" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "submitKey" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderCashCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderPaymentProof_tenantId_orderId_idx" ON "OrderPaymentProof"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "OrderPaymentProof_tenantId_status_idx" ON "OrderPaymentProof"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPaymentProof_tenantId_id_key" ON "OrderPaymentProof"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPaymentProof_tenantId_submitKey_key" ON "OrderPaymentProof"("tenantId", "submitKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPaymentProof_tenantId_paymentId_key" ON "OrderPaymentProof"("tenantId", "paymentId");

-- CreateIndex
CREATE INDEX "OrderCashCollection_tenantId_orderId_idx" ON "OrderCashCollection"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "OrderCashCollection_tenantId_status_idx" ON "OrderCashCollection"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCashCollection_tenantId_id_key" ON "OrderCashCollection"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCashCollection_tenantId_submitKey_key" ON "OrderCashCollection"("tenantId", "submitKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCashCollection_tenantId_paymentId_key" ON "OrderCashCollection"("tenantId", "paymentId");

-- AddForeignKey
ALTER TABLE "OrderPaymentProof" ADD CONSTRAINT "OrderPaymentProof_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPaymentProof" ADD CONSTRAINT "OrderPaymentProof_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPaymentProof" ADD CONSTRAINT "OrderPaymentProof_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPaymentProof" ADD CONSTRAINT "OrderPaymentProof_tenantId_paymentId_fkey" FOREIGN KEY ("tenantId", "paymentId") REFERENCES "OrderPayment"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCashCollection" ADD CONSTRAINT "OrderCashCollection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCashCollection" ADD CONSTRAINT "OrderCashCollection_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCashCollection" ADD CONSTRAINT "OrderCashCollection_tenantId_collectedByMembershipId_fkey" FOREIGN KEY ("tenantId", "collectedByMembershipId") REFERENCES "Membership"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCashCollection" ADD CONSTRAINT "OrderCashCollection_tenantId_paymentId_fkey" FOREIGN KEY ("tenantId", "paymentId") REFERENCES "OrderPayment"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Pagamenti: il rimborso è negativo e senza pagamento collegato (non è uno storno)
-- -----------------------------------------------------------------------------

ALTER TABLE "OrderPayment" DROP CONSTRAINT "OrderPayment_amount_check";
ALTER TABLE "OrderPayment"
  ADD CONSTRAINT "OrderPayment_amount_check" CHECK (
    ("kind" = 'REVERSAL' AND "amountMinor" < 0 AND "reversedPaymentId" IS NOT NULL)
    OR ("kind" = 'REFUND' AND "amountMinor" < 0 AND "reversedPaymentId" IS NULL)
    OR ("kind" IN ('DEPOSIT', 'BALANCE') AND "amountMinor" > 0 AND "reversedPaymentId" IS NULL)
  );

-- -----------------------------------------------------------------------------
-- Prove di pagamento: importo, nota, foto nella cartella della fioreria, stato coerente
-- -----------------------------------------------------------------------------

ALTER TABLE "OrderPaymentProof"
  ADD CONSTRAINT "OrderPaymentProof_values_check" CHECK (
    "amountMinor" BETWEEN 1 AND 1000000000
    AND ("note" IS NULL OR char_length("note") BETWEEN 1 AND 300)
    AND "photoKey" LIKE 'tenants/' || "tenantId"::text || '/order-payment-proofs/%'
    AND "photoThumbKey" LIKE 'tenants/' || "tenantId"::text || '/order-payment-proofs/%'
    AND "photoWidth" > 0
    AND "photoHeight" > 0
    AND "status" IN ('PENDING', 'CONFIRMED', 'REJECTED')
    AND (("status" = 'CONFIRMED') = ("paymentId" IS NOT NULL))
    AND (("status" = 'REJECTED') = ("rejectReason" IS NOT NULL))
    AND ("rejectReason" IS NULL OR char_length("rejectReason") BETWEEN 1 AND 300)
    AND (("status" = 'PENDING') = ("reviewedAt" IS NULL))
  );

-- Le foto ancora da cancellare (lavoro giornaliero).
CREATE INDEX "OrderPaymentProof_photo_pending_idx" ON "OrderPaymentProof" ("tenantId", "orderId")
  WHERE "photoDeletedAt" IS NULL;

-- -----------------------------------------------------------------------------
-- Contanti di chi consegna: importo, nota, stato coerente, uno in attesa per ordine
-- -----------------------------------------------------------------------------

ALTER TABLE "OrderCashCollection"
  ADD CONSTRAINT "OrderCashCollection_values_check" CHECK (
    "amountMinor" BETWEEN 1 AND 1000000000
    AND ("note" IS NULL OR char_length("note") BETWEEN 1 AND 300)
    AND "status" IN ('PENDING', 'CONFIRMED', 'REJECTED')
    AND (("status" = 'CONFIRMED') = ("paymentId" IS NOT NULL))
    AND (("status" = 'REJECTED') = ("rejectReason" IS NOT NULL))
    AND ("rejectReason" IS NULL OR char_length("rejectReason") BETWEEN 1 AND 300)
    AND (("status" = 'PENDING') = ("reviewedAt" IS NULL))
  );

CREATE UNIQUE INDEX "OrderCashCollection_pending_order_key" ON "OrderCashCollection" ("tenantId", "orderId")
  WHERE "status" = 'PENDING';

-- -----------------------------------------------------------------------------
-- Tenancy: RLS su tutte e due; chi compra tocca solo le prove del suo ordine (guardia)
-- -----------------------------------------------------------------------------

SELECT app_enable_tenant_rls('"OrderPaymentProof"');
SELECT app_enable_tenant_rls('"OrderCashCollection"');
SELECT app_enable_buyer_order_guard('"OrderPaymentProof"', 'orderId');

-- -----------------------------------------------------------------------------
-- Lavoro giornaliero: le foto delle prove da cancellare (solo ID), con la stessa regola delle foto
-- dei messaggi (`orderPhotosPurgeAfter`): ordine chiuso da almeno `retention_days` giorni, oppure
-- rimasto aperto `retention_days` giorni dopo la fine del suo giorno di consegna.
-- -----------------------------------------------------------------------------

CREATE FUNCTION app_order_payment_proof_photos_to_purge(retention_days integer, max_rows integer)
RETURNS TABLE (tenant_id uuid, proof_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  now_utc timestamp := now() AT TIME ZONE 'UTC';
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT p."tenantId", p.id
    FROM "OrderPaymentProof" p
    JOIN "Order" o ON o."tenantId" = p."tenantId" AND o.id = p."orderId"
    JOIN "Tenant" t ON t.id = p."tenantId"
    WHERE p."photoDeletedAt" IS NULL
      AND (
        (
          o.status IN ('DELIVERED', 'PICKED_UP', 'CANCELLED')
          AND o."statusChangedAt" + make_interval(days => retention_days) <= now_utc
        )
        OR (
          o.status NOT IN ('DELIVERED', 'PICKED_UP', 'CANCELLED')
          AND o."scheduledDate" IS NOT NULL
          AND (((o."scheduledDate" + 1)::timestamp AT TIME ZONE t.timezone) AT TIME ZONE 'UTC')
            + make_interval(days => retention_days) <= now_utc
        )
      )
    ORDER BY p."createdAt", p.id
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- «Scarica i miei dati»: le prove di pagamento caricate dalla persona, in tutte le fiorerie, senza
-- ID interni né foto. La persona arriva SOLO dal contesto, mai da un parametro.
CREATE FUNCTION app_buyer_order_payment_proofs()
RETURNS TABLE (
  shop_name text,
  order_number integer,
  created_at timestamp,
  amount_minor integer,
  currency text,
  note text,
  status text,
  reject_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  person uuid := app_current_user_id();
BEGIN
  IF person IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT t."displayName", o.number, p."createdAt", p."amountMinor", o.currency::text, p.note,
           p.status, p."rejectReason"
    FROM "OrderPaymentProof" p
    JOIN "Tenant" t ON t.id = p."tenantId"
    JOIN "Order" o ON o."tenantId" = p."tenantId" AND o.id = p."orderId"
    WHERE p."buyerUserId" = person
    ORDER BY p."createdAt", p.id
    LIMIT 5000;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
