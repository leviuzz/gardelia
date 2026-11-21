-- =============================================================================
-- Floral OS — provisioning ruoli e database per SVILUPPO LOCALE e CI.
--
-- Eseguire come superuser Postgres, una sola volta per cluster:
--   psql -U postgres -f packages/db/scripts/setup-local-roles.sql
--
-- Modello a due ruoli (vedi docs/ARCHITECTURE.md § Isolamento dei tenant):
--   floral_owner → proprietario dello schema; esegue le migrazioni (DATABASE_MIGRATION_URL).
--   floral_app   → ruolo runtime dell'applicazione (DATABASE_URL): NON superuser,
--                  NON BYPASSRLS, NON proprietario delle tabelle ⇒ soggetto alle policy RLS.
--
-- Le password qui sotto sono valori di sviluppo NOTI e PUBBLICI: non usarle mai in
-- ambienti raggiungibili da internet. In produzione i ruoli vanno creati dal
-- provider/IaC con credenziali generate e conservate in un secret manager.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'floral_owner') THEN
    CREATE ROLE floral_owner LOGIN PASSWORD 'floral_owner_dev' NOSUPERUSER CREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'floral_app') THEN
    CREATE ROLE floral_app LOGIN PASSWORD 'floral_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

SELECT 'CREATE DATABASE floral_dev OWNER floral_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'floral_dev')\gexec

SELECT 'CREATE DATABASE floral_test OWNER floral_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'floral_test')\gexec

\connect floral_dev
\ir grant-app-role.sql

\connect floral_test
\ir grant-app-role.sql
