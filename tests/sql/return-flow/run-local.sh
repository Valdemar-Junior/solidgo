#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PGDATA_DIR="${TMPDIR:-/tmp}/solidgo-return-pg"
PGPORT_VALUE="${SOLIDGO_TEST_PGPORT:-55432}"
DATABASE_NAME="solidgo_return_test"
UPGRADE_DATABASE_NAME="solidgo_return_upgrade_test"
CONCURRENCY_DATABASE_NAME="solidgo_return_concurrency_test"
STARTED_HERE=0

if [[ ! -f "$PGDATA_DIR/PG_VERSION" ]]; then
  initdb -D "$PGDATA_DIR" --auth=trust --no-locale --encoding=UTF8 >/dev/null
fi

if ! pg_isready -p "$PGPORT_VALUE" >/dev/null 2>&1; then
  pg_ctl -D "$PGDATA_DIR" -o "-p $PGPORT_VALUE" -l "$PGDATA_DIR.log" start >/dev/null
  STARTED_HERE=1
fi

cleanup() {
  if [[ "$STARTED_HERE" == "1" ]]; then
    pg_ctl -D "$PGDATA_DIR" stop -m fast >/dev/null
  fi
}
trap cleanup EXIT

dropdb -p "$PGPORT_VALUE" --if-exists "$DATABASE_NAME"
createdb -p "$PGPORT_VALUE" "$DATABASE_NAME"

psql -p "$PGPORT_VALUE" -d "$DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/tests/sql/return-flow/bootstrap.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707143000_sync_pickups_from_processed_returns.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707153000_track_pickups_per_return_event.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707164000_manage_return_pickup_links.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707180000_reconcile_returns_on_route_completion.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707183000_harden_return_quantities_and_pickup_links.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260708100000_block_route_start_with_fully_returned_orders.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/tests/sql/return-flow/reconciled-behavior.sql"
psql -p "$PGPORT_VALUE" -d "$DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/tests/sql/return-flow/hardened-breaches.sql"
psql -p "$PGPORT_VALUE" -d "$DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/tests/sql/return-flow/route-start-guard.sql"

dropdb -p "$PGPORT_VALUE" --if-exists "$UPGRADE_DATABASE_NAME"
createdb -p "$PGPORT_VALUE" "$UPGRADE_DATABASE_NAME"

psql -p "$PGPORT_VALUE" -d "$UPGRADE_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/tests/sql/return-flow/bootstrap.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$UPGRADE_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707143000_sync_pickups_from_processed_returns.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$UPGRADE_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707153000_track_pickups_per_return_event.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$UPGRADE_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707164000_manage_return_pickup_links.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$UPGRADE_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707180000_reconcile_returns_on_route_completion.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$UPGRADE_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/tests/sql/return-flow/pre-hardening-fixture.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$UPGRADE_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707183000_harden_return_quantities_and_pickup_links.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$UPGRADE_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260708100000_block_route_start_with_fully_returned_orders.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$UPGRADE_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/tests/sql/return-flow/post-hardening-assert.sql"

dropdb -p "$PGPORT_VALUE" --if-exists "$CONCURRENCY_DATABASE_NAME"
createdb -p "$PGPORT_VALUE" "$CONCURRENCY_DATABASE_NAME"

psql -p "$PGPORT_VALUE" -d "$CONCURRENCY_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/tests/sql/return-flow/bootstrap.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$CONCURRENCY_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707143000_sync_pickups_from_processed_returns.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$CONCURRENCY_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707153000_track_pickups_per_return_event.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$CONCURRENCY_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707164000_manage_return_pickup_links.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$CONCURRENCY_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707180000_reconcile_returns_on_route_completion.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$CONCURRENCY_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260707183000_harden_return_quantities_and_pickup_links.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$CONCURRENCY_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/migrations/20260708100000_block_route_start_with_fully_returned_orders.sql" >/dev/null
psql -p "$PGPORT_VALUE" -d "$CONCURRENCY_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/tests/sql/return-flow/concurrency-fixture.sql" >/dev/null

psql -p "$PGPORT_VALUE" -d "$CONCURRENCY_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/tests/sql/return-flow/concurrency-a.sql" >/tmp/solidgo-concurrency-a.log 2>&1 &
CONCURRENCY_A_PID=$!
sleep 0.2

set +e
psql -p "$PGPORT_VALUE" -d "$CONCURRENCY_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/tests/sql/return-flow/concurrency-b.sql" >/tmp/solidgo-concurrency-b.log 2>&1
CONCURRENCY_B_STATUS=$?
set -e

wait "$CONCURRENCY_A_PID"

if [[ "$CONCURRENCY_B_STATUS" == "0" ]]; then
  echo "FALHOU: a segunda criação simultânea deveria ter sido rejeitada" >&2
  exit 1
fi

psql -p "$PGPORT_VALUE" -d "$CONCURRENCY_DATABASE_NAME" -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/tests/sql/return-flow/concurrency-assert.sql"
