\set ON_ERROR_STOP on

select public.test_assert(
  (select processing_status = 'divergent' from public.order_returns where external_key = 'upgrade-r2'),
  'UPGRADE: evento excessivo mais recente é separado como divergente'
);

select public.test_assert(
  (select processing_status = 'processed' from public.order_returns where external_key = 'upgrade-r1'),
  'UPGRADE: primeira devolução válida permanece processada'
);

select public.test_assert(
  (select bool_and(num_nonnulls(pickup_created_at, pickup_order_id, pickup_route_id) = 0)
   from public.order_returns
   where external_key in ('upgrade-r1', 'upgrade-r2', 'upgrade-partial-link')),
  'UPGRADE: vínculos duplicados ou incompletos voltam integralmente para pendência'
);

select public.test_assert(
  (select count(*) = 1 from public.item_fulfillment_sync_issues
   where issue_type = 'return_quantity_exceeded' and status = 'open'),
  'UPGRADE: excesso anterior à migration fica auditável'
);
