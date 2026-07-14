-- ============================================================================
-- BLINDAGEM DE SEGURANÇA — fecha acessos indevidos por `anon` (não logado)
-- ----------------------------------------------------------------------------
-- Como a anon key é pública (fica no navegador), toda a segurança depende de RLS.
-- A auditoria encontrou tabelas/funções acessíveis por NÃO logados. Aqui fechamos.
-- Não quebra o app: os fluxos usados por usuários LOGADOS continuam funcionando.
-- ============================================================================

-- 1) orders_backup_20241130: backup antigo (nov/2024) com telefone de cliente,
--    aberto a anon, e SEM uso no código. Removido.
DROP TABLE IF EXISTS public.orders_backup_20241130;

-- 2) audit_logs: trilha de auditoria estava aberta a anon (ler/forjar/apagar).
--    Passa a exigir usuário logado (ou serviço).
DROP POLICY IF EXISTS "Enable all for public" ON public.audit_logs;
CREATE POLICY audit_logs_authenticated ON public.audit_logs
  USING ((SELECT auth.role()) = ANY (ARRAY['authenticated', 'service_role']))
  WITH CHECK ((SELECT auth.role()) = ANY (ARRAY['authenticated', 'service_role']));
REVOKE ALL ON TABLE public.audit_logs FROM anon;

-- 3) teams_user: composição de equipes estava aberta a anon. Fecha para logados.
DROP POLICY IF EXISTS "Enable all for public" ON public.teams_user;
CREATE POLICY teams_user_authenticated ON public.teams_user
  USING ((SELECT auth.role()) = ANY (ARRAY['authenticated', 'service_role']))
  WITH CHECK ((SELECT auth.role()) = ANY (ARRAY['authenticated', 'service_role']));
REVOKE ALL ON TABLE public.teams_user FROM anon;

-- 4) assembly_products / assembly_routes: tinham leitura por anon. A leitura por
--    usuário LOGADO segue por outras policies existentes ("Permitir leitura ...").
DROP POLICY IF EXISTS "Enable read access for all users" ON public.assembly_products;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.assembly_routes;
REVOKE ALL ON TABLE public.assembly_products FROM anon;
REVOKE ALL ON TABLE public.assembly_routes FROM anon;

-- 5) webhook_settings: qualquer logado podia EDITAR as URLs de webhook.
--    Leitura segue para logados (o app precisa pra enviar mensagens);
--    a ESCRITA passa a ser só de admin.
DROP POLICY IF EXISTS webhook_settings_modify_authenticated ON public.webhook_settings;
CREATE POLICY webhook_settings_modify_admin ON public.webhook_settings
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.role = 'admin'));

-- 6) Função de montagem estava exposta a anon e sem checar papel. Tira do anon.
REVOKE ALL ON FUNCTION public.sync_missing_assembly_products_for_pickup_items(uuid, text[]) FROM anon;

-- 7) RAIZ DO PROBLEMA: privilégios padrão davam a anon tudo que fosse criado
--    depois. Sem isto, cada nova tabela/função nasce aberta de novo.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- O mesmo para objetos criados pelo papel supabase_admin. Em alguns projetos o
-- papel que aplica a migration não tem permissão sobre supabase_admin — por isso
-- vai em bloco tolerante a erro (não aborta a migration se não for permitido).
DO $$
BEGIN
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
EXCEPTION WHEN insufficient_privilege OR others THEN
  RAISE NOTICE 'Sem permissão para alterar default privileges de supabase_admin — rode como esse papel se necessário.';
END $$;
