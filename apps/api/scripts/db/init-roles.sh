#!/usr/bin/env bash
# Creates the least-privilege roles + database by running roles.sql with psql.
# Used by docker-compose.test.yml (/docker-entrypoint-initdb.d) and by
# scripts/test-services.sh. TEST ONLY defaults; never reuse these passwords.
set -euo pipefail

SQL_FILE="${ROLES_SQL_FILE:-$(dirname "$0")/roles.sql}"
DB_NAME="${NZT_DB_NAME:-nzt_test}"
MIGRATOR_PASSWORD="${NZT_MIGRATOR_PASSWORD:-nzt_migrator_test}"
APP_PASSWORD="${NZT_APP_PASSWORD:-nzt_app_test}"

psql -v ON_ERROR_STOP=1 \
  ${PGHOST:+-h "$PGHOST"} ${PGPORT:+-p "$PGPORT"} \
  --username "${POSTGRES_USER:-postgres}" --dbname postgres \
  -v db_name="$DB_NAME" \
  -v migrator_password="$MIGRATOR_PASSWORD" \
  -v app_password="$APP_PASSWORD" \
  -f "$SQL_FILE"
