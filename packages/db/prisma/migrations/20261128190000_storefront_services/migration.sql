-- Marketplace M5-1 «Servizi in vetrina e richieste» (ADR-089): i servizi della vetrina della
-- fioreria (i quattro predefiniti e quelli suoi) con le loro foto, e le richieste di chi compra con
-- le foto di ispirazione. Chi compra tocca le sue richieste solo dall'ingresso unico
-- `withBuyerRequest`, con la guardia `buyer_request_guard` (come gli ordini online, ADR-088).

-- CreateTable
CREATE TABLE "StorefrontService" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "includes" TEXT,
    "priceFromMinor" INTEGER,
    "askDate" BOOLEAN NOT NULL DEFAULT false,
    "askAddress" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontServicePhoto" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorefrontServicePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "serviceId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buyerUserId" UUID,
    "customerId" UUID,
    "preferredDate" DATE,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "addressNotes" TEXT,
    "currency" CHAR(3) NOT NULL,
    "budgetMinor" INTEGER,
    "contactPhone" TEXT NOT NULL,
    "message" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "declineReasonCode" TEXT,
    "declineReason" TEXT,
    "submitKey" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequestPhoto" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "photoKey" TEXT NOT NULL,
    "photoThumbKey" TEXT NOT NULL,
    "photoWidth" INTEGER NOT NULL,
    "photoHeight" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "photoDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceRequestPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorefrontService_tenantId_isPublished_idx" ON "StorefrontService"("tenantId", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontService_tenantId_id_key" ON "StorefrontService"("tenantId", "id");

-- CreateIndex
CREATE INDEX "StorefrontServicePhoto_tenantId_serviceId_idx" ON "StorefrontServicePhoto"("tenantId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontServicePhoto_tenantId_id_key" ON "StorefrontServicePhoto"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ServiceRequest_tenantId_status_idx" ON "ServiceRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ServiceRequest_buyerUserId_idx" ON "ServiceRequest"("buyerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_tenantId_id_key" ON "ServiceRequest"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_tenantId_number_key" ON "ServiceRequest"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_tenantId_submitKey_key" ON "ServiceRequest"("tenantId", "submitKey");

-- CreateIndex
CREATE INDEX "ServiceRequestPhoto_tenantId_requestId_idx" ON "ServiceRequestPhoto"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequestPhoto_tenantId_id_key" ON "ServiceRequestPhoto"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "StorefrontService" ADD CONSTRAINT "StorefrontService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontServicePhoto" ADD CONSTRAINT "StorefrontServicePhoto_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontServicePhoto" ADD CONSTRAINT "StorefrontServicePhoto_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "StorefrontService"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "StorefrontService"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequestPhoto" ADD CONSTRAINT "ServiceRequestPhoto_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequestPhoto" ADD CONSTRAINT "ServiceRequestPhoto_tenantId_requestId_fkey" FOREIGN KEY ("tenantId", "requestId") REFERENCES "ServiceRequest"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;



-- -----------------------------------------------------------------------------
-- Servizi: un predefinito per tipo; nome e domande del modulo solo per quelli della fioreria
-- -----------------------------------------------------------------------------

ALTER TABLE "StorefrontService"
  ADD CONSTRAINT "StorefrontService_values_check" CHECK (
    "kind" IN ('EVENT', 'VENUE', 'WEEKLY', 'CARE', 'CUSTOM')
    AND (("kind" = 'CUSTOM') = ("name" IS NOT NULL))
    AND ("name" IS NULL OR char_length("name") BETWEEN 1 AND 80)
    AND ("description" IS NULL OR char_length("description") BETWEEN 1 AND 600)
    AND ("includes" IS NULL OR char_length("includes") BETWEEN 1 AND 600)
    AND ("priceFromMinor" IS NULL OR "priceFromMinor" BETWEEN 1 AND 1000000000)
    AND ("kind" = 'CUSTOM' OR (NOT "askDate" AND NOT "askAddress"))
    AND (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL))
    AND ("status" = 'ACTIVE' OR NOT "isPublished")
  );

CREATE UNIQUE INDEX "StorefrontService_preset_key" ON "StorefrontService" ("tenantId", "kind")
  WHERE "kind" <> 'CUSTOM';

ALTER TABLE "StorefrontServicePhoto"
  ADD CONSTRAINT "StorefrontServicePhoto_values_check" CHECK (
    "storageKey" LIKE 'tenants/' || "tenantId"::text || '/storefront-services/%'
    AND "thumbKey" LIKE 'tenants/' || "tenantId"::text || '/storefront-services/%'
    AND "width" > 0
    AND "height" > 0
    AND "sizeBytes" > 0
    AND (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL))
  );

