#!/bin/sh
# Eseguito dal container Postgres al primo avvio (docker-entrypoint-initdb.d).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -f /floral-db-scripts/setup-local-roles.sql
