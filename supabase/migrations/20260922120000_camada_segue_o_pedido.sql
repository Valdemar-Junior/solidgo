-- ============================================================================
-- A copia por item passa a seguir o pedido, mesmo quando quem marca nao e admin
-- ----------------------------------------------------------------------------
-- PROBLEMA (confirmado em producao em 22/09/2026, pedido 147893):
--   Quando o vendedor esquece a montagem e o GERENTE marca na tela dele
--   (rpc apply_assembly_audit_decision), o pedido passa a ter has_assembly=Sim.
--   O gatilho trg_orders_resync_items_shadow tenta refazer a copia por item,
--   mas sync_order_items_shadow exige ADMIN (item_fulfillment_can_manage) e o
--   gerente nao e admin. O erro e ENGOLIDO de proposito (para nao travar a tela),
--   entao a copia (order_items.source_payload) fica com o "NAO" antigo.
--   A geracao de montagem le a COPIA -> nao acha item com montagem -> devolve
--   zero SEM ERRO. A marcacao do gerente nao produz efeito nenhum.
--
-- SOLUCAO:
--   Separar "quem pode mandar sincronizar" de "a copia tem que seguir o pedido":
--     * sync_order_items_shadow_system(uuid) -> o trabalho, SEM trava. So o
--       gatilho e o proprio banco chamam (revogada de anon/authenticated).
--     * sync_order_items_shadow(uuid)        -> continua exigindo admin e passa
--       o trabalho para a versao de sistema. Nada muda para quem ja usava.
--     * trg_resync_order_items_shadow()      -> passa a chamar a versao sistema.
--
--   Quem altera o pedido ja foi autorizado pelo RLS de orders; a copia e
--   consequencia automatica, nao e uma acao de usuario.
--
-- SEGURANCA:
--   * A versao sistema so mexe em order_items / item_fulfillment_sync_issues,
--     nunca em orders: sem risco de recursao do gatilho.
--   * O gatilho continua envelopado em bloco de excecao: se falhar, grava
--     WARNING e NAO bloqueia quem esta salvando o pedido.
--   * Nenhuma permissao nova para usuario: a funcao de sistema e revogada de
--     PUBLIC/anon/authenticated.
-- ============================================================================

BEGIN;

