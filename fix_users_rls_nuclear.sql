-- 🔍 DIAGNÓSTICO E CORREÇÃO AGRESSIVA PARA TABELA USERS 🔍
-- Se tudo falhou até agora, vamos forçar na marra

-- PASSO 1: Checar se RLS está ligado (deveria mostrar TRUE)
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname = 'users' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- PASSO 2: Listar TODAS as políticas que existem na tabela users
SELECT polname as policy_name, 
       CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END as command,
       polpermissive as is_permissive
FROM pg_policy 
WHERE polrelid = 'public.users'::regclass;

-- PASSO 3: NUCLEAR OPTION - Desliga RLS temporariamente, depois reativa com políticas limpas
-- Este bloco vai:
-- a) Desligar RLS (permite tudo temporariamente)
-- b) Apagar TODAS as políticas existentes
-- c) Criar as políticas corretas
-- d) Religar RLS

DO $$
DECLARE
    pol RECORD;
BEGIN
    -- Desliga RLS
    ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
    
    -- Apaga TODAS as políticas da tabela users (loop por todas que existirem)
    FOR pol IN 
        SELECT polname FROM pg_policy WHERE polrelid = 'public.users'::regclass
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', pol.polname);
        RAISE NOTICE 'Dropped policy: %', pol.polname;
    END LOOP;
    
    -- Cria a função is_admin() se não existir
    CREATE OR REPLACE FUNCTION public.is_admin()
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $func$
      SELECT EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() 
        AND role = 'admin'
      );
    $func$;
    
    -- Cria políticas limpas
    -- Política 1: Cada um pode ler seu próprio perfil
    CREATE POLICY "allow_self_select" ON public.users
    FOR SELECT USING (auth.uid() = id);
    
    -- Política 2: Admin pode fazer tudo
    CREATE POLICY "allow_admin_all" ON public.users
    FOR ALL USING (is_admin());
    
    -- Política 3: Inserção para usuários autenticados (para auto-criação de perfil)
    CREATE POLICY "allow_authenticated_insert" ON public.users
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
    
    -- Religa RLS
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    
    RAISE NOTICE '✅ RLS resetado e políticas recriadas com sucesso!';
END;
$$;

-- PASSO 4: Confirma que deu certo
SELECT '✅ Políticas atuais:' as status;
SELECT polname as policy_name 
FROM pg_policy 
WHERE polrelid = 'public.users'::regclass;
