-- =====================================================================
-- Gerente marca montagem em pedido RETIRADO no deposito -> montagem nasce
-- =====================================================================
-- O problema (pedido 148793, 25/09/2026):
--   O vendedor esqueceu de marcar montagem, o cliente retirou no deposito e o
--   gerente marcou a montagem na auditoria. apply_assembly_audit_decision so
--   sabia gerar montagem pelo caminho da ROTA finalizada; retirada nao tem rota,
--   entao gravava 'aguardando_finalizacao_rota' e nada mais acontecia.
--
-- O conserto (so a funcao da auditoria muda; nada de tabela):
--   * retirada do pedido inteiro -> sync_missing_assembly_products_for_pickup
--   * retirada parcial           -> sync_missing_assembly_products_for_pickup_items
--                                   (so os SKUs que o cliente levou)
--   * rota finalizada            -> sync_missing_assembly_products_for_order (como antes)
--   * de brinde: a busca da rota ignora rota de COLETA, igual a
--     sync_missing_assembly_products_for_order ja faz (antes podia divergir).
--   As tres funcoes de geracao sao idempotentes (criam so a diferenca).
--
-- Base: texto da producao conferido por md5(prosrc) em 25/09/2026
--   apply_assembly_audit_decision          661fe34a6af1d1624f17ed11c9ec2a09 (= 20260804140000)
--   sync_missing_assembly_products_for_pickup d27f244acf0860fb4ccb73b190bbbd37 (= uniao-fork/03)
--
-- Parte 2 (no fim): recupera os pedidos que ja ficaram para tras (em 25/09 era
-- so o 148793) e atualiza o registro da auditoria.
-- =====================================================================

