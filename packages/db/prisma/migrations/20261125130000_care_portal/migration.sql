-- Floral Care, blocco 5a (ADR-084): la pagina del cliente ("Mi Floral Care").
--
-- La fioreria invita una persona a vedere i contratti di un suo cliente (uno o tutti); la persona
-- li legge in una modalità del database chiusa di default: niente `app.tenant_id`, quindi
-- `tenant_isolation` non dà nulla, e si vedono solo le righe delle policy `portal_read` delle
-- tabelle ammesse, per il contratto scelto da `app_portal_enter`. "Cambiar fecha" scrive nel
-- contesto della fioreria (i posti si contano su tutte le visite) con in più la guardia
-- `portal_write_guard`: dal portale si aggiorna solo una visita di quel contratto.
--
-- Solo enum nuovi: si possono usare nella stessa migrazione.


-- CreateEnum
CREATE TYPE "CarePortalInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CarePortalRevokeReason" AS ENUM ('MANUAL', 'CUSTOMER_ARCHIVED', 'CONTRACT_ENDED');

-- AlterTable
ALTER TABLE "CareVisit" ADD COLUMN     "customerMovedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CustomerSubscription" ADD COLUMN     "minNoticeHours" INTEGER;

-- CreateTable
CREATE TABLE "CarePortalInvite" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "subscriptionId" UUID,
    "email" TEXT NOT NULL,
    "canSeeMoney" BOOLEAN NOT NULL DEFAULT true,
    "status" "CarePortalInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "emailSentAt" TIMESTAMP(3),
    "createdById" UUID,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" UUID,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarePortalInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePortalAccess" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "subscriptionId" UUID,
    "userId" UUID NOT NULL,
    "inviteId" UUID NOT NULL,
    "canSeeMoney" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" "CarePortalRevokeReason",
    "revokedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarePortalAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarePortalInvite_tenantId_customerId_status_idx" ON "CarePortalInvite"("tenantId", "customerId", "status");

