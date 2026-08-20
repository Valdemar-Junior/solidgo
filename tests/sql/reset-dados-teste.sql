-- ============================================================================
-- RESET DE DADOS OPERACIONAIS — BANCO DE TESTE APENAS  ⚠️
-- ----------------------------------------------------------------------------
-- Apaga TODOS os pedidos, rotas, montagens e tudo derivado deles, pra recomeçar
-- os testes do zero. PRESERVA usuários, motoristas, equipes, veículos e todas
-- as configurações (app_settings, webhooks, MDF-e settings/emitentes, catálogo
-- de rotas, inspeções de frota, preferências).
--
-- Como funciona: TRUNCATE ... CASCADE nas 3 "raízes" (orders, routes,
-- assembly_routes) limpa automaticamente, na ordem certa, todas as tabelas
-- que dependem delas — sem erro de chave estrangeira e sem deixar órfão.
--
-- ⚠️ NUNCA rodar na produção. Confirme que está no projeto de TESTE
--    (lbidznhkhtwamgaexgyy) antes de executar.
-- ============================================================================

BEGIN;

TRUNCATE TABLE
  public.orders,
  public.routes,
  public.assembly_routes
CASCADE;

COMMIT;

-- Conferência (deve vir tudo 0):
SELECT
  (SELECT count(*) FROM public.orders)            AS orders,
  (SELECT count(*) FROM public.order_items)        AS order_items,
  (SELECT count(*) FROM public.order_returns)      AS order_returns,
  (SELECT count(*) FROM public.routes)             AS routes,
  (SELECT count(*) FROM public.route_orders)       AS route_orders,
  (SELECT count(*) FROM public.assembly_routes)    AS assembly_routes,
  (SELECT count(*) FROM public.assembly_products)  AS assembly_products,
  (SELECT count(*) FROM public.order_item_holds)   AS holds,
  -- e o que TEM que continuar cheio:
  (SELECT count(*) FROM public.users)              AS users_preservados,
  (SELECT count(*) FROM public.vehicles)           AS vehicles_preservados,
  (SELECT count(*) FROM public.teams_user)         AS teams_preservados;