create or replace function public.apply_assembly_audit_decision(
  p_order_id_erp text,
  p_decision text,
  p_item_skus text[] default null,
  p_notes text default null,
  p_erp_snapshot jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_name text;
  v_erp text := nullif(trim(coalesce(p_order_id_erp, '')), '');
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_order_id uuid;
  v_order_status text;
  v_items jsonb;
  v_new_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_item_sku text;
  v_wanted text[];
  v_marked int := 0;
  v_already_marked int := 0;
  v_route_status text;
  v_full_pickup boolean := false;
  v_picked_skus text[];
  v_route_done boolean := false;
  v_sync jsonb;
  v_inserted int := 0;
  v_applied boolean := false;
  v_applied_at timestamptz := null;
  v_pending_reason text := null;
  v_valor numeric(14, 2) := null;
  v_data_venda timestamptz := null;
begin
  if v_user_id is null then
    raise exception 'Usuario autenticado obrigatorio';
  end if;

  select u.role, u.name
    into v_user_role, v_user_name
  from public.users u
  where u.id = v_user_id;

  if v_user_role is distinct from 'gerente' then
    raise exception 'Somente gerente pode registrar auditoria de montagem';
  end if;

  if v_erp is null then
    raise exception 'Numero do pedido e obrigatorio';
  end if;

  if p_decision is null or p_decision not in ('needs_assembly', 'no_assembly') then
    raise exception 'Decisao invalida: %', coalesce(p_decision, 'nulo');
  end if;

  select o.id, o.status, o.items_json
    into v_order_id, v_order_status, v_items
  from public.orders o
  where o.order_id_erp = v_erp;

  if p_decision = 'needs_assembly' then
    -- Regra dura: sem pedido importado nao ha o que marcar.
    if v_order_id is null then
      raise exception 'Pedido % ainda nao foi importado para o SolidGo. Importe o pedido antes de marcar a montagem.', v_erp;
    end if;

    if p_item_skus is null or array_length(p_item_skus, 1) is null then
      raise exception 'Selecione ao menos um produto para marcar montagem';
    end if;

    if v_items is null or jsonb_typeof(v_items) <> 'array' then
      raise exception 'Pedido % nao possui lista de produtos para marcar', v_erp;
    end if;

    select array_agg(upper(trim(sku)))
      into v_wanted
    from unnest(p_item_skus) as sku
    where nullif(trim(sku), '') is not null;

    if v_wanted is null then
      raise exception 'Selecione ao menos um produto para marcar montagem';
    end if;

    for v_item in select * from jsonb_array_elements(v_items)
    loop
      v_item_sku := public.assembly_audit_item_sku(v_item);

      if v_item_sku = any (v_wanted) then
        if lower(trim(coalesce(v_item->>'has_assembly', ''))) in ('sim', 's', 'true', '1', 'yes', 'y')
           or lower(trim(coalesce(v_item->>'possui_montagem', ''))) in ('sim', 's', 'true', '1', 'yes', 'y') then
          v_already_marked := v_already_marked + 1;
          v_new_items := v_new_items || jsonb_build_array(v_item);
        else
          v_marked := v_marked + 1;
          v_new_items := v_new_items || jsonb_build_array(
            v_item
              || jsonb_build_object('has_assembly', 'Sim')
              || jsonb_build_object('assembly_audit_marked', true)
          );
        end if;
      else
        v_new_items := v_new_items || jsonb_build_array(v_item);
      end if;
    end loop;

    if v_marked = 0 and v_already_marked = 0 then
      raise exception 'Nenhum produto do pedido % corresponde aos itens selecionados', v_erp;
    end if;

    if v_marked > 0 then
      update public.orders
         set items_json = v_new_items
       where id = v_order_id;
    end if;

    -- Mesma regra da sync_missing_assembly_products_for_order: rota de coleta nao conta.
    select r.status
      into v_route_status
    from public.route_orders ro
    join public.routes r
      on r.id = ro.route_id
    where ro.order_id = v_order_id
      and upper(coalesce(r.name, '')) not like 'COLETA-%'
    order by coalesce(r.updated_at, r.created_at) desc
    limit 1;

    v_route_done := lower(coalesce(v_order_status, '')) = 'delivered' and v_route_status = 'completed';

    -- Retirada no deposito nao passa por rota: sem isto a marcacao do gerente ficava
    -- "aguardando_finalizacao_rota" para sempre (pedido 148793, 25/09/2026).
    -- items nulo = retirou o pedido inteiro; preenchido = retirada parcial (so esses SKUs).
    select coalesce(bool_or(w.items is null), false)
      into v_full_pickup
    from public.order_withdrawals w
    where w.order_id = v_order_id;

    select array_agg(distinct trim(it->>'sku'))
      into v_picked_skus
    from public.order_withdrawals w
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(w.items) = 'array' then w.items else '[]'::jsonb end
    ) as it
    where w.order_id = v_order_id
      and nullif(trim(it->>'sku'), '') is not null;

    if (v_full_pickup and lower(coalesce(v_order_status, '')) = 'delivered')
       or v_picked_skus is not null
       or v_route_done then
      begin
        if v_full_pickup and lower(coalesce(v_order_status, '')) = 'delivered' then
          v_sync := public.sync_missing_assembly_products_for_pickup(v_order_id);
          v_inserted := v_inserted + coalesce((v_sync->>'inserted_products')::int, 0);
        else
          if v_picked_skus is not null then
            v_sync := public.sync_missing_assembly_products_for_pickup_items(v_order_id, v_picked_skus);
            v_inserted := v_inserted + coalesce((v_sync->>'inserted_products')::int, 0);
          end if;
          -- Retirou uma parte e o resto foi numa rota ja finalizada: as duas partes.
          if v_route_done then
            v_sync := public.sync_missing_assembly_products_for_order(v_order_id);
            v_inserted := v_inserted + coalesce((v_sync->>'inserted_products')::int, 0);
          end if;
        end if;
        v_applied := true;
        v_applied_at := timezone('utc'::text, now());
      exception when others then
        v_applied := false;
        v_inserted := 0;
        v_pending_reason := 'falha_ao_gerar';
      end;
    elsif lower(coalesce(v_order_status, '')) = 'delivered' then
      v_pending_reason := 'aguardando_finalizacao_rota';
    else
      v_pending_reason := 'aguardando_entrega';
    end if;
  end if;

  -- Snapshot do ERP para relatorio futuro (a origem pode mudar ou sumir da consulta).
  if p_erp_snapshot is not null then
    begin
      v_valor := nullif(trim(coalesce(p_erp_snapshot->>'valor_pedido', '')), '')::numeric(14, 2);
    exception when others then
      v_valor := null;
    end;

    begin
      v_data_venda := nullif(trim(coalesce(p_erp_snapshot->>'data_hora_venda', '')), '')::timestamptz;
    exception when others then
      v_data_venda := null;
    end;
  end if;

  insert into public.assembly_audit_records (
    order_id_erp,
    order_id,
    decision,
    notes,
    marked_skus,
    assembly_applied,
    assembly_applied_at,
    assembly_products_created,
    pending_reason,
    filial,
    vendedor,
    cliente,
    valor_pedido,
    data_hora_venda,
    erp_snapshot,
    decided_by_user_id,
    decided_at
  ) values (
    v_erp,
    v_order_id,
    p_decision,
    v_notes,
    coalesce(v_wanted, '{}'::text[]),
    v_applied,
    v_applied_at,
    v_inserted,
    v_pending_reason,
    nullif(trim(coalesce(p_erp_snapshot->>'filial', '')), ''),
    nullif(trim(coalesce(p_erp_snapshot->>'vendedor', '')), ''),
    nullif(trim(coalesce(p_erp_snapshot->>'cliente', '')), ''),
    v_valor,
    v_data_venda,
    p_erp_snapshot,
    v_user_id,
    timezone('utc'::text, now())
  )
  on conflict (order_id_erp) do update
    set order_id = excluded.order_id,
        decision = excluded.decision,
        notes = excluded.notes,
        marked_skus = excluded.marked_skus,
        assembly_applied = excluded.assembly_applied,
        assembly_applied_at = excluded.assembly_applied_at,
        assembly_products_created = excluded.assembly_products_created,
        pending_reason = excluded.pending_reason,
        filial = coalesce(excluded.filial, assembly_audit_records.filial),
        vendedor = coalesce(excluded.vendedor, assembly_audit_records.vendedor),
        cliente = coalesce(excluded.cliente, assembly_audit_records.cliente),
        valor_pedido = coalesce(excluded.valor_pedido, assembly_audit_records.valor_pedido),
        data_hora_venda = coalesce(excluded.data_hora_venda, assembly_audit_records.data_hora_venda),
        erp_snapshot = coalesce(excluded.erp_snapshot, assembly_audit_records.erp_snapshot),
        decided_by_user_id = excluded.decided_by_user_id,
        decided_at = excluded.decided_at;

  -- Historico na trilha que o admin ja consulta. Nao pode derrubar a operacao.
  if v_order_id is not null and v_marked > 0 then
    begin
      insert into public.order_audit_log (
        order_id,
        user_id,
        user_name,
        field_changed,
        old_value,
        new_value
      ) values (
        v_order_id,
        v_user_id,
        coalesce(v_user_name, 'Gerente'),
        'has_assembly (auditoria de montagem)',
        'Nao',
        'Sim - ' || array_to_string(v_wanted, ', ')
      );
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object(
    'order_id_erp', v_erp,
    'order_id', v_order_id,
    'order_found', v_order_id is not null,
    'decision', p_decision,
    'items_marked', v_marked,
    'items_already_marked', v_already_marked,
    'assembly_applied', v_applied,
    'assembly_products_created', v_inserted,
    'pending_reason', v_pending_reason
  );