-- 1) O trabalho, sem trava (so o banco chama) -------------------------------
CREATE OR REPLACE FUNCTION public.sync_order_items_shadow_system(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_items jsonb;
  v_synced integer := 0;
  v_missing integer := 0;
begin
  select o.items_json into v_items
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % não encontrado', p_order_id;
  end if;

  update public.order_items
  set source_present = false,
      source_synced_at = timezone('utc', now())
  where order_id = p_order_id;

  if v_items is not null and jsonb_typeof(v_items) = 'array' then
    with raw_items as (
      select value as item, ordinality
      from jsonb_array_elements(v_items) with ordinality
    ), normalized as (
      select
        item,
        ordinality,
        nullif(trim(coalesce(item->>'sku', item->>'codigo', item->>'codigo_produto', '')), '') as sku,
        coalesce(
          nullif(trim(item->>'name'), ''),
          nullif(trim(item->>'produto'), ''),
          nullif(trim(item->>'descricao'), ''),
          nullif(trim(item->>'nome_produto'), ''),
          'Produto sem nome'
        ) as product_name,
        nullif(trim(coalesce(item->>'location', item->>'local_estocagem', '')), '') as storage_location,
        nullif(trim(coalesce(item->>'codigo_kit_pai', '')), '') as kit_code,
        greatest(
          coalesce(
            case when coalesce(item->>'purchased_quantity', '') ~ '^\d+([.,]\d+)?$'
              then replace(item->>'purchased_quantity', ',', '.')::numeric end,
            case when coalesce(item->>'quantidade_comprada', '') ~ '^\d+([.,]\d+)?$'
              then replace(item->>'quantidade_comprada', ',', '.')::numeric end,
            1::numeric
          ),
          0.001::numeric
        ) as purchased_quantity,
        greatest(
          coalesce(
            case when coalesce(item->>'quantity', '') ~ '^\d+([.,]\d+)?$'
              then replace(item->>'quantity', ',', '.')::numeric end,
            case when coalesce(item->>'volumes_per_unit', '') ~ '^\d+([.,]\d+)?$'
              then replace(item->>'volumes_per_unit', ',', '.')::numeric end,
            0::numeric
          ),
          0::numeric
        ) as volume_quantity
      from raw_items
    ), keyed as (
      select
        *,
        case
          when sku is null and storage_location is null and kit_code is null then
            'line:' || ordinality::text
          else
            'item:' || md5(
              lower(coalesce(sku, '')) || '|' ||
              lower(coalesce(storage_location, '')) || '|' ||
              lower(coalesce(kit_code, ''))
            )
        end as source_line_key
      from normalized
    ), grouped as (
      select
        source_line_key,
        max(sku) as sku,
        max(product_name) as product_name,
        sum(purchased_quantity) as purchased_quantity,
        sum(volume_quantity) as volume_quantity,
        max(storage_location) as storage_location,
        max(kit_code) as kit_code,
        jsonb_agg(item order by ordinality) as source_payload
      from keyed
      group by source_line_key
    ), upserted as (
      insert into public.order_items (
        order_id,
        source_line_key,
        sku,
        product_name,
        purchased_quantity,
        volume_quantity,
        storage_location,
        kit_code,
        source_payload,
        source_present,
        source_synced_at
      )
      select
        p_order_id,
        source_line_key,
        sku,
        product_name,
        purchased_quantity,
        volume_quantity,
        storage_location,
        kit_code,
        source_payload,
        true,
        timezone('utc', now())
      from grouped
      on conflict (order_id, source_line_key) do update set
        sku = excluded.sku,
        product_name = excluded.product_name,
        purchased_quantity = excluded.purchased_quantity,
        volume_quantity = excluded.volume_quantity,
        storage_location = excluded.storage_location,
        kit_code = excluded.kit_code,
        source_payload = excluded.source_payload,
        source_present = true,
        source_synced_at = excluded.source_synced_at
      returning id
    )
    select count(*) into v_synced from upserted;
  end if;

  select count(*) into v_missing
  from public.order_items oi
  where oi.order_id = p_order_id
    and oi.source_present = false;

  if v_missing > 0 then
    insert into public.item_fulfillment_sync_issues (
      order_id,
      issue_type,
      issue_key,
      details
    ) values (
      p_order_id,
      'source_items_missing',
      'missing:' || p_order_id::text,
      jsonb_build_object('missing_count', v_missing)
    )
    on conflict (order_id, issue_type, issue_key) do update set
      details = excluded.details,
      status = 'open',
      detected_at = timezone('utc', now()),
      resolved_at = null,
      resolved_by = null;
  else
    update public.item_fulfillment_sync_issues
    set status = 'resolved',
        resolved_at = timezone('utc', now())
    where order_id = p_order_id
      and issue_type = 'source_items_missing'
      and status = 'open';
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'synced_items', v_synced,
    'missing_source_items', v_missing
  );
end;
$_$;

-- 2) A porta de entrada continua exigindo admin -----------------------------
CREATE OR REPLACE FUNCTION public.sync_order_items_shadow(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.item_fulfillment_can_manage() then
    raise exception 'Acesso permitido apenas para administradores';
  end if;

  return public.sync_order_items_shadow_system(p_order_id);
end;
$$;

-- 3) O gatilho passa a usar a versao de sistema ------------------------------
CREATE OR REPLACE FUNCTION public.trg_resync_order_items_shadow() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  begin
    perform public.sync_order_items_shadow_system(NEW.id);
  exception when others then
    -- Nunca bloqueia quem esta salvando o pedido; so avisa no log.
    raise warning 'trg_resync_order_items_shadow: falha ao re-sincronizar order_items do pedido %: %', NEW.id, sqlerrm;
  end;
  return NEW;
end;
$$;

-- 4) Permissoes: a versao de sistema nao e chamavel pelo app -----------------
REVOKE ALL ON FUNCTION public.sync_order_items_shadow_system(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_order_items_shadow_system(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.sync_order_items_shadow_system(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_order_items_shadow_system(uuid) TO service_role;

COMMIT;

-- ----------------------------------------------------------------------------
-- CONFERENCIA (so leitura): as duas funcoes existem e o gatilho usa a de sistema.
-- ----------------------------------------------------------------------------
SELECT p.proname AS funcao,
       CASE WHEN pg_get_functiondef(p.oid) LIKE '%item_fulfillment_can_manage%'
            THEN 'exige admin' ELSE 'sem trava (so o banco chama)' END AS trava
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('sync_order_items_shadow', 'sync_order_items_shadow_system', 'trg_resync_order_items_shadow')
ORDER BY 1;
