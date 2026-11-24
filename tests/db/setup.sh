#!/bin/sh
# Builds a throwaway local database with the game's tables in it. Needs PostgreSQL 14 or newer running locally.
# Usage: sh tests/db/setup.sh   (then: node tests/db/run.cjs)
set -e
DB=${ICEBERG_TEST_DB:-icetest}
cd "$(dirname "$0")/../.."
RUN="psql -v ON_ERROR_STOP=1 -q -U postgres"
$RUN -c "drop database if exists $DB" -c "create database $DB"
for f in tests/db/auth_stub.sql supabase/0001_community.sql supabase/0002_accounts.sql supabase/0003_answers_*.sql; do $RUN -d $DB -f "$f" > /dev/null; done
$RUN -d $DB -f supabase/0001_community.sql > /dev/null   # twice, to prove each file can be run again
$RUN -d $DB -f supabase/0002_accounts.sql > /dev/null
echo "database $DB ready"
