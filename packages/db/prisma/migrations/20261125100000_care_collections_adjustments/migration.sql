-- Floral Care, blocco 3b (ADR-082): "Cobré en la visita" (por registrar), "Por recuperar" e
-- "Ajuste para el próximo cargo". Solo colonne e tabelle nuove; i vincoli che Prisma non vede sono
-- in fondo.

-- AlterTable
ALTER TABLE "CareChargeLine" ADD COLUMN     "adjustmentId" UUID;

-- AlterTable
ALTER TABLE "CarePayment" ADD COLUMN     "collectedMinor" INTEGER;

-- AlterTable
ALTER TABLE "CareVisit" ADD COLUMN     "recoveryOfVisitId" UUID;

-- CreateTable
CREATE TABLE "CareChargeAdjustment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" UUID,

    CONSTRAINT "CareChargeAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareChargeAdjustment_tenantId_subscriptionId_idx" ON "CareChargeAdjustment"("tenantId", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "CareChargeAdjustment_tenantId_id_key" ON "CareChargeAdjustment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareChargeAdjustment_tenantId_subscriptionId_id_key" ON "CareChargeAdjustment"("tenantId", "subscriptionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareChargeLine_tenantId_adjustmentId_key" ON "CareChargeLine"("tenantId", "adjustmentId");

-- CreateIndex
CREATE INDEX "CareVisit_tenantId_recoveryOfVisitId_idx" ON "CareVisit"("tenantId", "recoveryOfVisitId");

-- CreateIndex
CREATE UNIQUE INDEX "CareVisit_tenantId_subscriptionId_id_key" ON "CareVisit"("tenantId", "subscriptionId", "id");

-- AddForeignKey
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_tenantId_subscriptionId_recoveryOfVisitId_fkey" FOREIGN KEY ("tenantId", "subscriptionId", "recoveryOfVisitId") REFERENCES "CareVisit"("tenantId", "subscriptionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareChargeLine" ADD CONSTRAINT "CareChargeLine_tenantId_subscriptionId_adjustmentId_fkey" FOREIGN KEY ("tenantId", "subscriptionId", "adjustmentId") REFERENCES "CareChargeAdjustment"("tenantId", "subscriptionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareChargeAdjustment" ADD CONSTRAINT "CareChargeAdjustment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareChargeAdjustment" ADD CONSTRAINT "CareChargeAdjustment_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- RLS della tabella nuova
-- -----------------------------------------------------------------------------
SELECT app_enable_tenant_rls('"CareChargeAdjustment"');

-- -----------------------------------------------------------------------------
-- Vincoli (Prisma non li vede)
-- -----------------------------------------------------------------------------

-- Una visita di recupero è una visita extra gratis dello stesso contratto (la FK lo controlla) e
-- non recupera sé stessa.
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_recovery_check" CHECK (
  "recoveryOfVisitId" IS NULL
  OR ("isExtra" AND "extraFee" = 'FREE' AND "recoveryOfVisitId" <> "id")
);

-- Una visita mancata ha al massimo una visita di recupero valida: se quella si cancella o non si
-- può fare, se ne può fissare un'altra.
CREATE UNIQUE INDEX "CareVisit_live_recovery_key" ON "CareVisit"("tenantId", "recoveryOfVisitId")
  WHERE "recoveryOfVisitId" IS NOT NULL
    AND "status" IN ('SCHEDULED', 'IN_PROGRESS', 'DONE', 'TO_RESCHEDULE');

-- Un incasso alla visita porta quanto ha segnato chi l'ha fatta; chi conferma può registrare meno,
-- mai di più. Solo gli incassi alla visita hanno la visita.
ALTER TABLE "CarePayment" ADD CONSTRAINT "CarePayment_collection_check" CHECK (
  (("visitId" IS NULL) = ("collectedMinor" IS NULL))
  AND ("collectedMinor" IS NULL
       OR ("collectedMinor" BETWEEN 1 AND 1000000000 AND "amountMinor" <= "collectedMinor"))
);

-- Un solo incasso "por registrar" per visita: un doppio tocco non ne crea due.
CREATE UNIQUE INDEX "CarePayment_pending_visit_key" ON "CarePayment"("tenantId", "visitId")
  WHERE "status" = 'PENDING';

ALTER TABLE "CareChargeAdjustment" ADD CONSTRAINT "CareChargeAdjustment_values_check" CHECK (
  "amountMinor" <> 0
  AND "amountMinor" BETWEEN -1000000000 AND 1000000000
  AND char_length("reason") BETWEEN 1 AND 120
);

-- Le righe del cargo, ora con gli ajustes: una riga per ajuste, con il segno dell'ajuste e il suo
-- motivo come etichetta.
ALTER TABLE "CareChargeLine" DROP CONSTRAINT "CareChargeLine_values_check";
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
  AND (("kind" = 'ADJUSTMENT') = ("adjustmentId" IS NOT NULL))
  AND (("kind" IN ('VISIT_DEBIT', 'VISIT_CREDIT', 'EXTRA_VISIT')) = ("visitId" IS NOT NULL))
  AND (
    ("kind" = 'VISITS' AND "amountMinor" = "quantity" * "unitPriceMinor")
    OR ("kind" IN ('VISIT_DEBIT', 'EXTRA_VISIT', 'ONE_TIME_SERVICE', 'CREDIT_CARRIED_OUT')
        AND "quantity" = 1 AND "amountMinor" = "unitPriceMinor" AND "amountMinor" > 0)
    OR ("kind" IN ('VISIT_CREDIT', 'CREDIT_CARRIED_IN')
        AND "quantity" = 1 AND "amountMinor" = -"unitPriceMinor" AND "amountMinor" < 0)
    OR ("kind" = 'ADJUSTMENT'
        AND "quantity" = 1 AND "amountMinor" <> 0 AND "unitPriceMinor" = abs("amountMinor")
        AND "label" IS NOT NULL)
  )
  AND ("kind" NOT IN ('VISIT_DEBIT', 'VISIT_CREDIT', 'EXTRA_VISIT', 'ONE_TIME_SERVICE')
       OR "visitDate" IS NOT NULL)
);

-- -----------------------------------------------------------------------------
-- Manutenzione: un contratto finito si guarda anche finché ha un ajuste in attesa, così entra nel
-- cargo finale. Il resto è come nella migrazione dei cargos.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_care_contracts_to_charge(max_rows integer)
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
            OR EXISTS (
              SELECT 1
              FROM "CareChargeAdjustment" a
              WHERE a."tenantId" = s."tenantId"
                AND a."subscriptionId" = s.id
                AND a."removedAt" IS NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM "CareChargeLine" l
                  WHERE l."tenantId" = a."tenantId" AND l."adjustmentId" = a.id
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
