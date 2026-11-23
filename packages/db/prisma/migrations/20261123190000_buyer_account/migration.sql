-- Conto del cliente del marketplace (blocco C1): dati della persona che compra, che non
-- appartengono a nessuna fioreria. Tabelle di piattaforma con RLS per utente: ognuno vede e
-- modifica solo le sue righe (eccezione motivata alla regola "tenantId + RLS per tenant", vedi
-- docs/DECISIONS.md, ADR-064).

-- CreateTable
CREATE TABLE "BuyerProfile" (
    "userId" UUID NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "BuyerAddress" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "neighborhood" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "placeId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "coordinatesAt" TIMESTAMP(3),
    "countryCode" CHAR(2) NOT NULL,
    "deliveryNotes" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuyerAddress_userId_idx" ON "BuyerAddress"("userId");

-- AddForeignKey
ALTER TABLE "BuyerProfile" ADD CONSTRAINT "BuyerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerAddress" ADD CONSTRAINT "BuyerAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "BuyerProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================
-- Sicurezza e integrità (non esprimibili in Prisma)
-- =============================================================================

-- Policy standard "solo righe dell'utente corrente" per le tabelle con "userId" (il contesto lo
-- imposta withUserContext). Gemella di app_enable_tenant_rls.
CREATE OR REPLACE FUNCTION app_enable_user_rls(target regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('DROP POLICY IF EXISTS user_isolation ON %s', target);
  EXECUTE format(
    'CREATE POLICY user_isolation ON %s '
    'USING ("userId" = app_current_user_id() OR app_rls_bypass()) '
    'WITH CHECK ("userId" = app_current_user_id() OR app_rls_bypass())',
    target
  );
END
$$;

SELECT app_enable_user_rls('"BuyerProfile"');
SELECT app_enable_user_rls('"BuyerAddress"');

ALTER TABLE "BuyerProfile"
  ADD CONSTRAINT "BuyerProfile_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE "BuyerAddress"
  ADD CONSTRAINT "BuyerAddress_countryCode_check" CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "BuyerAddress_recipientPhone_check"
    CHECK ("recipientPhone" IS NULL OR "recipientPhone" ~ '^\+[1-9][0-9]{7,14}$'),
  -- Coordinate: entrambe con la loro data, o nessuna; valori dentro i limiti del globo.
  ADD CONSTRAINT "BuyerAddress_coordinates_check" CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL AND "coordinatesAt" IS NULL)
    OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180
        AND "coordinatesAt" IS NOT NULL)
  );

-- Al massimo un indirizzo predefinito attivo per persona.
CREATE UNIQUE INDEX "BuyerAddress_one_default_per_user"
  ON "BuyerAddress" ("userId")
  WHERE "isDefault" AND "status" = 'ACTIVE';

-- Per la pulizia giornaliera delle coordinate scadute.
CREATE INDEX "BuyerAddress_coordinatesAt_idx" ON "BuyerAddress"("coordinatesAt")
  WHERE "coordinatesAt" IS NOT NULL;

-- Pulizia giornaliera delle coordinate di Google (ADR-059), ora anche sugli indirizzi di chi compra.
-- Il tipo restituito cambia (una colonna in più), quindi si ricrea. Stessa logica e stessa
-- sicurezza (SECURITY DEFINER, 30 giorni fissi).
DROP FUNCTION app_purge_place_coordinates();

CREATE FUNCTION app_purge_place_coordinates()
RETURNS TABLE (
  addresses_purged integer,
  locations_purged integer,
  orders_purged integer,
  buyer_addresses_purged integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  -- Fisso a 30 giorni (COORDINATES_TTL_DAYS nel dominio): nessun parametro da chiamare male.
  cutoff timestamp := (now() AT TIME ZONE 'UTC') - interval '30 days';
  addresses integer;
  locations integer;
  orders integer;
  buyer_addresses integer;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE "CustomerAddress"
  SET latitude = NULL, longitude = NULL, "coordinatesAt" = NULL
  WHERE "coordinatesAt" IS NOT NULL AND "coordinatesAt" < cutoff;
  GET DIAGNOSTICS addresses = ROW_COUNT;

  UPDATE "Location"
  SET latitude = NULL, longitude = NULL, "coordinatesAt" = NULL
  WHERE "coordinatesAt" IS NOT NULL AND "coordinatesAt" < cutoff;
  GET DIAGNOSTICS locations = ROW_COUNT;

  UPDATE "Order"
  SET "deliveryLatitude" = NULL, "deliveryLongitude" = NULL, "deliveryCoordinatesAt" = NULL
  WHERE "deliveryCoordinatesAt" IS NOT NULL AND "deliveryCoordinatesAt" < cutoff;
  GET DIAGNOSTICS orders = ROW_COUNT;

  UPDATE "BuyerAddress"
  SET latitude = NULL, longitude = NULL, "coordinatesAt" = NULL
  WHERE "coordinatesAt" IS NOT NULL AND "coordinatesAt" < cutoff;
  GET DIAGNOSTICS buyer_addresses = ROW_COUNT;

  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN QUERY SELECT addresses, locations, orders, buyer_addresses;
END;
$$;
