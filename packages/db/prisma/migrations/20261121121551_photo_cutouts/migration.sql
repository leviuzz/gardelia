-- CreateEnum
CREATE TYPE "CutoutStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'PHOTO_CUTOUT';

-- AlterTable
ALTER TABLE "CatalogItemPhoto" ADD COLUMN     "cutoutError" TEXT,
ADD COLUMN     "cutoutKey" TEXT,
ADD COLUMN     "cutoutStatus" "CutoutStatus";

-- Il file senza fondo sta nella cartella del proprio tenant; "pronto" significa che c'è il file.
ALTER TABLE "CatalogItemPhoto"
  ADD CONSTRAINT "CatalogItemPhoto_cutout_check" CHECK (
    ("cutoutKey" IS NULL OR "cutoutKey" LIKE 'tenants/' || "tenantId"::text || '/catalog-photos/%')
    AND ("cutoutStatus" IS DISTINCT FROM 'READY' OR "cutoutKey" IS NOT NULL)
    AND ("cutoutError" IS NULL OR "cutoutError" ~ '^[a-z_]{2,40}$')
  );
