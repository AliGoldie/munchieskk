#!/usr/bin/env bash
# Runs the Postgres-level regression tests in supabase/tests/*.test.sql
# against a disposable, freshly-created database -- never a real project
# database. Requires a reachable Postgres server (set TEST_DATABASE_URL to
# point at one; defaults to a local server on localhost:5432).
set -euo pipefail

ADMIN_DB_URL="${TEST_DATABASE_URL:-postgres://postgres@localhost:5432/postgres}"
TEST_DB="munchieskk_db_tests"
TEST_DB_URL="${ADMIN_DB_URL%/*}/${TEST_DB}"

cd "$(dirname "$0")/../.."

psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${TEST_DB};"
psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${TEST_DB};"

# Real Supabase projects always have these roles; a bare postgres:16 (local
# or CI) doesn't. Some migrations GRANT/REVOKE against them, so tests that
# load those migrations need the roles to exist first. Cluster-level and
# idempotent -- safe to run every time.
psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -c "
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
\$\$;
"

status=0
for f in supabase/tests/*.test.sql; do
  echo "Running $f..."
  if ! psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f "$f"; then
    status=1
  fi
done

psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE ${TEST_DB};"

if [ "$status" -ne 0 ]; then
  echo "DB tests FAILED"
  exit 1
fi
echo "All DB tests passed."
