-- =============================================================================
-- Floral OS — Row-Level Security (isolamento dei tenant nel database)
--
-- Modello:
--   * Il contesto della richiesta viene impostato PER TRANSAZIONE dall'applicazione con
--       set_config('app.tenant_id', <uuid>, true)
--       set_config('app.user_id',   <uuid>, true)
--     (vedi packages/db/src/tenancy.ts). Fuori da una transazione con contesto,
--     le tabelle dei tenant risultano VUOTE: il sistema fallisce "chiuso".
--   * Le operazioni di sistema esplicite (seed, accettazione invito via token,
--     indagini di sicurezza) impostano app.bypass_rls = 'on' tramite
--     withSystemContext(), che richiede una motivazione registrata nei log.
--   * Il ruolo runtime dell'app NON è superuser né BYPASSRLS; FORCE ROW LEVEL SECURITY
--     applica le policy anche al proprietario delle tabelle.
--
-- Minaccia coperta: bug applicativi (filtro tenant dimenticato, ID manomessi).
-- Non copre codice malevolo eseguito dentro l'applicazione stessa.
--
-- Convenzione per le NUOVE tabelle con colonna "tenantId": nella stessa migrazione
-- che crea la tabella eseguire:
--     SELECT app_enable_tenant_rls('"NomeTabella"');
-- Il test packages/db/test/rls.test.ts fallisce se una tabella tenant ne è priva.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Funzioni di contesto
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on' $$;

-- Applica la policy standard "solo righe del tenant corrente" a una tabella con "tenantId".
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(target regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', target);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s '
    'USING ("tenantId" = app_current_tenant_id() OR app_rls_bypass()) '
    'WITH CHECK ("tenantId" = app_current_tenant_id() OR app_rls_bypass())',
    target
  );
END
$$;

-- ---------------------------------------------------------------------------
-- Tabelle tenant con policy standard
-- ---------------------------------------------------------------------------

SELECT app_enable_tenant_rls('"Location"');
SELECT app_enable_tenant_rls('"Invitation"');
SELECT app_enable_tenant_rls('"CatalogItem"');
SELECT app_enable_tenant_rls('"BouquetRecipe"');
SELECT app_enable_tenant_rls('"BouquetRecipeLine"');
SELECT app_enable_tenant_rls('"Customer"');
SELECT app_enable_tenant_rls('"Quote"');
SELECT app_enable_tenant_rls('"QuoteLine"');
SELECT app_enable_tenant_rls('"AiJob"');

-- ---------------------------------------------------------------------------
-- Membership: visibile al tenant corrente e all'utente stesso (per elencare le
-- proprie fiorerie), ma modificabile solo nel contesto del tenant.
-- ---------------------------------------------------------------------------

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_select ON "Membership" FOR SELECT
  USING ("tenantId" = app_current_tenant_id() OR "userId" = app_current_user_id() OR app_rls_bypass());
CREATE POLICY membership_insert ON "Membership" FOR INSERT
  WITH CHECK ("tenantId" = app_current_tenant_id() OR app_rls_bypass());
CREATE POLICY membership_update ON "Membership" FOR UPDATE
  USING ("tenantId" = app_current_tenant_id() OR app_rls_bypass())
  WITH CHECK ("tenantId" = app_current_tenant_id() OR app_rls_bypass());
CREATE POLICY membership_delete ON "Membership" FOR DELETE
  USING ("tenantId" = app_current_tenant_id() OR app_rls_bypass());

-- ---------------------------------------------------------------------------
-- Tenant: leggibile dal tenant corrente o dai suoi membri ATTIVI (risoluzione dello
-- slug prima di conoscere il tenantId). Creazione solo con id = contesto corrente.
-- ---------------------------------------------------------------------------

ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_select ON "Tenant" FOR SELECT
  USING (
    id = app_current_tenant_id()
    OR app_rls_bypass()
    OR EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."tenantId" = "Tenant".id
        AND m."userId" = app_current_user_id()
        AND m.status = 'ACTIVE'
    )
  );
