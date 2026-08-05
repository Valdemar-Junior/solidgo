-- Auditoria de montagem esquecida pelo vendedor.
-- Registra a decisao do gerente por pedido do ERP e, quando o pedido ja existe
-- no SolidGo, marca os itens como montagem para que a geracao dos cards siga o
-- fluxo padrao (sync no fechamento da rota / imediato se ja entregue).

create table if not exists public.assembly_audit_records (
  id uuid primary key default gen_random_uuid(),
  order_id_erp text not null,
  order_id uuid null references public.orders(id) on delete set null,
  decision text not null,
  notes text null,
  marked_skus text[] not null default '{}',
  assembly_applied boolean not null default false,
  assembly_applied_at timestamptz null,
  assembly_products_created integer not null default 0,
  pending_reason text null,
  filial text null,
  vendedor text null,
  cliente text null,
  valor_pedido numeric(14, 2) null,
  data_hora_venda timestamptz null,
  erp_snapshot jsonb null,
  decided_by_user_id uuid null references public.users(id) on delete set null,
  decided_at timestamptz not null default timezone('utc'::text, now()),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.assembly_audit_records drop constraint if exists assembly_audit_records_decision_check;

alter table public.assembly_audit_records
  add constraint assembly_audit_records_decision_check
  check (decision = any (array['needs_assembly', 'no_assembly']));

alter table public.assembly_audit_records drop constraint if exists assembly_audit_records_pending_reason_check;

alter table public.assembly_audit_records
  add constraint assembly_audit_records_pending_reason_check
  check (
    pending_reason is null
    or pending_reason = any (array['aguardando_entrega', 'aguardando_finalizacao_rota', 'falha_ao_gerar'])
  );

create unique index if not exists assembly_audit_records_order_erp_idx
  on public.assembly_audit_records (order_id_erp);

create index if not exists assembly_audit_records_decision_idx
  on public.assembly_audit_records (decision, decided_at desc);

create index if not exists assembly_audit_records_order_id_idx
  on public.assembly_audit_records (order_id);

create or replace function public.set_assembly_audit_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$function$;

drop trigger if exists trg_assembly_audit_records_updated_at on public.assembly_audit_records;
create trigger trg_assembly_audit_records_updated_at
before update on public.assembly_audit_records
for each row
execute function public.set_assembly_audit_updated_at();

alter table public.assembly_audit_records enable row level security;

drop policy if exists assembly_audit_records_select_policy on public.assembly_audit_records;
create policy assembly_audit_records_select_policy
  on public.assembly_audit_records
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role = any (array['gerente', 'admin'])
    )
  );

grant select on public.assembly_audit_records to authenticated;

-- Extrai o SKU de um item do items_json usando os mesmos fallbacks da RPC de montagem.
create or replace function public.assembly_audit_item_sku(p_item jsonb)
returns text
language sql
immutable
as $function$
  select upper(coalesce(
    nullif(trim(p_item->>'sku'), ''),
    nullif(trim(p_item->>'codigo'), ''),
    nullif(trim(p_item->>'codigo_produto'), ''),
    'SKU-INDEF'
  ));
$function$;

-- Aplica a decisao do gerente sobre uma venda listada na auditoria de montagem.
-- Regra dura: so marca montagem se o pedido ja estiver importado no SolidGo.
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

    select r.status
      into v_route_status
    from public.route_orders ro
    join public.routes r
      on r.id = ro.route_id
    where ro.order_id = v_order_id
    order by coalesce(r.updated_at, r.created_at) desc
    limit 1;

    if lower(coalesce(v_order_status, '')) = 'delivered' and v_route_status = 'completed' then
      begin
        v_sync := public.sync_missing_assembly_products_for_order(v_order_id);
        v_inserted := coalesce((v_sync->>'inserted_products')::int, 0);
        v_applied := true;
        v_applied_at := timezone('utc'::text, now());
      exception when others then
        v_applied := false;
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

grant execute on function public.assembly_audit_item_sku(jsonb) to authenticated;
grant execute on function public.apply_assembly_audit_decision(text, text, text[], text, jsonb) to authenticated;
