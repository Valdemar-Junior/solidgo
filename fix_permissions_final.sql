-- 🛠️ SOLUÇÃO DEFINITIVA PARA O ERRO 500 (LOOP INFINITO) 🛠️
-- Este script cria uma "Função Segura" que impede que o banco entre em parafuso ao checar permissões.

-- 1. Cria função is_admin() que pula as travas de segurança (SECURITY DEFINER)
-- Isso permite checar se é admin sem causar o loop "Quem vigia o vigia?"
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() 
    AND role = 'admin'
  );
$$;

-- 2. Limpa a bagunça (Remove todas as tentativas anteriores de politicas)
DROP POLICY IF EXISTS "Admins all" ON public.users;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
DROP POLICY IF EXISTS "Auth read orders" ON public.users;
DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
DROP POLICY IF EXISTS "Admins can update users" ON public.users;
-- REMOVENDO AS NOVAS TAMBÉM (Para garantir que não dê erro de duplicidade)
DROP POLICY IF EXISTS "Users view self" ON public.users;
DROP POLICY IF EXISTS "Admins full access" ON public.users;

-- 3. Aplica as regras blindadas
-- Regra A: Cada um cuida da sua vida (Lê o próprio perfil)
CREATE POLICY "Users view self" 
ON public.users FOR SELECT 
USING (auth.uid() = id);

-- Regra B: Admin manda em tudo (Usando a função segura)
CREATE POLICY "Admins full access" 
ON public.users FOR ALL 
USING (is_admin());

-- (Opcional) Garante que RLS está ligado
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