-- CreateIndex
CREATE INDEX "CarePortalInvite_tenantId_subscriptionId_idx" ON "CarePortalInvite"("tenantId", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "CarePortalInvite_tenantId_id_key" ON "CarePortalInvite"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CarePortalInvite_tenantId_id_customerId_key" ON "CarePortalInvite"("tenantId", "id", "customerId");

-- CreateIndex
CREATE INDEX "CarePortalAccess_userId_idx" ON "CarePortalAccess"("userId");

-- CreateIndex
CREATE INDEX "CarePortalAccess_tenantId_customerId_idx" ON "CarePortalAccess"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "CarePortalAccess_tenantId_subscriptionId_idx" ON "CarePortalAccess"("tenantId", "subscriptionId");

-- CreateIndex
CREATE INDEX "CarePortalAccess_tenantId_inviteId_idx" ON "CarePortalAccess"("tenantId", "inviteId");

-- CreateIndex
CREATE UNIQUE INDEX "CarePortalAccess_tenantId_id_key" ON "CarePortalAccess"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "CarePortalInvite" ADD CONSTRAINT "CarePortalInvite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePortalInvite" ADD CONSTRAINT "CarePortalInvite_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePortalInvite" ADD CONSTRAINT "CarePortalInvite_tenantId_subscriptionId_customerId_fkey" FOREIGN KEY ("tenantId", "subscriptionId", "customerId") REFERENCES "CustomerSubscription"("tenantId", "id", "customerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePortalAccess" ADD CONSTRAINT "CarePortalAccess_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePortalAccess" ADD CONSTRAINT "CarePortalAccess_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePortalAccess" ADD CONSTRAINT "CarePortalAccess_tenantId_subscriptionId_customerId_fkey" FOREIGN KEY ("tenantId", "subscriptionId", "customerId") REFERENCES "CustomerSubscription"("tenantId", "id", "customerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePortalAccess" ADD CONSTRAINT "CarePortalAccess_tenantId_inviteId_customerId_fkey" FOREIGN KEY ("tenantId", "inviteId", "customerId") REFERENCES "CarePortalInvite"("tenantId", "id", "customerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePortalAccess" ADD CONSTRAINT "CarePortalAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Vincoli e indici che Prisma non vede
-- -----------------------------------------------------------------------------

-- Un solo invito in attesa per cliente ed email (un invito nuovo revoca il precedente).
CREATE UNIQUE INDEX "CarePortalInvite_one_pending_key"
  ON "CarePortalInvite" ("tenantId", "customerId", "email") WHERE "status" = 'PENDING';

-- Un accesso attivo per persona e ambito (tutti i contratti del cliente, oppure uno).
CREATE UNIQUE INDEX "CarePortalAccess_active_customer_key"
  ON "CarePortalAccess" ("tenantId", "customerId", "userId")
  WHERE "subscriptionId" IS NULL AND "revokedAt" IS NULL;
CREATE UNIQUE INDEX "CarePortalAccess_active_contract_key"
  ON "CarePortalAccess" ("tenantId", "subscriptionId", "userId")
  WHERE "subscriptionId" IS NOT NULL AND "revokedAt" IS NULL;
CREATE INDEX "CarePortalAccess_active_user_idx"
  ON "CarePortalAccess" ("userId") WHERE "revokedAt" IS NULL;

ALTER TABLE "CarePortalInvite" ADD CONSTRAINT "CarePortalInvite_values_check" CHECK (
  "email" = lower(btrim("email"))
  AND char_length("email") BETWEEN 3 AND 254
  AND "expiresAt" > "createdAt"
  AND ("status" = 'ACCEPTED') = ("acceptedAt" IS NOT NULL)
  AND ("status" = 'ACCEPTED') = ("acceptedUserId" IS NOT NULL)
  AND ("status" = 'REVOKED') = ("revokedAt" IS NOT NULL)
  AND ("revokedById" IS NULL OR "status" = 'REVOKED')
);

ALTER TABLE "CarePortalAccess" ADD CONSTRAINT "CarePortalAccess_values_check" CHECK (
  ("revokedAt" IS NULL) = ("revokedReason" IS NULL)
  AND ("revokedById" IS NULL OR "revokedAt" IS NOT NULL)
);

SELECT app_enable_tenant_rls('"CarePortalInvite"');
SELECT app_enable_tenant_rls('"CarePortalAccess"');

-- -----------------------------------------------------------------------------
-- Preavviso per cambiare la data, copiato nel contratto alla conferma come le altre regole
-- (ADR-082). I contratti già confermati prendono quello di oggi della fioreria (24 se manca).
-- -----------------------------------------------------------------------------
SELECT set_config('app.bypass_rls', 'on', false);
UPDATE "CustomerSubscription" s
SET "minNoticeHours" = c."minNoticeHours"
FROM "CareSettings" c
WHERE c."tenantId" = s."tenantId" AND s."kind" = 'CARE' AND s."confirmedAt" IS NOT NULL;
UPDATE "CustomerSubscription"
SET "minNoticeHours" = 24
WHERE "kind" = 'CARE' AND "confirmedAt" IS NOT NULL AND "minNoticeHours" IS NULL;
SELECT set_config('app.bypass_rls', '', false);

ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_min_notice_check" CHECK (
  ("minNoticeHours" IS NULL OR "minNoticeHours" BETWEEN 0 AND 168)
  AND ("kind" <> 'CARE' OR "confirmedAt" IS NULL OR "minNoticeHours" IS NOT NULL)
);

-- -----------------------------------------------------------------------------
-- Modalità portale: chi la imposta è solo `app_portal_enter` (sotto)
-- -----------------------------------------------------------------------------

CREATE FUNCTION app_portal_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.portal_tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_portal_customer_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.portal_customer_id', true), '')::uuid $$;

CREATE FUNCTION app_portal_subscription_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.portal_subscription_id', true), '')::uuid $$;

-- "Puede ver precios y cobros": senza, i cargos non escono nemmeno dal database.
CREATE FUNCTION app_portal_money() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(current_setting('app.portal_money', true), '') = 'on' $$;

-- La lettura dal portale di una tabella della fioreria: solo le righe del contratto scelto. Il
-- primo controllo è il più economico: fuori dal portale la policy si ferma lì.
CREATE FUNCTION app_enable_portal_read(target regclass, predicate text) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS portal_read ON %s', target);
  EXECUTE format(
    'CREATE POLICY portal_read ON %s FOR SELECT USING ('
      'app_portal_subscription_id() IS NOT NULL AND "tenantId" = app_portal_tenant_id() AND (%s))',
    target,
    predicate
  );
END
$$;

-- Le tabelle ammesse. Nessun'altra tabella dà righe in modalità portale (Tenant, Membership,
-- ordini, pagamenti, avvisi interni, blocchi, registro, accessi…).
SELECT app_enable_portal_read('"CustomerSubscription"', 'id = app_portal_subscription_id()');
SELECT app_enable_portal_read('"CustomerSubscriptionService"', '"subscriptionId" = app_portal_subscription_id()');
SELECT app_enable_portal_read('"CustomerSubscriptionSlot"', '"subscriptionId" = app_portal_subscription_id()');
SELECT app_enable_portal_read('"CareVisit"', '"subscriptionId" = app_portal_subscription_id()');
SELECT app_enable_portal_read('"CarePlant"', '"subscriptionId" = app_portal_subscription_id()');
SELECT app_enable_portal_read(
  '"CarePhoto"',
  '"subscriptionId" = app_portal_subscription_id() AND "removedAt" IS NULL AND "deletedAt" IS NULL'
);
SELECT app_enable_portal_read(
  '"CareCharge"',
  '"subscriptionId" = app_portal_subscription_id() AND "customerId" = app_portal_customer_id() AND app_portal_money()'
);
SELECT app_enable_portal_read(
  '"CareChargeLine"',
  '"subscriptionId" = app_portal_subscription_id() AND app_portal_money()'
);
SELECT app_enable_portal_read(
  '"CareVisitServiceResult"',
  'EXISTS (SELECT 1 FROM "CareVisit" v WHERE v."tenantId" = "CareVisitServiceResult"."tenantId" AND v.id = "CareVisitServiceResult"."visitId" AND v."subscriptionId" = app_portal_subscription_id())'
);
SELECT app_enable_portal_read(
  '"CareVisitPlantResult"',
  'EXISTS (SELECT 1 FROM "CareVisit" v WHERE v."tenantId" = "CareVisitPlantResult"."tenantId" AND v.id = "CareVisitPlantResult"."visitId" AND v."subscriptionId" = app_portal_subscription_id())'
);
SELECT app_enable_portal_read(
  '"CareSlot"',
  'id IN (SELECT "slotId" FROM "CustomerSubscriptionSlot" WHERE "subscriptionId" = app_portal_subscription_id()) OR id IN (SELECT "slotId" FROM "CareVisit" WHERE "subscriptionId" = app_portal_subscription_id() AND "slotId" IS NOT NULL)'
);
SELECT app_enable_portal_read('"Customer"', 'id = app_portal_customer_id()');
SELECT app_enable_portal_read(
  '"CustomerAddress"',
  '"customerId" = app_portal_customer_id() AND id = (SELECT "customerAddressId" FROM "CustomerSubscription" WHERE id = app_portal_subscription_id())'
);

-- Dal portale si aggiorna solo una visita del contratto scelto ("Cambiar fecha"); fuori dal
-- portale la guardia non c'è.
CREATE POLICY portal_write_guard ON "CareVisit" AS RESTRICTIVE FOR UPDATE
  USING (app_portal_subscription_id() IS NULL OR "subscriptionId" = app_portal_subscription_id())
  WITH CHECK (app_portal_subscription_id() IS NULL OR "subscriptionId" = app_portal_subscription_id());

-- -----------------------------------------------------------------------------
-- La regola unica di visibilità: accessi attivi × contratti. Un contratto si vede attivo o in
-- pausa, oppure finito fino al giorno in cui si cancellano le foto (fine + 30, escluso). Stessa
-- regola di `carePortalContractState` nel dominio. Si chiama solo dalle funzioni qui sotto, già
-- con il bypass: da sola, con la RLS, non vede niente.
-- -----------------------------------------------------------------------------
CREATE FUNCTION app_portal_visible_contracts(person uuid)
RETURNS TABLE (
  tenant_id uuid,
  customer_id uuid,
  subscription_id uuid,
  can_see_money boolean,
  read_only boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT a."tenantId", a."customerId", s.id, bool_or(a."canSeeMoney"), s.status = 'ENDED'
  FROM "CarePortalAccess" a
  JOIN "Tenant" t ON t.id = a."tenantId" AND t.status = 'ACTIVE'
  JOIN "Customer" c ON c."tenantId" = a."tenantId" AND c.id = a."customerId" AND c.status = 'ACTIVE'
  JOIN "CustomerSubscription" s
    ON s."tenantId" = a."tenantId" AND s."customerId" = a."customerId"
   AND (a."subscriptionId" IS NULL OR s.id = a."subscriptionId")
  WHERE a."userId" = person
    AND a."revokedAt" IS NULL
    AND s.kind = 'CARE'
    AND (
      s.status IN ('ACTIVE', 'PAUSED')
      OR (
        s.status = 'ENDED'
        AND coalesce(s."endDate", ((s."endedAt" AT TIME ZONE 'UTC') AT TIME ZONE t.timezone)::date)
            + 30 > (now() AT TIME ZONE t.timezone)::date
      )
    )
  GROUP BY a."tenantId", a."customerId", s.id, s.status
$$;

-- Entra nel portale per un contratto: la persona viene solo dalla sessione (`app.user_id`). Senza
-- accesso non imposta nulla e non restituisce righe. Nel contesto di scrittura la fioreria deve
-- essere quella del contratto. Restituisce quello che il portale mostra e non può leggere
-- (fioreria, termini).
CREATE FUNCTION app_portal_enter(target uuid)
RETURNS TABLE (
  tenant_id uuid,
  customer_id uuid,
  subscription_id uuid,
  can_see_money boolean,
  read_only boolean,
  shop_slug text,
  shop_name text,
  shop_timezone text,
  shop_market text,
  shop_currency text,
  shop_mode text,
  shop_email text,
  shop_phone text,
  terms_text text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  person uuid := app_current_user_id();
  hit record;
BEGIN
  IF person IS NULL OR target IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.bypass_rls', 'on', true);
  SELECT v.tenant_id, v.customer_id, v.subscription_id, v.can_see_money, v.read_only,
         t.slug, t."displayName", t.timezone, t."marketCountry"::text, t.currency::text,
         t.mode::text, t."contactEmail", t."contactPhone", cs."termsText"
    INTO hit
    FROM app_portal_visible_contracts(person) v
    JOIN "Tenant" t ON t.id = v.tenant_id
    LEFT JOIN "CareSettings" cs ON cs."tenantId" = v.tenant_id
   WHERE v.subscription_id = target
   LIMIT 1;
  IF NOT FOUND THEN
    PERFORM set_config('app.bypass_rls', previous, true);
    RETURN;
  END IF;
  IF app_current_tenant_id() IS NOT NULL AND app_current_tenant_id() <> hit.tenant_id THEN
    PERFORM set_config('app.bypass_rls', previous, true);
    RETURN;
  END IF;
  PERFORM set_config('app.portal_tenant_id', hit.tenant_id::text, true);
  PERFORM set_config('app.portal_customer_id', hit.customer_id::text, true);
  PERFORM set_config('app.portal_subscription_id', hit.subscription_id::text, true);
  PERFORM set_config('app.portal_money', CASE WHEN hit.can_see_money THEN 'on' ELSE '' END, true);
  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN QUERY SELECT hit.tenant_id, hit.customer_id, hit.subscription_id, hit.can_see_money,
                      hit.read_only, hit.slug, hit."displayName", hit.timezone, hit."marketCountry",
                      hit.currency, hit.mode, hit."contactEmail", hit."contactPhone",
                      hit."termsText";
END;
$$;

-- "Mi Floral Care": i contratti della persona, fra tutte le fiorerie (al massimo 100), con la
-- prossima visita e, se può vedere i soldi, quanto c'è da pagare.
CREATE FUNCTION app_buyer_care_contracts()
RETURNS TABLE (
  tenant_id uuid,
  subscription_id uuid,
  shop_slug text,
  shop_name text,
  shop_timezone text,
  number integer,
  status text,
  read_only boolean,
  can_see_money boolean,
  customer_name text,
  site_label text,
  site_line text,
  end_date date,
  next_visit_date date,
  next_visit_start integer,
  due_minor integer,
  currency text
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
    SELECT v.tenant_id, v.subscription_id, t.slug, t."displayName", t.timezone, s.number,
           s.status::text, v.read_only, v.can_see_money, c."displayName",
           addr.label, addr."addressLine1", s."endDate",
           nv."scheduledDate", nv."startMinutes",
           CASE WHEN v.can_see_money THEN (
             SELECT coalesce(sum(greatest(ch."totalMinor" - ch."paidMinor", 0)), 0)::integer
             FROM "CareCharge" ch
             WHERE ch."tenantId" = v.tenant_id AND ch."subscriptionId" = v.subscription_id
           ) ELSE NULL END,
           s.currency::text
    FROM app_portal_visible_contracts(person) v
    JOIN "Tenant" t ON t.id = v.tenant_id
    JOIN "CustomerSubscription" s ON s."tenantId" = v.tenant_id AND s.id = v.subscription_id
    JOIN "Customer" c ON c."tenantId" = v.tenant_id AND c.id = v.customer_id
    LEFT JOIN "CustomerAddress" addr
      ON addr."tenantId" = s."tenantId" AND addr.id = s."customerAddressId"
    LEFT JOIN LATERAL (
      SELECT cv."scheduledDate", cv."startMinutes"
      FROM "CareVisit" cv
      WHERE cv."tenantId" = s."tenantId" AND cv."subscriptionId" = s.id
        AND cv.status = 'SCHEDULED'
        AND cv."scheduledDate" >= (now() AT TIME ZONE t.timezone)::date
      ORDER BY cv."scheduledDate", cv."startMinutes"
      LIMIT 1
    ) nv ON true
    ORDER BY v.read_only, t."displayName", s.number
    LIMIT 100;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- "Descargar mis datos": tutti gli accessi della persona, anche quelli chiusi.
CREATE FUNCTION app_buyer_care_access()
RETURNS TABLE (
  shop_name text,
  customer_name text,
  contract_number integer,
  can_see_money boolean,
  created_at timestamp,
  revoked_at timestamp,
  revoked_reason text
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
    SELECT t."displayName", c."displayName", s.number, a."canSeeMoney", a."createdAt",
           a."revokedAt", a."revokedReason"::text
    FROM "CarePortalAccess" a
    JOIN "Tenant" t ON t.id = a."tenantId"
    JOIN "Customer" c ON c."tenantId" = a."tenantId" AND c.id = a."customerId"
    LEFT JOIN "CustomerSubscription" s
      ON s."tenantId" = a."tenantId" AND s.id = a."subscriptionId"
    WHERE a."userId" = person
    ORDER BY a."createdAt"
    LIMIT 500;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- Il lavoro giornaliero: gli accessi da chiudere (solo gli ID). Uno limitato a un contratto che non
-- si vede più; uno per tutti i contratti quando il cliente non ha più nulla in corso (borrador,
-- attivo, in pausa o finito da meno di `retention_days`).
CREATE FUNCTION app_care_portal_access_to_close(retention_days integer, max_rows integer)
RETURNS TABLE (tenant_id uuid, access_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT a."tenantId", a.id
    FROM "CarePortalAccess" a
    JOIN "Tenant" t ON t.id = a."tenantId" AND t.status = 'ACTIVE'
    WHERE a."revokedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "CustomerSubscription" s
        WHERE s."tenantId" = a."tenantId" AND s."customerId" = a."customerId" AND s.kind = 'CARE'
          AND (a."subscriptionId" IS NULL OR s.id = a."subscriptionId")
          AND (
            s.status IN ('ACTIVE', 'PAUSED')
            OR (a."subscriptionId" IS NULL AND s.status = 'DRAFT')
            OR (
              s.status = 'ENDED'
              AND coalesce(s."endDate", ((s."endedAt" AT TIME ZONE 'UTC') AT TIME ZONE t.timezone)::date)
                  + retention_days > (now() AT TIME ZONE t.timezone)::date
            )
          )
      )
    ORDER BY a."tenantId", a.id
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- Gli inviti scaduti, insieme a preventivi e inviti della squadra (ADR-040): lo stesso tipo
-- restituito, gli inviti del portale contano con quelli della squadra.
CREATE OR REPLACE FUNCTION app_expire_overdue()
RETURNS TABLE (quotes_expired integer, invitations_expired integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  utc_now timestamp := now() AT TIME ZONE 'UTC';
  quotes integer;
  invitations integer;
  portal_invitations integer;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  -- Stessa regola di effectiveQuoteStatus (packages/domain): scaduto dal giorno DOPO validUntil.
  UPDATE "Quote" AS q
  SET status = 'EXPIRED', "statusChangedAt" = utc_now, "updatedAt" = utc_now
  FROM "Tenant" AS t
  WHERE q."tenantId" = t.id
    AND q.status = 'SENT'
    AND q."validUntil" IS NOT NULL
    AND q."validUntil" < (now() AT TIME ZONE t.timezone)::date;
  GET DIAGNOSTICS quotes = ROW_COUNT;

  UPDATE "Invitation"
  SET status = 'EXPIRED', "updatedAt" = utc_now
  WHERE status = 'PENDING' AND "expiresAt" < utc_now;
  GET DIAGNOSTICS invitations = ROW_COUNT;

  UPDATE "CarePortalInvite"
  SET status = 'EXPIRED', "updatedAt" = utc_now
  WHERE status = 'PENDING' AND "expiresAt" <= utc_now;
  GET DIAGNOSTICS portal_invitations = ROW_COUNT;

  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN QUERY SELECT quotes, invitations + portal_invitations;
END;
$$;
