-- Google Places (ADR-059): place ID degli indirizzi (si conserva senza limiti) e coordinate con la
-- data in cui sono arrivate (cache: le regole di Google ne permettono al massimo 30 giorni; il lavoro
-- giornaliero le cancella dopo).
-- AlterTable
ALTER TABLE "CustomerAddress" ADD COLUMN     "coordinatesAt" TIMESTAMP(3),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "placeId" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "coordinatesAt" TIMESTAMP(3),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "placeId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryCoordinatesAt" TIMESTAMP(3),
ADD COLUMN     "deliveryLatitude" DOUBLE PRECISION,
ADD COLUMN     "deliveryLongitude" DOUBLE PRECISION,
ADD COLUMN     "deliveryPlaceId" TEXT;

-- Coordinate: entrambe con la loro data, o nessuna; valori dentro i limiti del globo.
ALTER TABLE "CustomerAddress"
  ADD CONSTRAINT "CustomerAddress_coordinates_check" CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL AND "coordinatesAt" IS NULL)
    OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180
        AND "coordinatesAt" IS NOT NULL)
  );
ALTER TABLE "Location"
  ADD CONSTRAINT "Location_coordinates_check" CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL AND "coordinatesAt" IS NULL)
    OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180
        AND "coordinatesAt" IS NOT NULL)
  );
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_delivery_coordinates_check" CHECK (
    ("deliveryLatitude" IS NULL AND "deliveryLongitude" IS NULL AND "deliveryCoordinatesAt" IS NULL)
    OR ("deliveryLatitude" BETWEEN -90 AND 90 AND "deliveryLongitude" BETWEEN -180 AND 180
        AND "deliveryCoordinatesAt" IS NOT NULL)
  );

-- Indici parziali per la pulizia giornaliera delle coordinate scadute.
CREATE INDEX "CustomerAddress_coordinatesAt_idx" ON "CustomerAddress"("coordinatesAt")
  WHERE "coordinatesAt" IS NOT NULL;
CREATE INDEX "Location_coordinatesAt_idx" ON "Location"("coordinatesAt")
  WHERE "coordinatesAt" IS NOT NULL;
CREATE INDEX "Order_deliveryCoordinatesAt_idx" ON "Order"("deliveryCoordinatesAt")
  WHERE "deliveryCoordinatesAt" IS NOT NULL;

-- Pulizia giornaliera (ADR-059): cancella le coordinate avute da Google da più di 30 giorni, in
-- tutte le fiorerie. Il place ID resta (permesso senza limiti): se le coordinate servono di nuovo
-- si richiedono da lì. SECURITY DEFINER come app_expire_overdue: il web non usa un contesto di
-- sistema.
CREATE FUNCTION app_purge_place_coordinates()
RETURNS TABLE (addresses_purged integer, locations_purged integer, orders_purged integer)
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

  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN QUERY SELECT addresses, locations, orders;
END;
$$;
