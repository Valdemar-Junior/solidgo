-- Agente (Hermes) / MCP do SolidGo — fase 2: criar rota com aprovação humana.
--
-- Fluxo: o MCP "prepara" a rota (grava só uma PROPOSTA em agente_aprovacoes) e
-- devolve um link. Um ADMIN logado abre o link no SolidGo e clica Confirmar; só
-- então a função agente_aprovar_rota grava routes / route_orders / orders, igual
-- ao createRoute de src/pages/admin/RouteCreation.tsx. A IA nunca grava rota sozinha.
--
-- Tudo aqui é acessado só pelo servidor (service key, em api/agente.ts):
-- RLS ligada e sem policy; funções sem permissão para anon/authenticated.

-- 1) Configuração (uma linha só) ------------------------------------------------
create table if not exists public.agente_config (
  id                 boolean primary key default true check (id),
  ativo              boolean not null default true,
  permite_criar_rota boolean not null default true,
  token_hash         text,          -- sha256 hex do token; o token em si nunca é guardado
  token_criado_em    timestamptz,
  atualizado_em      timestamptz not null default now(),
  atualizado_por     uuid
);
insert into public.agente_config (id) values (true) on conflict (id) do nothing;
alter table public.agente_config enable row level security;

-- 2) Propostas de rota esperando o clique do admin ------------------------------
create table if not exists public.agente_aprovacoes (
  id            uuid primary key default gen_random_uuid(),
  criado_em     timestamptz not null default now(),
  expira_em     timestamptz not null default now() + interval '12 hours',
  status        text not null default 'pendente'
                check (status in ('pendente', 'aprovada', 'recusada', 'expirada', 'erro')),
  tipo          text not null check (tipo in ('nova_rota', 'adicionar_em_rota')),
  -- ids já resolvidos (o que será gravado)
  dados         jsonb not null,
  -- o que mostrar na tela de aprovação (nomes, pedidos, avisos)
  resumo        jsonb not null,
  pedido_por    text,             -- quem pediu ao agente (header x-mcp-actor), se vier
  decidido_por  uuid,
  decidido_em   timestamptz,
  route_id      uuid,
  route_code    text,
  erro          text
);
create index if not exists agente_aprovacoes_criado_idx on public.agente_aprovacoes (criado_em desc);
alter table public.agente_aprovacoes enable row level security;

-- 3) Histórico de tudo que o agente fez ou tentou -------------------------------
create table if not exists public.agente_auditoria (
  id          bigserial primary key,
  criado_em   timestamptz not null default now(),
  origem      text not null,      -- 'mcp' | 'admin'
  acao        text not null,      -- nome da ferramenta ou ação do admin
  ok          boolean not null,
  detalhe     jsonb,
  erro        text,
  ator        text,               -- x-mcp-actor ou id do admin
  ip          text
);
create index if not exists agente_auditoria_criado_idx on public.agente_auditoria (criado_em desc);
alter table public.agente_auditoria enable row level security;