CREATE POLICY tenant_insert ON "Tenant" FOR INSERT
  WITH CHECK (id = app_current_tenant_id() OR app_rls_bypass());
CREATE POLICY tenant_update ON "Tenant" FOR UPDATE
  USING (id = app_current_tenant_id() OR app_rls_bypass())
  WITH CHECK (id = app_current_tenant_id() OR app_rls_bypass());
CREATE POLICY tenant_delete ON "Tenant" FOR DELETE
  USING (app_rls_bypass());

-- ---------------------------------------------------------------------------
-- AuditLog: append-only per l'applicazione (nessuna policy UPDATE/DELETE).
-- Le righe con tenantId NULL (eventi di piattaforma) sono visibili solo in bypass.
-- ---------------------------------------------------------------------------

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_select ON "AuditLog" FOR SELECT
  USING ("tenantId" = app_current_tenant_id() OR app_rls_bypass());
CREATE POLICY audit_insert ON "AuditLog" FOR INSERT
  WITH CHECK ("tenantId" = app_current_tenant_id() OR app_rls_bypass());

-- ---------------------------------------------------------------------------
-- CanonicalFlower: dati di riferimento globali, leggibili da tutti, scrivibili solo
-- in contesto di sistema (seed / admin di piattaforma).
-- ---------------------------------------------------------------------------

ALTER TABLE "CanonicalFlower" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CanonicalFlower" FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_read ON "CanonicalFlower" FOR SELECT USING (true);
CREATE POLICY canonical_insert ON "CanonicalFlower" FOR INSERT WITH CHECK (app_rls_bypass());
CREATE POLICY canonical_update ON "CanonicalFlower" FOR UPDATE
  USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());
CREATE POLICY canonical_delete ON "CanonicalFlower" FOR DELETE USING (app_rls_bypass());

-- ---------------------------------------------------------------------------
-- Vincoli di integrità non esprimibili nello schema Prisma
-- ---------------------------------------------------------------------------

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_marketCountry_check" CHECK ("marketCountry" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "Tenant_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Tenant_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "Location"
  ADD CONSTRAINT "Location_countryCode_check" CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "Location_deliveryRadiusKm_check" CHECK ("deliveryRadiusKm" IS NULL OR "deliveryRadiusKm" >= 0);

ALTER TABLE "CatalogItem"
  ADD CONSTRAINT "CatalogItem_priceMinor_check" CHECK ("priceMinor" >= 0),
  ADD CONSTRAINT "CatalogItem_costMinor_check" CHECK ("costMinor" IS NULL OR "costMinor" >= 0),
  ADD CONSTRAINT "CatalogItem_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "CatalogItem_prepMinutes_check" CHECK ("prepMinutes" IS NULL OR "prepMinutes" >= 0),
  ADD CONSTRAINT "CatalogItem_dimensions_check" CHECK (
    ("heightCm" IS NULL OR "heightCm" > 0) AND ("widthCm" IS NULL OR "widthCm" > 0)
  );

ALTER TABLE "BouquetRecipe"
  ADD CONSTRAINT "BouquetRecipe_laborCostMinor_check" CHECK ("laborCostMinor" IS NULL OR "laborCostMinor" >= 0);

ALTER TABLE "BouquetRecipeLine"
  ADD CONSTRAINT "BouquetRecipeLine_quantity_check" CHECK ("quantity" > 0);

ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_amounts_check" CHECK (
    "subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" >= 0
  ),
  ADD CONSTRAINT "Quote_number_check" CHECK ("number" > 0);

ALTER TABLE "QuoteLine"
  ADD CONSTRAINT "QuoteLine_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "QuoteLine_unitPriceMinor_check" CHECK ("unitPriceMinor" >= 0);

ALTER TABLE "AiJob"
  ADD CONSTRAINT "AiJob_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= "maxAttempts"),
  ADD CONSTRAINT "AiJob_usageUnits_check" CHECK ("usageUnits" >= 0);