-- -----------------------------------------------------------------------------
-- Richieste: stati, motivo del rifiuto, lunghezze, indirizzo intero o niente
-- -----------------------------------------------------------------------------

ALTER TABLE "ServiceRequest"
  ADD CONSTRAINT "ServiceRequest_values_check" CHECK (
    "number" > 0
    AND "kind" IN ('EVENT', 'VENUE', 'WEEKLY', 'CARE', 'CUSTOM')
    AND "status" IN ('NEW', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'CLOSED')
    AND (("status" = 'DECLINED') = ("declineReason" IS NOT NULL))
    AND (("declineReasonCode" IS NULL) = ("declineReason" IS NULL))
    AND ("declineReasonCode" IS NULL
         OR "declineReasonCode" IN ('NO_AVAILABILITY', 'OUT_OF_AREA', 'NOT_OFFERED', 'OTHER'))
    AND ("declineReason" IS NULL OR char_length("declineReason") BETWEEN 1 AND 400)
    AND ("message" IS NULL OR char_length("message") BETWEEN 1 AND 1000)
    AND char_length("contactPhone") BETWEEN 1 AND 32
    AND ("budgetMinor" IS NULL OR "budgetMinor" BETWEEN 1 AND 1000000000)
    AND jsonb_typeof("answers") = 'object'
    AND ("addressLine1" IS NULL OR ("city" IS NOT NULL AND "region" IS NOT NULL
                                    AND "postalCode" IS NOT NULL))
    AND ("addressNotes" IS NULL OR char_length("addressNotes") <= 500)
  );

ALTER TABLE "ServiceRequestPhoto"
  ADD CONSTRAINT "ServiceRequestPhoto_values_check" CHECK (
    "photoKey" LIKE 'tenants/' || "tenantId"::text || '/service-requests/%'
    AND "photoThumbKey" LIKE 'tenants/' || "tenantId"::text || '/service-requests/%'
    AND "photoWidth" > 0
    AND "photoHeight" > 0
    AND "sortOrder" BETWEEN 0 AND 9
  );

-- Le richieste aperte di una persona in una fioreria (limite di 5) e quelle nuove (menu e «Da gestire»).
CREATE INDEX "ServiceRequest_buyer_open_idx" ON "ServiceRequest" ("tenantId", "buyerUserId")
  WHERE "status" IN ('NEW', 'QUOTED');

-- -----------------------------------------------------------------------------
-- Tenancy: RLS su tutte; chi compra tocca solo la sua richiesta (guardia)
-- -----------------------------------------------------------------------------

SELECT app_enable_tenant_rls('"StorefrontService"');
SELECT app_enable_tenant_rls('"StorefrontServicePhoto"');
SELECT app_enable_tenant_rls('"ServiceRequest"');
SELECT app_enable_tenant_rls('"ServiceRequestPhoto"');

-- Con `app.buyer_request_id` impostato (solo dal servizio, dentro la transazione di
-- `withBuyerRequestContext`) le policy RESTRICTIVE lasciano vedere e toccare solo quella richiesta.
-- Per la fioreria la variabile è vuota: non cambia niente.
CREATE FUNCTION app_buyer_request_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.buyer_request_id', true), '')::uuid $$;

CREATE FUNCTION app_enable_buyer_request_guard(target regclass, request_column text) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS buyer_request_guard ON %s', target);
  EXECUTE format(
    'CREATE POLICY buyer_request_guard ON %s AS RESTRICTIVE FOR ALL '
    'USING (app_buyer_request_id() IS NULL OR %I = app_buyer_request_id()) '
    'WITH CHECK (app_buyer_request_id() IS NULL OR %I = app_buyer_request_id())',
    target, request_column, request_column
  );