end;
$function$;

-- =====================================================================
-- Parte 2: recuperacao dos pedidos que ja ficaram para tras.
-- Pedido retirado + gerente marcou montagem + nenhuma montagem ativa.
-- Idempotente: rodar de novo nao duplica nada.
-- =====================================================================
DO $$
DECLARE
  r record;
  v_sync jsonb;
  v_skus text[];
  v_criadas int;
BEGIN
  FOR r IN
    SELECT o.id, o.order_id_erp, o.status,
           coalesce(bool_or(w.items IS NULL), false) AS retirada_inteira
    FROM public.assembly_audit_records a
    JOIN public.orders o ON o.id = a.order_id
    JOIN public.order_withdrawals w ON w.order_id = o.id
    WHERE a.decision = 'needs_assembly'
      AND coalesce(a.assembly_applied, false) = false
      AND NOT EXISTS (SELECT 1 FROM public.assembly_products ap
                      WHERE ap.order_id = o.id AND ap.status <> 'cancelled')
    GROUP BY o.id, o.order_id_erp, o.status
  LOOP
    BEGIN
      IF r.retirada_inteira AND r.status = 'delivered' THEN
        v_sync := public.sync_missing_assembly_products_for_pickup(r.id);
      ELSE
        SELECT array_agg(DISTINCT trim(it->>'sku')) INTO v_skus
        FROM public.order_withdrawals w
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(w.items) = 'array' THEN w.items ELSE '[]'::jsonb END) AS it
        WHERE w.order_id = r.id AND nullif(trim(it->>'sku'), '') IS NOT NULL;
        IF v_skus IS NULL THEN
          RAISE NOTICE 'Pedido %: retirada sem itens identificaveis, conferir a mao', r.order_id_erp;
          CONTINUE;
        END IF;
        v_sync := public.sync_missing_assembly_products_for_pickup_items(r.id, v_skus);
      END IF;

      v_criadas := coalesce((v_sync->>'inserted_products')::int, 0);
      IF v_criadas > 0 THEN
        UPDATE public.assembly_audit_records
           SET assembly_applied = true,
               assembly_applied_at = timezone('utc'::text, now()),
               assembly_products_created = v_criadas,
               pending_reason = null
         WHERE order_id = r.id;
      END IF;
      RAISE NOTICE 'Pedido %: % montagem(ns) criada(s)', r.order_id_erp, v_criadas;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Pedido %: ERRO, nada feito neste pedido: %', r.order_id_erp, sqlerrm;
    END;
  END LOOP;
END $$;

-- Conferencia (deve mostrar o 148793 com montagens >= 1 e auditoria aplicada):
select o.order_id_erp,
       (select count(*) from public.assembly_products ap
         where ap.order_id = o.id and ap.status <> 'cancelled') as montagens,
       a.assembly_applied as auditoria_aplicou,
       a.assembly_products_created as auditoria_criou,
       a.pending_reason as auditoria_motivo
from public.assembly_audit_records a
join public.orders o on o.id = a.order_id
where a.decision = 'needs_assembly'
  and exists (select 1 from public.order_withdrawals w where w.order_id = o.id)
order by a.decided_at desc;
