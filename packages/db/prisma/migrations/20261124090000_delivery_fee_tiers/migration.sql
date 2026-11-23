-- Costo di consegna per distanza (ADR-069).

-- CreateTable
CREATE TABLE "DeliveryFeeTier" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "maxMeters" INTEGER NOT NULL,
    "feeMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryFeeTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryFeeTier_tenantId_idx" ON "DeliveryFeeTier"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryFeeTier_tenantId_id_key" ON "DeliveryFeeTier"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryFeeTier_tenantId_maxMeters_key" ON "DeliveryFeeTier"("tenantId", "maxMeters");

-- AddForeignKey
ALTER TABLE "DeliveryFeeTier" ADD CONSTRAINT "DeliveryFeeTier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================
-- Sicurezza e integrità (non esprimibili in Prisma)
-- =============================================================================

SELECT app_enable_tenant_rls('"DeliveryFeeTier"');

-- Da 100 m a 100 km; costo non negativo e sotto il tetto degli importi.
ALTER TABLE "DeliveryFeeTier"
  ADD CONSTRAINT "DeliveryFeeTier_range_check"
  CHECK ("maxMeters" BETWEEN 100 AND 100000 AND "feeMinor" >= 0 AND "feeMinor" <= 100000000);

-- Coordinate della tienda: Google permette di tenerle 30 giorni (ADR-059). La manutenzione le
-- richiede di nuovo anche per le fiorerie che calcolano il costo di consegna per distanza, non solo
-- per le tiendas pubblicate (ADR-066): altrimenti il calcolo si spegnerebbe dopo un mese.
CREATE OR REPLACE FUNCTION app_store_places_to_refresh(older_than_days integer, max_rows integer)
RETURNS TABLE (tenant_id uuid, location_id uuid, place_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  cutoff timestamp := (now() AT TIME ZONE 'UTC') - make_interval(days => least(greatest(older_than_days, 1), 29));
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT l."tenantId", l.id, l."placeId"
    FROM "Location" l
    JOIN "Tenant" t ON t.id = l."tenantId"
    LEFT JOIN "OnlineStore" s ON s."tenantId" = l."tenantId"
    WHERE l."isPrimary" AND l."placeId" IS NOT NULL
      AND t.status = 'ACTIVE'
      AND (
        coalesce(s."isPublished", false)
        OR EXISTS (SELECT 1 FROM "DeliveryFeeTier" f WHERE f."tenantId" = l."tenantId")
      )
      AND (l."coordinatesAt" IS NULL OR l."coordinatesAt" < cutoff)
    ORDER BY l."coordinatesAt" NULLS FIRST
    LIMIT least(greatest(max_rows, 1), 200);
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
