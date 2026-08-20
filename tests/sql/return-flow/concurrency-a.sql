\set ON_ERROR_STOP on
begin;
select public.register_order_return_pickup(
  (select id from public.order_returns where external_key = 'conc-return'),
  (select id from public.orders where order_id_erp = 'CONC-COLETA-A'),
  (select id from public.routes where name = 'COLETA-CONCORRENCIA-A')
);
select pg_sleep(1);
commit;
