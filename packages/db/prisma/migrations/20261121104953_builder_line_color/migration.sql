-- AlterTable
ALTER TABLE "BouquetConfigurationLine" ADD COLUMN     "color" TEXT;

-- Il colore è una chiave di CATALOG_COLORS (validata dal dominio); qui solo la forma.
ALTER TABLE "BouquetConfigurationLine"
  ADD CONSTRAINT "BouquetConfigurationLine_color_check"
  CHECK ("color" IS NULL OR "color" ~ '^[a-z]{2,20}$');
