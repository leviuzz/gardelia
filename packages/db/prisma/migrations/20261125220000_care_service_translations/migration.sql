-- =============================================================================
-- Floral Care: nomi dei servizi nelle altre lingue (ADR-042, feedback del founder del 25/11).
--
-- Il nome principale di un servizio resta quello della lingua del mercato: lo leggono i clienti
-- (rapporto della visita, email, addebiti). `translations` tiene i nomi per chi usa l'app in
-- un'altra lingua ({"it-IT": "…", "en-US": "…"}). La copia sul contratto
-- (`CustomerSubscriptionService`) porta anche le traduzioni, perché Mi Floral Care non legge
-- `CareService` (lì ci sono i prezzi, che non tutti vedono).
-- =============================================================================

ALTER TABLE "CareService" ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "CustomerSubscriptionService" ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}';

-- -----------------------------------------------------------------------------
-- Dati di prima (staging): i servizi della nostra lista ricevono italiano e inglese, solo nelle
-- fiorerie del Messico (nome principale in spagnolo) e solo se il fiorista non li ha rinominati.
-- Poi le copie sui contratti con lo stesso nome. Le tabelle hanno FORCE RLS: si passa dal bypass
-- come in `care_late_cancel`.
-- -----------------------------------------------------------------------------
SELECT set_config('app.bypass_rls', 'on', false);
WITH "preset" ("key", "name", "translations") AS (
  VALUES
    ('watering', 'Riego', '{"it-IT": "Irrigazione", "en-US": "Watering"}'::jsonb),
    ('leaf_cleaning', 'Limpieza de hojas',
      '{"it-IT": "Pulizia delle foglie", "en-US": "Leaf cleaning"}'::jsonb),
    ('pruning', 'Poda y retiro de hojas secas',
      '{"it-IT": "Potatura e rimozione delle foglie secche", "en-US": "Pruning and dead leaf removal"}'::jsonb),
    ('pest_check', 'Revisión de plagas y enfermedades',
      '{"it-IT": "Controllo di parassiti e malattie", "en-US": "Pest and disease check"}'::jsonb),
    ('rotation', 'Rotación de plantas',
      '{"it-IT": "Rotazione delle piante", "en-US": "Plant rotation"}'::jsonb),
    ('pot_cleaning', 'Limpieza de macetas',
      '{"it-IT": "Pulizia dei vasi", "en-US": "Pot cleaning"}'::jsonb),
    ('fertilizing', 'Fertilización', '{"it-IT": "Concimazione", "en-US": "Fertilizing"}'::jsonb),
    ('substrate', 'Reposición de sustrato',
      '{"it-IT": "Aggiunta di terriccio", "en-US": "Substrate top-up"}'::jsonb),
    ('repotting', 'Trasplante', '{"it-IT": "Rinvaso", "en-US": "Repotting"}'::jsonb)
)
UPDATE "CareService" s
SET "translations" = p."translations"
FROM "preset" p, "Tenant" t
WHERE s."presetKey" = p."key"
  AND s."name" = p."name"
  AND s."translations" = '{}'::jsonb
  AND t."id" = s."tenantId"
  AND t."marketCountry" = 'MX';
UPDATE "CustomerSubscriptionService" l
SET "translations" = s."translations"
FROM "CareService" s
WHERE s."tenantId" = l."tenantId"
  AND s."id" = l."serviceId"
  AND l."name" = s."name"
  AND s."translations" <> '{}'::jsonb;
SELECT set_config('app.bypass_rls', '', false);

-- -----------------------------------------------------------------------------
-- Vincoli (Prisma non li vede): un oggetto con sole lingue note e testi.
-- -----------------------------------------------------------------------------
ALTER TABLE "CareService" ADD CONSTRAINT "CareService_translations_check" CHECK (
  jsonb_typeof("translations") = 'object'
  AND ("translations" - 'es-MX' - 'it-IT' - 'en-US') = '{}'::jsonb
  AND NOT jsonb_path_exists("translations", '$.* ? (@.type() != "string")')
);
ALTER TABLE "CustomerSubscriptionService" ADD CONSTRAINT "CustomerSubscriptionService_translations_check" CHECK (
  jsonb_typeof("translations") = 'object'
  AND ("translations" - 'es-MX' - 'it-IT' - 'en-US') = '{}'::jsonb
  AND NOT jsonb_path_exists("translations", '$.* ? (@.type() != "string")')
);
