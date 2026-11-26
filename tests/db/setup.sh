#!/bin/sh
# Builds a throwaway local database with the game's tables in it. Needs PostgreSQL 14 or newer running locally.
# Usage: sh tests/db/setup.sh   (then: node tests/db/run.cjs)
set -e
DB=${ICEBERG_TEST_DB:-icetest}
cd "$(dirname "$0")/../.."
RUN="psql -v ON_ERROR_STOP=1 -q -U postgres"
$RUN -c "drop database if exists $DB" -c "create database $DB"
for f in tests/db/auth_stub.sql supabase/0001_community.sql supabase/0002_accounts.sql supabase/0003_answers_*.sql supabase/0004_race.sql supabase/0005_race_answers.sql supabase/0006_content.sql; do $RUN -d $DB -f "$f" > /dev/null; done
$RUN -d $DB -f supabase/0001_community.sql > /dev/null   # twice, to prove each file can be run again
$RUN -d $DB -f supabase/0002_accounts.sql > /dev/null
$RUN -d $DB -f supabase/0004_race.sql > /dev/null
# The later files, in the order production gets them (0011 twice, to prove it can be run again).
for f in supabase/0007_intelligence.sql supabase/0008_ranked.sql supabase/0009_first_discoveries.sql supabase/0010_round_types.sql supabase/0011_live_rounds.sql supabase/0011_live_rounds.sql supabase/0012_race_no_break.sql; do $RUN -d $DB -f "$f" > /dev/null; done
echo "database $DB ready"
