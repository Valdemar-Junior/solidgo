-- Verificar e ajustar RLS policies para novos campos
-- As policies existentes já cobrem todas as colunas, mas vamos garantir que os novos campos estejam incluídos

-- Policy para SELECT (leitura) - já existe, mas vamos recriar para garantir cobertura total
DROP POLICY IF EXISTS "Users can view their own data" ON orders;
CREATE POLICY "Users can view their own data" ON orders
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
  );

-- Policy para INSERT - já existe, mas vamos recriar para garantir cobertura total
DROP POLICY IF EXISTS "Admins can insert orders" ON orders;
CREATE POLICY "Admins can insert orders" ON orders
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Policy para UPDATE - já existe, mas vamos recriar para garantir cobertura total
DROP POLICY IF EXISTS "Admins can update orders" ON orders;
CREATE POLICY "Admins can update orders" ON orders
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Policy para DELETE - já existe, mas vamos recriar para garantir cobertura total
DROP POLICY IF EXISTS "Admins can delete orders" ON orders;
CREATE POLICY "Admins can delete orders" ON orders
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Garantir que RLS esteja habilitada
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Verificar se as policies estão ativas
ALTER TABLE orders FORCE ROW LEVEL SECURITY;