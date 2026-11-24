-- Floral Care, blocco 2 (ADR-076), parte 2: i vincoli che usano 'CARE_VISIT' (aggiunto nella
-- migrazione precedente, non utilizzabile nella stessa transazione).

-- Un link punta a un solo documento, quello del suo tipo.
ALTER TABLE "PublicLink" DROP CONSTRAINT "PublicLink_target_check";
ALTER TABLE "PublicLink" ADD CONSTRAINT "PublicLink_target_check" CHECK (
  ("kind" = 'QUOTE' AND "quoteId" IS NOT NULL AND "orderId" IS NULL AND "careVisitId" IS NULL)
  OR ("kind" = 'ORDER' AND "orderId" IS NOT NULL AND "quoteId" IS NULL AND "careVisitId" IS NULL)
  OR (
    "kind" = 'CARE_VISIT' AND "careVisitId" IS NOT NULL AND "quoteId" IS NULL AND "orderId" IS NULL
  )
);

-- Uno solo attivo per resoconto, come per preventivi e ordini.
CREATE UNIQUE INDEX "PublicLink_active_care_visit_key"
  ON "PublicLink"("tenantId", "careVisitId") WHERE "revokedAt" IS NULL AND "kind" = 'CARE_VISIT';
