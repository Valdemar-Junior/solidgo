-- ============================================================================
-- Bloco 3 (parte 1) — Carimbo da montagem devolvida (soft-delete)
-- ============================================================================
-- MOTIVACAO (pedido do dono): quando um item entregue e ja transformado em
-- montagem e devolvido, a reconciliacao APAGAVA fisicamente a linha de montagem
-- excedente (DELETE, sem historico, sem como auditar/reverter). O correto e
-- CARIMBAR: marcar como cancelada + registrar que foi devolvida, mantendo o
-- registro. A tabela ja tem as colunas (was_returned, returned_at, return_reason).
--
-- SUTILEZA RESOLVIDA (idempotencia): como a linha carimbada CONTINUA existindo,
-- as contagens "quantas montagens existem" passam a ignorar as canceladas nos
-- DOIS lugares (reconciliador e repositor). Sem isso, cada nova execucao veria
-- as canceladas no total e cancelaria em cascata ate zerar tudo.
--
-- Efeito combinado (estavel/idempotente):
--   * Devolucao processada -> cancela (carimba) o excedente ATIVO -> ativo = alvo.
--     Reexecucoes nao mexem em mais nada (nao ha mais excedente ativo).
--   * Devolucao revertida (saldo sobe) -> repositor ve ativo < alvo -> insere
--     montagem nova (pending); as canceladas ficam como historico.
--
-- Nao altera dados existentes; so muda o comportamento das duas funcoes.
-- Aplicar no banco de TESTE e validar um ciclo devolucao/reversao via /simular.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Reconciliador: conta so ativas (nao-canceladas) e CARIMBA em vez de deletar.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_assembly_products_with_returns(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cancelled integer := 0;
  v_inserted integer := 0;
  v_route_result jsonb;
begin
  if p_order_id is null then
    return jsonb_build_object('order_id', null, 'deleted_products', 0, 'inserted_products', 0);
  end if;

  with target_counts as (
    select
      oi.order_id,
      coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') as product_sku,
      greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::integer as target_count
    from public.order_item_shadow_balances bal
    join public.order_items oi on oi.id = bal.order_item_id
    where oi.order_id = p_order_id
      and oi.source_present
      and public.order_item_payload_requires_assembly(oi.source_payload)
    group by oi.order_id, coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF')
  ), assembly_counts as (
    select
      ap.order_id,
      coalesce(nullif(trim(ap.product_sku), ''), 'SKU-INDEF') as product_sku,
      count(*)::integer as current_count
    from public.assembly_products ap
    where ap.order_id = p_order_id
      and ap.status <> 'cancelled'   -- so montagens ATIVAS contam como existentes
    group by ap.order_id, coalesce(nullif(trim(ap.product_sku), ''), 'SKU-INDEF')
  ), sku_deltas as (
    select
      ac.order_id,
      ac.product_sku,
      greatest(ac.current_count - coalesce(tc.target_count, 0), 0) as extra_count
    from assembly_counts ac
    left join target_counts tc
      on tc.order_id = ac.order_id
     and tc.product_sku = ac.product_sku
    where ac.current_count > coalesce(tc.target_count, 0)
  ), ranked_products as (
    select
      ap.id,
      row_number() over (
        partition by ap.order_id, coalesce(nullif(trim(ap.product_sku), ''), 'SKU-INDEF')
        order by
          case when ap.assembly_route_id is null then 0 else 1 end,
          case ap.status
            when 'pending' then 0
            when 'assigned' then 1
            when 'in_progress' then 2
            when 'completed' then 3
            else 5
          end,
          ap.created_at desc,
          ap.id desc
      ) as rn,
      sd.extra_count
    from public.assembly_products ap
    join sku_deltas sd
      on sd.order_id = ap.order_id
     and sd.product_sku = coalesce(nullif(trim(ap.product_sku), ''), 'SKU-INDEF')
    where ap.order_id = p_order_id
      and ap.status <> 'cancelled'   -- nunca re-carimbar quem ja esta cancelado
  ), stamped as (
    update public.assembly_products ap
       set status = 'cancelled',
           was_returned = true,
           returned_at = coalesce(ap.returned_at, timezone('utc', now())),
           return_reason = coalesce(ap.return_reason, 'Devolução do ERP'),
           updated_at = timezone('utc', now())
    from ranked_products rp
    where ap.id = rp.id
      and rp.rn <= rp.extra_count
    returning ap.id
  )
  select count(*)::integer into v_cancelled from stamped;

  begin
    v_route_result := public.sync_missing_assembly_products_for_order(p_order_id);
    v_inserted := coalesce((v_route_result->>'inserted_products')::integer, 0);
  exception when others then
    v_inserted := 0;
  end;

  -- Mantem a chave 'deleted_products' por compatibilidade com quem consome o retorno;
  -- agora ela representa montagens CARIMBADAS (canceladas), nao apagadas.
  return jsonb_build_object(
    'order_id', p_order_id,
    'deleted_products', coalesce(v_cancelled, 0),
    'cancelled_products', coalesce(v_cancelled, 0),
    'inserted_products', coalesce(v_inserted, 0)
  );
end;
$function$;

-- ----------------------------------------------------------------------------
-- 2) Repositor: conta so ativas como existentes, pra repor apos reversao e pra
--    nao deixar montagem cancelada bloquear a geracao legitima.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_missing_assembly_products_for_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_latest_route_status text;
  v_target_item record;
  v_existing_count int;
  v_missing_count int;
  v_inserted_products int := 0;
  i int;
