#!/usr/bin/env bash
# ============================================================================
# Teste automatizado do fluxo de ENTREGA PARCIAL POR ITEM.
# Sobe um Postgres local, aplica o baseline + as migrations da feature, roda
# o cenario (entrega 1 item, retorna outro, finaliza, re-fila) e checa 4 asserts.
#   * A1: saldo "restante" por item (entregue=0, faltando=1)
#   * A2: montagem gerada SO do item entregue
#   * A3: pedido parcial volta pra fila (pending)
#   * A4: re-fila traz SO o item que falta -> sem risco de entrega dupla
#
# Uso: bash tests/sql/partial-delivery/run-local.sh
# Requer: postgresql (initdb/psql/pg_ctl) no PATH.
# ============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HERE="$ROOT_DIR/tests/sql/partial-delivery"
PGDATA_DIR="${TMPDIR:-/tmp}/solidgo-partial-pg"
PORT="${SOLIDGO_TEST_PGPORT:-55440}"
DB="solidgo_partial_test"
STARTED_HERE=0

[ -f "$PGDATA_DIR/PG_VERSION" ] || initdb -D "$PGDATA_DIR" --auth=trust --no-locale --encoding=UTF8 >/dev/null
if ! pg_isready -p "$PORT" >/dev/null 2>&1; then
  pg_ctl -D "$PGDATA_DIR" -o "-p $PORT" -l "$PGDATA_DIR.log" start >/dev/null
  STARTED_HERE=1
fi
cleanup() { [[ "$STARTED_HERE" == "1" ]] && pg_ctl -D "$PGDATA_DIR" stop -m fast >/dev/null || true; }
trap cleanup EXIT

dropdb -p "$PORT" --if-exists "$DB"; createdb -p "$PORT" "$DB"
run() { psql -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }

run -f "$HERE/00-stubs.sql" >/dev/null
run -f "$ROOT_DIR/supabase/migrations/00000000000000_baseline_schema.sql" >/dev/null
for m in 20260709160000_bloco3_carimbo_montagem_devolvida \
         20260709170000_bloco3_ponte_n8n_ingest_erp_return \
         20260709180000_bloco3_ingest_erp_return_payload_unico \
         20260709190000_bloco3_trigger_resync_shadow_items \
         20260709200000_entrega_parcial_fase1_view_entregue \
         20260709210000_entrega_parcial_fase1b_snapshot_remaining \
         20260709220000_entrega_parcial_fase2_montagem_por_entregue \
         20260709230000_fix_ingest_over_return_conflict \
         20260710000000_em_espera_order_item_holds 20260710010000_retirada_por_item \
         20260710020000_snapshot_pula_item_retirado 20260710030000_saldo_desconta_retirado \
         20260710040000_store_release_respeita_retirada_parcial 20260710050000_multiplas_retiradas_por_pedido; do
  run -f "$ROOT_DIR/supabase/migrations/$m.sql" >/dev/null
done

run -f "$HERE/scenario.sql" >/dev/null
psql -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/assert.sql" 2>&1 | grep -E "OK A|FALHA|PASSARAM"
