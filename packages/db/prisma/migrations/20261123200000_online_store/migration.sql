-- "Mi tienda en línea" (marketplace, blocco C2, ADR-065): impostazioni della pagina pubblica della
-- fioreria e prodotti scelti per mostrarsi lì.

-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "isOnline" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OnlineStore" (
    "tenantId" UUID NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "description" TEXT,
    "paymentMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "paymentInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlineStore_pkey" PRIMARY KEY ("tenantId")
);

-- AddForeignKey
ALTER TABLE "OnlineStore" ADD CONSTRAINT "OnlineStore_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================
-- Sicurezza e integrità (non esprimibili in Prisma)
-- =============================================================================

SELECT app_enable_tenant_rls('"OnlineStore"');

ALTER TABLE "OnlineStore"
  ADD CONSTRAINT "OnlineStore_description_check"
    CHECK ("description" IS NULL OR char_length("description") BETWEEN 1 AND 600),
  ADD CONSTRAINT "OnlineStore_paymentInstructions_check"
    CHECK ("paymentInstructions" IS NULL OR char_length("paymentInstructions") BETWEEN 1 AND 500),
  -- Solo le forme di pagamento conosciute (STORE_PAYMENT_METHODS nel dominio).
  ADD CONSTRAINT "OnlineStore_paymentMethods_check"
    CHECK ("paymentMethods" <@ ARRAY['TRANSFER', 'CASH', 'CARD_IN_STORE', 'PAYMENT_LINK']::text[]),
  -- Una tienda pubblicata sa da quando.
  ADD CONSTRAINT "OnlineStore_published_check"
    CHECK (NOT "isPublished" OR "publishedAt" IS NOT NULL);

-- In linea solo ramos, piante, fiori e accessori (ONLINE_ITEM_TYPES nel dominio).
ALTER TABLE "CatalogItem"
  ADD CONSTRAINT "CatalogItem_isOnline_type_check"
    CHECK (NOT "isOnline" OR "type" IN ('BOUQUET', 'PLANT', 'CUT_FLOWER', 'ACCESSORY'));

-- Prodotti della pagina pubblica.
CREATE INDEX "CatalogItem_online_idx" ON "CatalogItem" ("tenantId", "name")
  WHERE "isOnline" AND "status" = 'ACTIVE';

-- Da `/f/<slug>` alla fioreria, SOLO se la sua tienda è pubblicata e la fioreria è attiva.
-- Chi visita non ha sessione: lo slug non firmato non può aprire un contesto di tenant da solo.
-- SECURITY DEFINER come le altre funzioni di piattaforma: restituisce solo l'ID (o NULL), poi i
-- dati si leggono nel contesto di quella fioreria con la RLS attiva.
CREATE FUNCTION app_public_store_tenant(store_slug text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  found uuid;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  SELECT t.id INTO found
  FROM "Tenant" t
  JOIN "OnlineStore" s ON s."tenantId" = t.id
  WHERE t.slug = store_slug AND t.status = 'ACTIVE' AND s."isPublished";
  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN found;
END;
$$;
