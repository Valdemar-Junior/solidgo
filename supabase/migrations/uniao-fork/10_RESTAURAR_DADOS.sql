-- ============================================================
-- SO RODAR SE ALGO DER ERRADO. Nao faz parte da virada normal.
-- ============================================================
--
-- ORDEM OBRIGATORIA NA EMERGENCIA:
--
--   1o) 09_DESFAZER.sql   -> tira os gatilhos e as tabelas novas
--   2o) este arquivo      -> devolve os dados de orders ao estado da foto
--
-- Nunca o contrario. Com os gatilhos novos ainda no lugar, eles reagem ao
-- UPDATE abaixo e reescrevem tudo de volta.
--
-- Este arquivo so mexe em `orders`, e so nas 14 colunas fotografadas, e so
-- nos pedidos que ja existiam quando a foto foi tirada. Pedido criado depois
-- nao e tocado.
--
-- As outras tres tabelas (liberacao e montagem) NAO sao restauradas
-- automaticamente de proposito: elas tambem recebem escrita do fluxo normal,
-- e apagar tudo para repor a foto destruiria trabalho legitimo feito depois.
-- Para elas use as consultas de comparacao no fim do arquivo e decida caso a caso.
-- ============================================================

-- ---- PASSO A: veja o tamanho do estrago ANTES de mexer ----
select count(*) as pedidos_que_mudaram
from public.orders o
join bkp_virada.orders_20260905 b on b.id = o.id
where (o.blocked_at, o.blocked_reason, o.last_return_notes, o.last_return_reason,
       o.pickup_created_at, o.requires_pickup, o.requires_store_release,
       o.return_date, o.return_flag, o.return_nfe_key, o.return_nfe_number,
       o.return_nfe_xml, o.return_type, o.store_release_status)
   is distinct from
      (b.blocked_at, b.blocked_reason, b.last_return_notes, b.last_return_reason,
       b.pickup_created_at, b.requires_pickup, b.requires_store_release,
       b.return_date, b.return_flag, b.return_nfe_key, b.return_nfe_number,
       b.return_nfe_xml, b.return_type, b.store_release_status);

-- ---- PASSO B: a restauracao ----
begin;

update public.orders o
set blocked_at              = b.blocked_at,
    blocked_reason          = b.blocked_reason,
    last_return_notes       = b.last_return_notes,
    last_return_reason      = b.last_return_reason,
    pickup_created_at       = b.pickup_created_at,
    requires_pickup         = b.requires_pickup,
    requires_store_release  = b.requires_store_release,
    return_date             = b.return_date,
    return_flag             = b.return_flag,
    return_nfe_key          = b.return_nfe_key,
    return_nfe_number       = b.return_nfe_number,
    return_nfe_xml          = b.return_nfe_xml,
    return_type             = b.return_type,
    store_release_status    = b.store_release_status
from bkp_virada.orders_20260905 b
where b.id = o.id
  and (o.blocked_at, o.blocked_reason, o.last_return_notes, o.last_return_reason,
       o.pickup_created_at, o.requires_pickup, o.requires_store_release,
       o.return_date, o.return_flag, o.return_nfe_key, o.return_nfe_number,
       o.return_nfe_xml, o.return_type, o.store_release_status)
   is distinct from
      (b.blocked_at, b.blocked_reason, b.last_return_notes, b.last_return_reason,
       b.pickup_created_at, b.requires_pickup, b.requires_store_release,
       b.return_date, b.return_flag, b.return_nfe_key, b.return_nfe_number,
       b.return_nfe_xml, b.return_type, b.store_release_status);

commit;

-- Rode o PASSO A de novo: agora tem que dar 0.


-- ============================================================
-- COMPARACAO DAS OUTRAS TRES (nao restaura, so mostra a diferenca)
-- ============================================================

-- liberacoes que sumiram desde a foto
select * from bkp_virada.store_release_assignments_20260905 b
where not exists (select 1 from public.store_release_assignments a where a.id = b.id);

-- montagens criadas depois da foto
select * from public.assembly_products a
where not exists (select 1 from bkp_virada.assembly_products_20260905 b where b.id = a.id);

-- linhas de historico de liberacao criadas depois da foto
select * from public.store_release_history h
where not exists (select 1 from bkp_virada.store_release_history_20260905 b where b.id = h.id);


-- ============================================================
-- LIMPEZA — so depois do periodo de observacao, quando estiver tranquilo.
-- ============================================================
-- drop schema bkp_virada cascade;
