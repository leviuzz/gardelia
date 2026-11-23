-- Logo e foto di copertina della tienda en línea (ADR-065, blocco C2b).
-- AlterTable
ALTER TABLE "OnlineStore" ADD COLUMN     "coverId" UUID,
ADD COLUMN     "coverKey" TEXT,
ADD COLUMN     "logoId" UUID,
ADD COLUMN     "logoKey" TEXT;

-- Ogni immagine ha sia l'ID (nell'indirizzo pubblico) sia il file, o nessuno dei due.
ALTER TABLE "OnlineStore"
  ADD CONSTRAINT "OnlineStore_logo_check" CHECK (("logoId" IS NULL) = ("logoKey" IS NULL)),
  ADD CONSTRAINT "OnlineStore_cover_check" CHECK (("coverId" IS NULL) = ("coverKey" IS NULL));
