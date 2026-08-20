-- ============================================================================
-- Bloco 2 — Endurecimento de seguranca (B7 + B2)
-- ============================================================================
-- Objetivo: fechar as brechas de seguranca sem alterar NENHUM dado nem
-- comportamento do app logado. Mexe apenas em: visibilidade da view, grants
-- do papel 'anon' (usuario NAO logado) e policy de escrita por item.
--
-- Fatos verificados na fonte (banco de teste lbidznhkhtwamgaexgyy, 2026-07-09):
--   * As tabelas base (order_items, order_returns, order_return_items,
--     route_order_items) tem RLS ON com policy de SELECT USING(true) para
--     'authenticated' -> usuario logado ve tudo (comportamento preservado).
--   * A view order_item_shadow_balances NAO tinha security_invoker -> rodava
--     como owner e furava a RLS, deixando 'anon' LER todos os saldos.
--   * TODAS as funcoes do schema public tem grant EXECUTE explicito para
--     'authenticated' (confirmado: zero funcoes dependem so de PUBLIC) ->
--     revogar de PUBLIC/anon nao quebra o app logado nem o service_role.
--   * O unico acesso NAO autenticado real e: login (resolve_login_email) e a
--     pagina publica /rastreio (get_order_public). Todo o resto roda logado.
--   * O n8n conecta como papel privilegiado (nao 'anon') -> nao e afetado.
--
-- COMO APLICAR COM SEGURANCA: rodar PRIMEIRO no banco de TESTE, validar
-- (1) login, (2) /rastreio, (3) uma entrega itemizada marcando item no PWA,
-- e so entao levar a producao.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) VIEW order_item_shadow_balances: passar a respeitar a RLS de quem consulta.
--    authenticated (policy USING true nas tabelas base) continua vendo tudo;
--    anon deixa de conseguir ler saldos pela view. Fecha o 1 ERROR do advisor.
-- ----------------------------------------------------------------------------
ALTER VIEW public.order_item_shadow_balances SET (security_invoker = true);

-- ----------------------------------------------------------------------------
-- 2) Remover o acesso amplo do papel 'anon' nas tabelas operacionais por item
--    e na view. A RLS ja bloqueava anon (policies so para authenticated), entao
--    isto e higiene/defesa em profundidade — nada em uso depende de anon aqui.
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.order_items                 FROM anon;
REVOKE ALL ON TABLE public.order_returns               FROM anon;
REVOKE ALL ON TABLE public.order_return_items          FROM anon;
REVOKE ALL ON TABLE public.route_order_items           FROM anon;
REVOKE ALL ON TABLE public.order_item_shadow_balances  FROM anon;

-- ----------------------------------------------------------------------------
-- 3) Tirar EXECUTE de PUBLIC e de 'anon' em TODAS as funcoes do schema public,
--    reconcedendo apenas as duas que o fluxo NAO autenticado precisa.
--    authenticated e service_role mantem seus grants explicitos (verificado).
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Reabilitar somente o essencial para anon (login e rastreio publico):
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_order_public(text, text) TO anon;

-- ----------------------------------------------------------------------------
-- 4) B2 — route_order_items: a RLS estava ligada com policy so de SELECT, entao
--    o UPDATE por item do motorista (feito como 'authenticated') afetava 0 linhas
--    em silencio (o codigo assumia sucesso). Adiciona a policy de UPDATE coerente
--    com o modelo permissivo ja usado no SELECT desta tabela.
--    (INSERT/DELETE continuam so via RPC SECURITY DEFINER; o app so faz UPDATE.)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS route_order_items_update_authenticated ON public.route_order_items;
CREATE POLICY route_order_items_update_authenticated
  ON public.route_order_items
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================================
-- Pendencias que NAO sao SQL (fazer no painel do Supabase):
--   * Auth > Providers/Policies: ligar "Leaked password protection".
--   * (Opcional, WARN de baixo risco) fixar search_path nas poucas funcoes
--     SECURITY INVOKER de trigger (set_*_updated_at, store_release_*). Nao e
--     escalonamento de privilegio por serem invoker; pode ser feito depois.
-- ============================================================================
