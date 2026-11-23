-- Codici e registro degli sconti della promo (ADR-048): ogni email ha un codice personale che il
-- cliente scrive su WhatsApp; la fioreria lo cerca e segna lo sconto come usato.

-- AlterTable
ALTER TABLE "OccasionPromoEmail" ADD COLUMN     "code" TEXT,
ADD COLUMN     "redeemedAt" TIMESTAMP(3),
ADD COLUMN     "redeemedById" UUID,
ADD COLUMN     "redemptionNote" TEXT;

-- Righe già esistenti (ambienti di sviluppo e prova): un codice a caso con lo stesso alfabeto del
-- dominio (PROMO_CODE_ALPHABET). La sottoquery cita la riga esterna, così è calcolata per ogni riga.
-- Con l'RLS forzata la migrazione attiva il bypass solo per questo aggiornamento.
SELECT set_config('app.bypass_rls', 'on', false);
UPDATE "OccasionPromoEmail" AS e
SET "code" = (
  SELECT string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 32)::int, 1), '')
  FROM generate_series(1, 6) AS g
  WHERE e.id IS NOT NULL
);
SELECT set_config('app.bypass_rls', '', false);

ALTER TABLE "OccasionPromoEmail" ALTER COLUMN "code" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "OccasionPromoEmail_tenantId_code_key" ON "OccasionPromoEmail"("tenantId", "code");

-- Codice di 6 caratteri senza 0/O né 1/I; l'uso c'è solo per email partite, con chi e quando
-- insieme; la nota solo per uno sconto usato.
ALTER TABLE "OccasionPromoEmail"
  ADD CONSTRAINT "OccasionPromoEmail_code_check" CHECK ("code" ~ '^[2-9A-HJ-NP-Z]{6}$'),
  ADD CONSTRAINT "OccasionPromoEmail_redemption_check" CHECK (
    ("redeemedAt" IS NULL) = ("redeemedById" IS NULL)
    AND ("redeemedAt" IS NULL OR "status" = 'SENT')
    AND ("redemptionNote" IS NULL OR ("redeemedAt" IS NOT NULL AND char_length("redemptionNote") <= 200))
  );