begin
  if p_order_id is null then
    raise exception 'order_id e obrigatorio';
  end if;

  select o.id, o.status, o.customer_name, o.phone, o.address_json
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Pedido % nao encontrado', p_order_id;
  end if;

  if v_order.status <> 'delivered' then
    raise exception 'Pedido % precisa estar delivered para sincronizar montagem. Status atual: %', p_order_id, v_order.status;
  end if;

  select r.status
  into v_latest_route_status
  from public.route_orders ro
  join public.routes r on r.id = ro.route_id
  where ro.order_id = p_order_id
    and upper(coalesce(r.name, '')) not like 'COLETA-%'
  order by coalesce(r.updated_at, r.created_at) desc
  limit 1;

  if v_latest_route_status is null or v_latest_route_status <> 'completed' then
    raise exception 'Pedido % ainda nao pertence a uma rota finalizada. Status da ultima rota: %',
      p_order_id, coalesce(v_latest_route_status, 'sem rota');
  end if;

  for v_target_item in
    select
      coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF') as product_sku,
      max(oi.product_name) as product_name,
      greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::int as target_quantity
    from public.order_item_shadow_balances bal
    join public.order_items oi on oi.id = bal.order_item_id
    where oi.order_id = p_order_id
      and oi.source_present
      and public.order_item_payload_requires_assembly(oi.source_payload)
    group by coalesce(nullif(trim(oi.sku), ''), 'SKU-INDEF')
    having greatest(floor(sum(coalesce(bal.shadow_deliverable_quantity, 0))), 0)::int > 0
  loop
    select count(*)
    into v_existing_count
    from public.assembly_products ap
    where ap.order_id = p_order_id
      and coalesce(ap.product_sku, 'SKU-INDEF') = v_target_item.product_sku
      and ap.status <> 'cancelled';   -- canceladas (devolvidas) nao contam como existentes

    v_missing_count := v_target_item.target_quantity - coalesce(v_existing_count, 0);

    if v_missing_count > 0 then
      for i in 1..v_missing_count loop
        insert into public.assembly_products (
          order_id,
          product_name,
          product_sku,
          customer_name,
          customer_phone,
          installation_address,
          status,
          created_at,
          updated_at
        ) values (
          p_order_id,
          v_target_item.product_name,
          v_target_item.product_sku,
          v_order.customer_name,
          v_order.phone,
          v_order.address_json,
          'pending',
          timezone('utc', now()),
          timezone('utc', now())
        );
      end loop;

      v_inserted_products := v_inserted_products + v_missing_count;
    end if;
  end loop;

  return jsonb_build_object('order_id', p_order_id, 'inserted_products', v_inserted_products);
end;
$function$;

COMMIT;
