-- This is an empty migration.-- Tipo di riga coerente con i riferimenti (migrazione separata: un valore di enum aggiunto
-- con ALTER TYPE … ADD VALUE non è utilizzabile nella stessa transazione).
ALTER TABLE "QuoteLine" DROP CONSTRAINT "QuoteLine_kind_item_check";
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_kind_item_check" CHECK (
  ("kind" = 'CATALOG_ITEM' AND "catalogItemId" IS NOT NULL AND "bouquetConfigurationId" IS NULL)
  OR ("kind" = 'CUSTOM' AND "catalogItemId" IS NULL AND "bouquetConfigurationId" IS NULL)
  OR ("kind" = 'BUILDER' AND "catalogItemId" IS NULL AND "bouquetConfigurationId" IS NOT NULL)
);
