\set ON_ERROR_STOP on

select public.test_assert(
  (select pickup_order_id = (select id from public.orders where order_id_erp = 'CONC-COLETA-A')
   from public.order_returns where external_key = 'conc-return'),
  'CONCORRÊNCIA: somente a primeira criação fica vinculada ao evento'
);

select public.test_assert(
  (select count(*) = 1 from public.order_returns where pickup_created_at is not null),
  'CONCORRÊNCIA: duas tentativas simultâneas não duplicam a coleta'
);
