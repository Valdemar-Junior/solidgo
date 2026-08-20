-- ============================================================================
-- PARTE 8 — sync_store_release_for_order: FUSAO das duas evolucoes
-- ----------------------------------------------------------------------------
-- Esta funcao mudou NOS DOIS lados depois da separacao (03/07/2026):
--
--   FORK  (10/07): retirada PARCIAL nao zera a liberacao do pedido inteiro
--       (1) "tem retirada" passa a significar retirada do PEDIDO INTEIRO
--           (order_withdrawals.items IS NULL);
--       (2) ao montar os locais que exigem liberacao, PULA os itens ja
--           retirados (order_item_holds com status 'picked_up').
--
--   PRODUCAO (16/07): ciclo de rota NAO revoga liberacao
--       (3) pedido bloqueado / fora de pending / retirado por inteiro:
--           PRESERVA as assignments em vez de apagar e recriar.
--
-- Precedencia adotada: onde as duas discordam (retirada do pedido inteiro —
-- producao preserva, fork apagava), vence a PRODUCAO. E a decisao mais recente
-- e preservar nunca perde dado. As duas melhorias do fork entram no caminho
-- normal, que so e alcancado quando o pedido esta pending e aguardando rota.
--
-- A funcao de backup sync_store_release_for_order_before_route_lifecycle_fix
-- (criada pela migration de producao de 16/07) deixa de ser usada por esta
-- versao. NAO remover agora: so depois que a uniao estiver validada.
--
-- Gerado em 20/08/2026 sobre o dump FRESCO do Banco_Teste_Soligo.
-- RASCUNHO: nao aplicar em producao sem o ensaio sobre backup restaurado.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_store_release_for_order(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_location text;
  v_required_locations text[] := '{}';
  v_assign record;
  v_required_count integer := 0;
  v_released_count integer := 0;
  v_only_block_disassemblable boolean := true;
  v_has_full_withdrawal boolean := false;
  v_import_source text;
  v_enabled boolean := false;
begin
  select *
    into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'Pedido % nao encontrado', p_order_id;
  end if;

  v_import_source := lower(trim(coalesce(v_order.import_source, '')));

  begin
    select
      coalesce((value->>'enabled')::boolean, false),
      coalesce((value->>'only_block_disassemblable_items')::boolean, true)
    into v_enabled, v_only_block_disassemblable
    from public.app_settings
    where key = 'store_release_control';
  exception
    when others then
      v_enabled := false;
      v_only_block_disassemblable := true;
  end;

  -- (1) Só retirada do PEDIDO INTEIRO (items IS NULL) zera a liberação de tudo.
  select exists (
    select 1
    from public.order_withdrawals ow
    where ow.order_id = p_order_id
      and ow.items is null
  )
  into v_has_full_withdrawal;

  -- [PRODUCAO 16/07] Mudancas do ciclo de rota NAO revogam liberacao: enquanto o
  -- pedido estiver fora da fila (bloqueado, nao-pending, ou retirado por inteiro),
  -- preserva as assignments como estao em vez de apaga-las e recria-las.
  if v_order.blocked_at is not null
     or v_order.status is distinct from 'pending'
     or v_has_full_withdrawal then
    select
      coalesce(array_agg(sra.store_location order by sra.store_location), '{}'::text[]),
      count(*)::integer,
      (count(*) filter (where sra.status = 'released'))::integer
      into v_required_locations, v_required_count, v_released_count
    from public.store_release_assignments sra
    where sra.order_id = p_order_id;

    return jsonb_build_object(
      'order_id', p_order_id,
      'required_locations', v_required_locations,
      'required_count', v_required_count,
      'released_count', v_released_count,
      'status', v_order.store_release_status,
      'preserved_during_route_lifecycle', true
    );
  end if;

  -- Restam aqui apenas os casos em que a pendencia realmente deixa de existir:
  -- controle desligado, ou pedido que nao veio da importacao em lote.
  if not v_enabled
     or v_import_source <> 'lote' then
    for v_assign in
      select id, store_location
      from public.store_release_assignments
      where order_id = p_order_id
    loop
      insert into public.store_release_history (
        order_id,
        store_location,
        action,
        notes,
        acted_by_user_id
      ) values (
        p_order_id,
        v_assign.store_location,
        'auto_cleared',
        case
          when not v_enabled then 'Pendencia removida automaticamente porque a liberacao de saida de loja esta desativada.'
          when v_import_source <> 'lote' then 'Pendencia removida automaticamente porque o pedido nao e importacao em lote.'
          else 'Pendencia removida automaticamente.'
        end,
        null
      );

      delete from public.store_release_assignments
      where id = v_assign.id;
    end loop;

    update public.orders
      set requires_store_release = false,
          store_release_status = 'not_applicable'
    where id = p_order_id;

    return jsonb_build_object(
      'order_id', p_order_id,
      'required_locations', v_required_locations,
      'required_count', 0,
      'released_count', 0,
      'status', 'not_applicable'
    );
  end if;

  if v_order.items_json is not null and jsonb_typeof(v_order.items_json) = 'array' then
    for v_item in
      select value
      from jsonb_array_elements(v_order.items_json)
    loop
      v_location := public.normalize_store_release_location(v_item->>'location');

      if not public.store_release_location_is_controlled(v_location) then
        continue;
      end if;

      -- (2) Pula item já retirado (picked_up): não se exige liberar o que já saiu.
      if exists (
        select 1 from public.order_item_holds h
        where h.order_id = p_order_id
          and h.status = 'picked_up'
          and h.sku is not null and (v_item->>'sku') is not null
          and lower(btrim(h.sku)) = lower(btrim(v_item->>'sku'))
          and lower(coalesce(h.storage_location, '')) = lower(coalesce(v_item->>'location', ''))
      ) then
        continue;
      end if;

      if v_only_block_disassemblable
         and not (
           public.store_release_is_truthy(v_item->>'possui_montagem')
           or public.store_release_is_truthy(v_item->>'produto_e_montavel')
         ) then
        continue;
      end if;

      if not (v_location = any (v_required_locations)) then
        v_required_locations := array_append(v_required_locations, v_location);
      end if;
    end loop;
  end if;

  if v_order.raw_json is not null then
    if jsonb_typeof(v_order.raw_json->'produtos_locais') = 'array' then
      for v_item in
        select value
        from jsonb_array_elements(v_order.raw_json->'produtos_locais')
      loop
        v_location := public.normalize_store_release_location(v_item->>'local_estocagem');

        if not public.store_release_location_is_controlled(v_location) then
          continue;
        end if;

        if v_only_block_disassemblable
           and not (
             public.store_release_is_truthy(v_item->>'possui_montagem')
             or public.store_release_is_truthy(v_item->>'produto_e_montavel')
           ) then
          continue;
        end if;

        if not (v_location = any (v_required_locations)) then
          v_required_locations := array_append(v_required_locations, v_location);
        end if;
      end loop;
    end if;

    if jsonb_typeof(v_order.raw_json->'produtos') = 'array' then
      for v_item in
        select value
        from jsonb_array_elements(v_order.raw_json->'produtos')
      loop
        v_location := public.normalize_store_release_location(v_item->>'local_estocagem');

        if not public.store_release_location_is_controlled(v_location) then
          continue;
        end if;

        if v_only_block_disassemblable
           and not (
             public.store_release_is_truthy(v_item->>'possui_montagem')
             or public.store_release_is_truthy(v_item->>'produto_e_montavel')
           ) then
          continue;
        end if;

        if not (v_location = any (v_required_locations)) then
          v_required_locations := array_append(v_required_locations, v_location);
        end if;
      end loop;
    end if;
  end if;

  for v_assign in
    select id, store_location
    from public.store_release_assignments
    where order_id = p_order_id
  loop
    if not (v_assign.store_location = any (v_required_locations)) then
      insert into public.store_release_history (
        order_id,
        store_location,
        action,
        notes,
        acted_by_user_id
      ) values (
        p_order_id,
        v_assign.store_location,
        'auto_cleared',
        'Pendencia removida por reclassificacao automatica.',
        null
      );

      delete from public.store_release_assignments
      where id = v_assign.id;
    end if;
  end loop;

  foreach v_location in array v_required_locations
  loop
    insert into public.store_release_assignments (
      order_id,
      store_location,
      status
    ) values (
      p_order_id,
      v_location,
      'pending'
    )
    on conflict (order_id, store_location) do nothing;

    if not exists (
      select 1
      from public.store_release_history h
      where h.order_id = p_order_id
        and h.store_location = v_location
        and h.action = 'auto_created'
    ) then
      insert into public.store_release_history (
        order_id,
        store_location,
        action,
        notes,
        acted_by_user_id
      ) values (
        p_order_id,
        v_location,
        'auto_created',
        'Pendencia criada por classificacao automatica.',
        null
      );
    end if;
  end loop;

  select count(*)
    into v_required_count
  from public.store_release_assignments
  where order_id = p_order_id;

  select count(*)
    into v_released_count
  from public.store_release_assignments
  where order_id = p_order_id
    and status = 'released';

  if v_required_count = 0 then
    update public.orders
      set requires_store_release = false,
          store_release_status = 'not_applicable'
    where id = p_order_id;
  elsif v_released_count = 0 then
    update public.orders
      set requires_store_release = true,
          store_release_status = 'pending'
    where id = p_order_id;
  elsif v_released_count < v_required_count then
    update public.orders
      set requires_store_release = true,
          store_release_status = 'partial'
    where id = p_order_id;
  else
    update public.orders
      set requires_store_release = true,
          store_release_status = 'released'
    where id = p_order_id;
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'required_locations', v_required_locations,
    'required_count', v_required_count,
    'released_count', v_released_count,
    'status', (
      select o.store_release_status
      from public.orders o
      where o.id = p_order_id
    )
  );
end;
$$;



REVOKE ALL ON FUNCTION public.sync_store_release_for_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_store_release_for_order(uuid) TO authenticated, service_role;
