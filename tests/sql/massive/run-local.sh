#!/usr/bin/env bash
# Bateria massiva de testes de entrega + montagem. Sobe Postgres local, aplica
# baseline + migrations, roda ~18 cenarios e imprime PASS/BUG por checagem.
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HERE="$ROOT_DIR/tests/sql/massive"
STUBS="$ROOT_DIR/tests/sql/partial-delivery/00-stubs.sql"
PGDATA_DIR="${TMPDIR:-/tmp}/solidgo-massive-pg"; PORT="${SOLIDGO_TEST_PGPORT:-55442}"; DB="solidgo_massive_test"; STARTED=0

[ -f "$PGDATA_DIR/PG_VERSION" ] || initdb -D "$PGDATA_DIR" --auth=trust --no-locale --encoding=UTF8 >/dev/null
if ! pg_isready -p "$PORT" >/dev/null 2>&1; then pg_ctl -D "$PGDATA_DIR" -o "-p $PORT" -l "$PGDATA_DIR.log" start >/dev/null; STARTED=1; fi
trap '[ "$STARTED" = 1 ] && pg_ctl -D "$PGDATA_DIR" stop -m fast >/dev/null || true' EXIT

dropdb -p "$PORT" --if-exists "$DB" >/dev/null 2>&1; createdb -p "$PORT" "$DB"
# Producao (Supabase) roda em UTC. Igualamos o fuso pra o teste refletir a realidade.
psql -p "$PORT" -d "$DB" -q -c "ALTER DATABASE \"$DB\" SET timezone TO 'UTC';" >/dev/null
q() { psql -p "$PORT" -d "$DB" -q "$@"; }

psql -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$STUBS" >/dev/null
psql -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT_DIR/supabase/migrations/00000000000000_baseline_schema.sql" >/dev/null
for m in 20260709160000_bloco3_carimbo_montagem_devolvida 20260709170000_bloco3_ponte_n8n_ingest_erp_return \
         20260709180000_bloco3_ingest_erp_return_payload_unico 20260709190000_bloco3_trigger_resync_shadow_items \
         20260709200000_entrega_parcial_fase1_view_entregue 20260709210000_entrega_parcial_fase1b_snapshot_remaining \
         20260709220000_entrega_parcial_fase2_montagem_por_entregue \
         20260709230000_fix_ingest_over_return_conflict \
         20260710000000_em_espera_order_item_holds 20260710010000_retirada_por_item \
         20260710020000_snapshot_pula_item_retirado 20260710030000_saldo_desconta_retirado \
         20260710040000_store_release_respeita_retirada_parcial 20260710050000_multiplas_retiradas_por_pedido; do
  psql -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT_DIR/supabase/migrations/$m.sql" >/dev/null
done
psql -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/helpers.sql" >/dev/null

# Roda cenarios SEM ON_ERROR_STOP (pra rodar tudo) e captura tudo.
psql -p "$PORT" -d "$DB" -f "$HERE/scenarios.sql" 2>&1