END
$$;

SELECT app_enable_buyer_request_guard('"ServiceRequest"', 'id');
SELECT app_enable_buyer_request_guard('"ServiceRequestPhoto"', 'requestId');

-- -----------------------------------------------------------------------------
-- Funzioni per chi compra (l'utente SOLO dal contesto, mai da un parametro)
-- -----------------------------------------------------------------------------

-- La fioreria di una richiesta, solo se l'ha fatta chi ha l'accesso: da qui il servizio apre il
-- contesto della fioreria con la guardia.
CREATE FUNCTION app_buyer_request_shop(p_request uuid)
RETURNS TABLE (
  tenant_id uuid,
  shop_slug text,
  shop_name text,
  shop_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  buyer uuid := app_current_user_id();
BEGIN
  IF buyer IS NULL OR p_request IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT r."tenantId", t.slug, t."displayName", t.status = 'ACTIVE'
    FROM "ServiceRequest" r
    JOIN "Tenant" t ON t.id = r."tenantId"
    WHERE r.id = p_request AND r."buyerUserId" = buyer;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- «Mis solicitudes»: le richieste della persona in tutte le fiorerie (le 100 più recenti), con il
-- nome del servizio (null per i predefiniti: lo dà la lingua) e se la fioreria è attiva.
CREATE FUNCTION app_buyer_service_requests()
RETURNS TABLE (
  request_id uuid,
  tenant_id uuid,
  shop_slug text,
  shop_name text,
  shop_active boolean,
  number integer,
  kind text,
  service_name text,
  status text,
  preferred_date date,
  created_at timestamp
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  person uuid := app_current_user_id();
BEGIN
  IF person IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT r.id, r."tenantId", t.slug, t."displayName", t.status = 'ACTIVE', r.number, r.kind,
           s.name, r.status, r."preferredDate", r."createdAt"
    FROM "ServiceRequest" r
    JOIN "Tenant" t ON t.id = r."tenantId"
    JOIN "StorefrontService" s ON s."tenantId" = r."tenantId" AND s.id = r."serviceId"
    WHERE r."buyerUserId" = person
    ORDER BY r."createdAt" DESC, r.id DESC
    LIMIT 100;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- «Descargar mis datos»: le richieste della persona, senza ID interni né foto.
CREATE FUNCTION app_buyer_service_requests_export()
RETURNS TABLE (
  shop_name text,
  number integer,
  kind text,
  service_name text,
  status text,
  created_at timestamp,
  preferred_date date,
  city text,
  budget_minor integer,
  currency text,
  contact_phone text,
  message text,
  decline_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  person uuid := app_current_user_id();
BEGIN
  IF person IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT t."displayName", r.number, r.kind, s.name, r.status, r."createdAt", r."preferredDate",
           r.city, r."budgetMinor", r.currency::text, r."contactPhone", r.message, r."declineReason"
    FROM "ServiceRequest" r
    JOIN "Tenant" t ON t.id = r."tenantId"
    JOIN "StorefrontService" s ON s."tenantId" = r."tenantId" AND s.id = r."serviceId"
    WHERE r."buyerUserId" = person
    ORDER BY r."createdAt", r.id
    LIMIT 5000;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- -----------------------------------------------------------------------------
-- Lavoro giornaliero: le foto delle richieste chiuse da almeno `retention_days` giorni (solo ID)
-- -----------------------------------------------------------------------------

CREATE FUNCTION app_service_request_photos_to_purge(retention_days integer, max_rows integer)
RETURNS TABLE (tenant_id uuid, photo_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  now_utc timestamp := now() AT TIME ZONE 'UTC';
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT p."tenantId", p.id
    FROM "ServiceRequestPhoto" p
    JOIN "ServiceRequest" r ON r."tenantId" = p."tenantId" AND r.id = p."requestId"
    WHERE p."photoDeletedAt" IS NULL
      AND r.status IN ('DECLINED', 'CANCELLED', 'CLOSED')
      AND r."statusChangedAt" + make_interval(days => retention_days) <= now_utc
    ORDER BY p."createdAt", p.id
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
