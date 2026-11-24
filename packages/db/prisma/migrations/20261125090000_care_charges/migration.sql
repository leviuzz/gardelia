-- Floral Care, blocco 3a (ADR-082): cargos e pagamenti dei contratti.
--  - un cargo per contratto e mese (CAR-0001), con le sue righe; il cargo non cambia più;
--  - per ogni visita quanto è cobrado adesso (`CareVisitBilling`, tabella a parte: un cargo non
--    aggiorna mai la visita);
--  - movimenti di soldi del cliente (pagamenti, storni, devoluciones) distribuiti sui cargos;
--  - la causa di "No se pudo", il prezzo copiato dei servizi segnati, i "Días para pagar" e le
--    regole della fioreria copiate nel contratto alla conferma.
-- Solo enum nuovi: si usano subito nella stessa migrazione.

-- CreateEnum
CREATE TYPE "CareNotDoneCause" AS ENUM ('CUSTOMER', 'SHOP');

-- CreateEnum
CREATE TYPE "CareChargeLineKind" AS ENUM ('VISITS', 'VISIT_DEBIT', 'VISIT_CREDIT', 'EXTRA_VISIT', 'ONE_TIME_SERVICE', 'CREDIT_CARRIED_IN', 'CREDIT_CARRIED_OUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CareCreditReason" AS ENUM ('TO_RESCHEDULE', 'SHOP', 'SCHEDULE_CHANGE', 'CONTRACT_END', 'NOT_DONE');

-- CreateEnum
CREATE TYPE "CarePaymentKind" AS ENUM ('PAYMENT', 'REVERSAL', 'REFUND');

-- CreateEnum
CREATE TYPE "CarePaymentStatus" AS ENUM ('RECORDED', 'PENDING', 'REJECTED');

-- AlterTable
ALTER TABLE "CareSettings" ADD COLUMN     "paymentDueDays" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "CareVisit" ADD COLUMN     "notDoneCause" "CareNotDoneCause";

-- AlterTable
ALTER TABLE "CareVisitServiceResult" ADD COLUMN     "priceMinor" INTEGER;

-- AlterTable
ALTER TABLE "CustomerSubscription" ADD COLUMN     "chargedThrough" DATE,
ADD COLUMN     "deadPlantPolicy" "CareDeadPlantPolicy",
ADD COLUMN     "missedVisitPolicy" "CareMissedVisitPolicy";

-- CreateTable
CREATE TABLE "CareCharge" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "period" DATE NOT NULL,
    "issuedOn" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "priceVersion" INTEGER NOT NULL,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "balanceMinor" INTEGER NOT NULL,
    "final" BOOLEAN NOT NULL DEFAULT false,
    "issuedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareChargeLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "CareChargeLineKind" NOT NULL,
    "visitId" UUID,
    "visitDate" DATE,
    "serviceResultId" UUID,
    "serviceId" UUID,
    "sourceChargeId" UUID,
    "creditReason" "CareCreditReason",
    "label" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceMinor" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareChargeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareVisitBilling" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "billedMinor" INTEGER,
    "stableAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareVisitBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePayment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "kind" "CarePaymentKind" NOT NULL,
    "status" "CarePaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "visitId" UUID,
    "submitKey" UUID,
    "reversedPaymentId" UUID,
    "createdById" UUID,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePaymentAllocation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarePaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareCharge_tenantId_customerId_idx" ON "CareCharge"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "CareCharge_tenantId_period_idx" ON "CareCharge"("tenantId", "period");

-- CreateIndex
CREATE INDEX "CareCharge_tenantId_dueDate_idx" ON "CareCharge"("tenantId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CareCharge_tenantId_id_key" ON "CareCharge"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareCharge_tenantId_id_subscriptionId_key" ON "CareCharge"("tenantId", "id", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "CareCharge_tenantId_id_customerId_key" ON "CareCharge"("tenantId", "id", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CareCharge_tenantId_number_key" ON "CareCharge"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CareCharge_tenantId_subscriptionId_period_key" ON "CareCharge"("tenantId", "subscriptionId", "period");

-- CreateIndex
CREATE INDEX "CareChargeLine_tenantId_subscriptionId_kind_idx" ON "CareChargeLine"("tenantId", "subscriptionId", "kind");

-- CreateIndex
CREATE INDEX "CareChargeLine_tenantId_visitId_idx" ON "CareChargeLine"("tenantId", "visitId");

-- CreateIndex
CREATE INDEX "CareChargeLine_tenantId_sourceChargeId_idx" ON "CareChargeLine"("tenantId", "sourceChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "CareChargeLine_tenantId_id_key" ON "CareChargeLine"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareChargeLine_tenantId_chargeId_position_key" ON "CareChargeLine"("tenantId", "chargeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CareVisitBilling_tenantId_id_key" ON "CareVisitBilling"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareVisitBilling_tenantId_visitId_key" ON "CareVisitBilling"("tenantId", "visitId");

-- CreateIndex
CREATE INDEX "CarePayment_tenantId_customerId_idx" ON "CarePayment"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "CarePayment_tenantId_status_idx" ON "CarePayment"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CarePayment_tenantId_id_key" ON "CarePayment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CarePayment_tenantId_id_customerId_key" ON "CarePayment"("tenantId", "id", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CarePayment_tenantId_reversedPaymentId_key" ON "CarePayment"("tenantId", "reversedPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "CarePayment_tenantId_submitKey_key" ON "CarePayment"("tenantId", "submitKey");

-- CreateIndex
CREATE INDEX "CarePaymentAllocation_tenantId_chargeId_idx" ON "CarePaymentAllocation"("tenantId", "chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "CarePaymentAllocation_tenantId_id_key" ON "CarePaymentAllocation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CarePaymentAllocation_tenantId_paymentId_chargeId_key" ON "CarePaymentAllocation"("tenantId", "paymentId", "chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSubscription_tenantId_id_customerId_key" ON "CustomerSubscription"("tenantId", "id", "customerId");

-- AddForeignKey
ALTER TABLE "CareCharge" ADD CONSTRAINT "CareCharge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCharge" ADD CONSTRAINT "CareCharge_tenantId_subscriptionId_customerId_fkey" FOREIGN KEY ("tenantId", "subscriptionId", "customerId") REFERENCES "CustomerSubscription"("tenantId", "id", "customerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCharge" ADD CONSTRAINT "CareCharge_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareChargeLine" ADD CONSTRAINT "CareChargeLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareChargeLine" ADD CONSTRAINT "CareChargeLine_tenantId_chargeId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "chargeId", "subscriptionId") REFERENCES "CareCharge"("tenantId", "id", "subscriptionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareChargeLine" ADD CONSTRAINT "CareChargeLine_tenantId_visitId_fkey" FOREIGN KEY ("tenantId", "visitId") REFERENCES "CareVisit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareChargeLine" ADD CONSTRAINT "CareChargeLine_tenantId_serviceResultId_fkey" FOREIGN KEY ("tenantId", "serviceResultId") REFERENCES "CareVisitServiceResult"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareChargeLine" ADD CONSTRAINT "CareChargeLine_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "CareService"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareChargeLine" ADD CONSTRAINT "CareChargeLine_tenantId_sourceChargeId_fkey" FOREIGN KEY ("tenantId", "sourceChargeId") REFERENCES "CareCharge"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisitBilling" ADD CONSTRAINT "CareVisitBilling_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisitBilling" ADD CONSTRAINT "CareVisitBilling_tenantId_visitId_fkey" FOREIGN KEY ("tenantId", "visitId") REFERENCES "CareVisit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePayment" ADD CONSTRAINT "CarePayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePayment" ADD CONSTRAINT "CarePayment_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePayment" ADD CONSTRAINT "CarePayment_tenantId_visitId_fkey" FOREIGN KEY ("tenantId", "visitId") REFERENCES "CareVisit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePayment" ADD CONSTRAINT "CarePayment_tenantId_reversedPaymentId_fkey" FOREIGN KEY ("tenantId", "reversedPaymentId") REFERENCES "CarePayment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePaymentAllocation" ADD CONSTRAINT "CarePaymentAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePaymentAllocation" ADD CONSTRAINT "CarePaymentAllocation_tenantId_paymentId_customerId_fkey" FOREIGN KEY ("tenantId", "paymentId", "customerId") REFERENCES "CarePayment"("tenantId", "id", "customerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePaymentAllocation" ADD CONSTRAINT "CarePaymentAllocation_tenantId_chargeId_customerId_fkey" FOREIGN KEY ("tenantId", "chargeId", "customerId") REFERENCES "CareCharge"("tenantId", "id", "customerId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- RLS: ogni tabella nuova è della fioreria
-- -----------------------------------------------------------------------------
SELECT app_enable_tenant_rls('"CareCharge"');
SELECT app_enable_tenant_rls('"CareChargeLine"');
SELECT app_enable_tenant_rls('"CareVisitBilling"');
SELECT app_enable_tenant_rls('"CarePayment"');
SELECT app_enable_tenant_rls('"CarePaymentAllocation"');

-- -----------------------------------------------------------------------------
-- Dati dei contratti già confermati (staging): le regole di oggi della fioreria e il prezzo dei
-- servizi già segnati. Le tabelle hanno FORCE RLS: si passa dal bypass come in `care_extras`.
-- -----------------------------------------------------------------------------
SELECT set_config('app.bypass_rls', 'on', false);
UPDATE "CustomerSubscription" s
SET "missedVisitPolicy" = c."missedVisitPolicy", "deadPlantPolicy" = c."deadPlantPolicy"
FROM "CareSettings" c
WHERE c."tenantId" = s."tenantId" AND s."kind" = 'CARE' AND s."confirmedAt" IS NOT NULL;
UPDATE "CustomerSubscription"
SET "missedVisitPolicy" = COALESCE("missedVisitPolicy", 'COUNTS'),
    "deadPlantPolicy" = COALESCE("deadPlantPolicy", 'QUOTE')
WHERE "kind" = 'CARE' AND "confirmedAt" IS NOT NULL
  AND ("missedVisitPolicy" IS NULL OR "deadPlantPolicy" IS NULL);
UPDATE "CareVisitServiceResult" r
SET "priceMinor" = ss."priceMinor"
FROM "CareVisit" v, "CustomerSubscriptionService" ss
WHERE v."tenantId" = r."tenantId" AND v."id" = r."visitId"
  AND ss."tenantId" = r."tenantId" AND ss."subscriptionId" = v."subscriptionId"
  AND ss."serviceId" = r."serviceId"
  AND r."pricing" = 'EXTRA' AND r."priceMinor" IS NULL;
SELECT set_config('app.bypass_rls', '', false);

-- -----------------------------------------------------------------------------
-- Vincoli (Prisma non li vede)
-- -----------------------------------------------------------------------------
ALTER TABLE "CareSettings" ADD CONSTRAINT "CareSettings_due_days_check" CHECK (
  "paymentDueDays" BETWEEN 1 AND 90
);

-- Un contratto di Floral Care confermato ha le regole copiate; il mese cobrado è un primo giorno.
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_billing_check" CHECK (
  ("chargedThrough" IS NULL OR EXTRACT(DAY FROM "chargedThrough") = 1)
  AND ("kind" <> 'CARE' OR "confirmedAt" IS NULL
       OR ("missedVisitPolicy" IS NOT NULL AND "deadPlantPolicy" IS NOT NULL))
);

-- La causa va solo con "No se pudo" (quelle del blocco 2 restano senza: valgono "el cliente no
-- abrió").
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_not_done_cause_check" CHECK (
  "notDoneCause" IS NULL OR "status" = 'NOT_DONE'
);

ALTER TABLE "CareVisitServiceResult" ADD CONSTRAINT "CareVisitServiceResult_price_check" CHECK (
  "priceMinor" IS NULL OR "priceMinor" BETWEEN 0 AND 1000000000
);

-- Un cargo: il mese è un primo giorno, la scadenza non viene prima dell'emissione, il pagato sta
-- fra 0 e il totale (anche quando il totale è a favore del cliente) e il saldo è totale − pagato.
-- Solo il cargo dopo la fine del contratto può restare sotto zero.
ALTER TABLE "CareCharge" ADD CONSTRAINT "CareCharge_values_check" CHECK (
  "number" > 0
  AND EXTRACT(DAY FROM "period") = 1
  AND "dueDate" >= "issuedOn"
  AND "unitPriceMinor" BETWEEN 0 AND 1000000000
  AND "priceVersion" >= 1
  AND "visitCount" >= 0
  AND "totalMinor" BETWEEN -1000000000 AND 1000000000
  AND ("final" OR "totalMinor" >= 0)
  AND "paidMinor" BETWEEN LEAST("totalMinor", 0) AND GREATEST("totalMinor", 0)
  AND "balanceMinor" = "totalMinor" - "paidMinor"
);

-- Le righe: quantità e prezzo coerenti con l'importo, il segno giusto per tipo e le chiavi che
-- servono a ognuna. Gli ajustes (ADJUSTMENT) arrivano con il blocco 3b.
ALTER TABLE "CareChargeLine" ADD CONSTRAINT "CareChargeLine_values_check" CHECK (
  "position" >= 0
  AND "quantity" BETWEEN 1 AND 1000
  AND "unitPriceMinor" BETWEEN 0 AND 1000000000
  AND "amountMinor" BETWEEN -1000000000 AND 1000000000
  AND ("label" IS NULL OR char_length("label") BETWEEN 1 AND 120)
  AND (("kind" = 'VISIT_CREDIT') = ("creditReason" IS NOT NULL))
  AND (("kind" = 'CREDIT_CARRIED_IN') = ("sourceChargeId" IS NOT NULL))
  AND (("kind" = 'ONE_TIME_SERVICE') = ("serviceResultId" IS NOT NULL))
  AND (("kind" = 'ONE_TIME_SERVICE') = ("serviceId" IS NOT NULL))
  AND (("kind" IN ('VISIT_DEBIT', 'VISIT_CREDIT', 'EXTRA_VISIT')) = ("visitId" IS NOT NULL))
  AND (
    ("kind" = 'VISITS' AND "amountMinor" = "quantity" * "unitPriceMinor")
    OR ("kind" IN ('VISIT_DEBIT', 'EXTRA_VISIT', 'ONE_TIME_SERVICE', 'CREDIT_CARRIED_OUT')
        AND "quantity" = 1 AND "amountMinor" = "unitPriceMinor" AND "amountMinor" > 0)
    OR ("kind" IN ('VISIT_CREDIT', 'CREDIT_CARRIED_IN')
        AND "quantity" = 1 AND "amountMinor" = -"unitPriceMinor" AND "amountMinor" < 0)
  )
  AND ("kind" NOT IN ('VISIT_DEBIT', 'VISIT_CREDIT', 'EXTRA_VISIT', 'ONE_TIME_SERVICE')
       OR "visitDate" IS NOT NULL)
);

-- Mai due volte la stessa cosa: una riga di visite per cargo, una visita extra cobrata una volta,
-- un servizio "una sola vez" una volta per contratto, un saldo a favore portato avanti una volta.
CREATE UNIQUE INDEX "CareChargeLine_visits_key" ON "CareChargeLine"("tenantId", "chargeId")
  WHERE "kind" = 'VISITS';
CREATE UNIQUE INDEX "CareChargeLine_extra_visit_key" ON "CareChargeLine"("tenantId", "visitId")
  WHERE "kind" = 'EXTRA_VISIT';
CREATE UNIQUE INDEX "CareChargeLine_one_time_key" ON "CareChargeLine"("tenantId", "subscriptionId", "serviceId")
  WHERE "kind" = 'ONE_TIME_SERVICE';
CREATE UNIQUE INDEX "CareChargeLine_carried_out_key" ON "CareChargeLine"("tenantId", "chargeId")
  WHERE "kind" = 'CREDIT_CARRIED_OUT';
CREATE UNIQUE INDEX "CareChargeLine_carried_in_key" ON "CareChargeLine"("tenantId", "sourceChargeId")
  WHERE "kind" = 'CREDIT_CARRIED_IN';

ALTER TABLE "CareVisitBilling" ADD CONSTRAINT "CareVisitBilling_values_check" CHECK (
  "billedMinor" IS NULL OR "billedMinor" BETWEEN 0 AND 1000000000
);

-- Un movimento: pagamento positivo, devolución negativa, storno di un movimento (di segno
-- opposto, controllato dal servizio) e sempre registrato. "Por registrar" e "rechazado" valgono
-- solo per un incasso alla visita (blocco 3b); un rifiuto dice perché.
ALTER TABLE "CarePayment" ADD CONSTRAINT "CarePayment_values_check" CHECK (
  "amountMinor" BETWEEN -1000000000 AND 1000000000
  AND (
    ("kind" = 'PAYMENT' AND "amountMinor" > 0 AND "reversedPaymentId" IS NULL)
    OR ("kind" = 'REFUND' AND "amountMinor" < 0 AND "reversedPaymentId" IS NULL
        AND "visitId" IS NULL)
    OR ("kind" = 'REVERSAL' AND "amountMinor" <> 0 AND "reversedPaymentId" IS NOT NULL
        AND "visitId" IS NULL)
  )
  AND ("status" = 'RECORDED' OR ("kind" = 'PAYMENT' AND "visitId" IS NOT NULL))
  AND (("status" = 'REJECTED') = ("rejectReason" IS NOT NULL))
  AND ("reference" IS NULL OR char_length("reference") BETWEEN 1 AND 80)
  AND ("note" IS NULL OR char_length("note") BETWEEN 1 AND 300)
  AND ("rejectReason" IS NULL OR char_length("rejectReason") BETWEEN 1 AND 300)
);

ALTER TABLE "CarePaymentAllocation" ADD CONSTRAINT "CarePaymentAllocation_values_check" CHECK (
  "amountMinor" <> 0 AND "amountMinor" BETWEEN -1000000000 AND 1000000000
);

-- -----------------------------------------------------------------------------
-- Manutenzione: i contratti con un mese da emettere (calendario di ogni fioreria). Solo gli ID,
-- come le altre funzioni dei lavori giornalieri. Un contratto attivo (o in pausa) ha un cargo
-- ogni mese dal mese in cui inizia; uno finito solo finché ha visite non ancora sistemate o un
-- saldo a favore da portare nel cargo finale.
-- -----------------------------------------------------------------------------
CREATE FUNCTION app_care_contracts_to_charge(max_rows integer)
RETURNS TABLE (tenant_id uuid, subscription_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT s."tenantId", s.id
    FROM "CustomerSubscription" s
    JOIN "Tenant" t ON t.id = s."tenantId"
    WHERE s.kind = 'CARE'
      AND t.status = 'ACTIVE'
      AND s."confirmedAt" IS NOT NULL
      AND date_trunc('month', s."startDate")::date
        <= date_trunc('month', (now() AT TIME ZONE t.timezone))::date
      AND (
        s."chargedThrough" IS NULL
        OR s."chargedThrough" < date_trunc('month', (now() AT TIME ZONE t.timezone))::date
      )
      AND (
        s.status IN ('ACTIVE', 'PAUSED')
        OR (
          s.status = 'ENDED'
          AND (
            EXISTS (
              SELECT 1
              FROM "CareVisit" v
              LEFT JOIN "CareVisitBilling" b
                ON b."tenantId" = v."tenantId" AND b."visitId" = v.id
              WHERE v."tenantId" = s."tenantId"
                AND v."subscriptionId" = s.id
                AND b."stableAt" IS NULL
            )
            OR EXISTS (
              SELECT 1
              FROM "CareChargeLine" o
              WHERE o."tenantId" = s."tenantId"
                AND o."subscriptionId" = s.id
                AND o.kind = 'CREDIT_CARRIED_OUT'
                AND NOT EXISTS (
                  SELECT 1
                  FROM "CareChargeLine" i
                  WHERE i."tenantId" = o."tenantId"
                    AND i.kind = 'CREDIT_CARRIED_IN'
                    AND i."sourceChargeId" = o."chargeId"
                )
            )
          )
        )
      )
    ORDER BY s."chargedThrough" NULLS FIRST, s.id
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
