-- ============================================================
-- REDE DE SEGURANCA DA VIRADA — RODAR ANTES DO 01.
-- ============================================================
--
-- POR QUE ISTO EXISTE
--
-- O 09_DESFAZER.sql desfaz a ESTRUTURA (apaga as tabelas, funcoes e
-- gatilhos que o pacote cria). Ele NAO desfaz DADO que os gatilhos novos
-- tenham escrito em tabelas que ja existiam antes.
--
-- Varredura feita em 05/09/2026 sobre 03_funcoes.sql e 08_store_release_fusao.sql:
-- o codigo novo pode escrever em QUATRO tabelas antigas.
--
--   public.orders                     14 colunas (devolucao, bloqueio, liberacao)
--   public.store_release_assignments  apaga e insere
--   public.store_release_history      so insere
--   public.assembly_products          insere e altera
--
-- Este arquivo tira uma foto dessas quatro coisas. E instantaneo e minusculo:
-- de orders copia so a chave e as 14 colunas, nao os PDFs da DANFE.
--
-- As copias ficam num schema separado, `bkp_virada`, que NAO e exposto pela
-- API do Supabase — nenhum usuario logado consegue ler isso pelo aplicativo.
--
-- Nao altera nada. So cria.
-- ============================================================

begin;

create schema if not exists bkp_virada;
revoke all on schema bkp_virada from anon, authenticated;

-- ---- 1. orders: chave + as 14 colunas que o codigo novo pode mexer ----
drop table if exists bkp_virada.orders_20260905;
create table bkp_virada.orders_20260905 as
select
  id,
  blocked_at,
  blocked_reason,
  last_return_notes,
  last_return_reason,
  pickup_created_at,
  requires_pickup,
  requires_store_release,
  return_date,
  return_flag,
  return_nfe_key,
  return_nfe_number,
  return_nfe_xml,
  return_type,
  store_release_status
from public.orders;

create unique index bkp_virada_orders_20260905_id on bkp_virada.orders_20260905 (id);

-- ---- 2, 3 e 4: copia inteira (sao tabelas operacionais pequenas) ----
drop table if exists bkp_virada.store_release_assignments_20260905;
create table bkp_virada.store_release_assignments_20260905 as
select * from public.store_release_assignments;

drop table if exists bkp_virada.store_release_history_20260905;
create table bkp_virada.store_release_history_20260905 as
select * from public.store_release_history;

drop table if exists bkp_virada.assembly_products_20260905;
create table bkp_virada.assembly_products_20260905 as
select * from public.assembly_products;

-- ---- carimbo do momento exato da foto ----
drop table if exists bkp_virada.carimbo;
create table bkp_virada.carimbo as
select now() as tirada_em, current_user as por_quem;

commit;

-- ============================================================
-- CONFERENCIA — as quatro linhas tem que dar o mesmo numero nas duas colunas.
-- ============================================================
select 'orders'                    as tabela, (select count(*) from public.orders)                    as agora, (select count(*) from bkp_virada.orders_20260905)                    as na_foto
union all
select 'store_release_assignments',          (select count(*) from public.store_release_assignments),          (select count(*) from bkp_virada.store_release_assignments_20260905)
union all
select 'store_release_history',              (select count(*) from public.store_release_history),              (select count(*) from bkp_virada.store_release_history_20260905)
union all
select 'assembly_products',                  (select count(*) from public.assembly_products),                  (select count(*) from bkp_virada.assembly_products_20260905);
