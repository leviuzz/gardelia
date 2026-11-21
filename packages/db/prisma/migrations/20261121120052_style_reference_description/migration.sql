-- AlterTable
ALTER TABLE "StyleReferencePhoto" ADD COLUMN     "styleDescribedAt" TIMESTAMP(3),
ADD COLUMN     "styleDescriberModel" TEXT,
ADD COLUMN     "styleDescription" TEXT,
ADD COLUMN     "styleDescriptionEs" TEXT;

ALTER TABLE "StyleReferencePhoto"
  ADD CONSTRAINT "StyleReferencePhoto_description_check" CHECK (
    ("styleDescription" IS NULL OR char_length("styleDescription") <= 400)
    AND ("styleDescriptionEs" IS NULL OR char_length("styleDescriptionEs") <= 400)
  );