-- 4) Gravação da rota aprovada (transação única: grava tudo ou nada) ------------
create or replace function public.agente_aprovar_rota(p_aprovacao_id uuid, p_admin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ap          public.agente_aprovacoes%rowtype;
  v_dados       jsonb;
  v_order_ids   uuid[];
  v_invalidos   text[];
  v_route_id    uuid;
  v_route_code  text;
  v_prefixo     text;
  v_ultimo      text;
  v_seq         int;
  v_start_seq   int;
  v_route_status text;
begin
  select * into v_ap from public.agente_aprovacoes where id = p_aprovacao_id for update;
  if not found then
    raise exception 'Proposta não encontrada.';
  end if;
  if v_ap.status <> 'pendente' then
    raise exception 'Esta proposta já foi %.', v_ap.status;
  end if;
  if v_ap.expira_em < now() then
    update public.agente_aprovacoes set status = 'expirada' where id = p_aprovacao_id;
    return jsonb_build_object('ok', false, 'erro', 'Proposta expirada. Peça ao agente para preparar de novo.');
  end if;
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    raise exception 'Somente admin pode aprovar.';
  end if;

  v_dados := v_ap.dados;
  select array_agg((x)::uuid) into v_order_ids from jsonb_array_elements_text(v_dados->'order_ids') x;
  if v_order_ids is null or array_length(v_order_ids, 1) = 0 then
    raise exception 'Proposta sem pedidos.';
  end if;

  -- Trava os pedidos e confere de novo a regra da fila (algo pode ter mudado
  -- entre a prévia e o clique). Se UM pedido saiu da fila, nada é gravado.
  perform 1 from public.orders where id = any(v_order_ids) for update;

  select array_agg(coalesce(o.order_id_erp, o.id::text)) into v_invalidos
  from public.orders o
  where o.id = any(v_order_ids)
    and (
      o.status not in ('pending', 'returned')
      or o.blocked_at is not null
      or exists (
        select 1 from public.route_orders ro join public.routes r on r.id = ro.route_id
        where ro.order_id = o.id and r.status <> 'completed'
      )
      or exists (select 1 from public.order_withdrawals w where w.order_id = o.id)
    );
  if (select count(*) from public.orders where id = any(v_order_ids)) <> array_length(v_order_ids, 1) then
    v_invalidos := coalesce(v_invalidos, '{}') || array['(pedido apagado)'];
  end if;
  if v_invalidos is not null and array_length(v_invalidos, 1) > 0 then
    update public.agente_aprovacoes
      set status = 'erro', erro = 'Pedidos não estão mais livres: ' || array_to_string(v_invalidos, ', '),
          decidido_por = p_admin_id, decidido_em = now()
      where id = p_aprovacao_id;
    return jsonb_build_object('ok', false, 'erro',
      'Nada foi gravado: estes pedidos não estão mais livres na fila: ' || array_to_string(v_invalidos, ', '));
  end if;

  if v_ap.tipo = 'nova_rota' then
    -- Código RE-DDMMYY-XXX no dia de Brasília, igual generateRouteCode da tela.
    -- O lock evita dois códigos iguais se duas aprovações acontecerem juntas.
    perform pg_advisory_xact_lock(hashtext('solidgo_route_code_RE'));
    v_prefixo := 'RE-' || to_char(now() at time zone 'America/Sao_Paulo', 'DDMMYY') || '-';
    select route_code into v_ultimo from public.routes
      where route_code like v_prefixo || '%'
      order by route_code desc limit 1;
    v_seq := coalesce(nullif(regexp_replace(coalesce(split_part(v_ultimo, '-', 3), ''), '\D', '', 'g'), '')::int, 0) + 1;
    v_route_code := v_prefixo || lpad(v_seq::text, 3, '0');

    insert into public.routes (name, driver_id, vehicle_id, conferente_id, conferente,
                               observations, team_id, helper_id, status, route_code)
    values (
      v_dados->>'route_name',
      (v_dados->>'driver_id')::uuid,
      nullif(v_dados->>'vehicle_id', '')::uuid,
      nullif(v_dados->>'conferente_id', '')::uuid,
      nullif(v_dados->>'conferente_nome', ''),
      nullif(v_dados->>'observations', ''),
      nullif(v_dados->>'team_id', '')::uuid,
      nullif(v_dados->>'helper_id', '')::uuid,
      'pending',
      v_route_code
    )
    returning id into v_route_id;
    v_start_seq := 1;
  else
    v_route_id := (v_dados->>'route_id')::uuid;
    select status, route_code into v_route_status, v_route_code from public.routes where id = v_route_id for update;
    if not found then
      raise exception 'Romaneio não encontrado.';
    end if;
    if v_route_status <> 'pending' then
      update public.agente_aprovacoes set status = 'erro', erro = 'O romaneio já saiu de Em Separação.',
        decidido_por = p_admin_id, decidido_em = now() where id = p_aprovacao_id;
      return jsonb_build_object('ok', false, 'erro', 'Nada foi gravado: o romaneio ' || coalesce(v_route_code, '') || ' já não está Em Separação.');
    end if;
    select coalesce(max(sequence), 0) + 1 into v_start_seq from public.route_orders where route_id = v_route_id;
  end if;

  insert into public.route_orders (route_id, order_id, sequence, status)
  select v_route_id, t.id, v_start_seq + t.ord - 1, 'pending'
  from unnest(v_order_ids) with ordinality as t(id, ord);

  update public.orders set status = 'assigned' where id = any(v_order_ids);

  -- Mesma sincronização de liberação de loja que a tela chama depois de rotear.
  if to_regprocedure('public.sync_store_release_for_orders(uuid[])') is not null then
    perform public.sync_store_release_for_orders(v_order_ids);
  end if;

  update public.agente_aprovacoes
    set status = 'aprovada', decidido_por = p_admin_id, decidido_em = now(),
        route_id = v_route_id, route_code = v_route_code
    where id = p_aprovacao_id;

  return jsonb_build_object('ok', true, 'route_id', v_route_id, 'route_code', v_route_code,
                            'pedidos', array_length(v_order_ids, 1));
end;
$$;

revoke all on function public.agente_aprovar_rota(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agente_aprovar_rota(uuid, uuid) to service_role;

revoke all on table public.agente_config, public.agente_aprovacoes, public.agente_auditoria from anon, authenticated;
