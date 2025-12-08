-- APAGAR TABELA ORDERS E CRIAR DO ZERO COM TODOS OS CAMPOS E RLS CORRETAS
-- Execute este script completo no Supabase

-- 1. Apagar tabela existente (cuidado - isso apaga todos os dados!)
DROP TABLE IF EXISTS orders CASCADE;

-- 2. Criar tabela do zero com TODOS os campos do JSON
CREATE TABLE orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    id_unico_integracao BIGINT UNIQUE NOT NULL,
    operacoes TEXT,
    filial_venda TEXT,
    lancamento_venda BIGINT,
    data_venda TIMESTAMP WITH TIME ZONE,
    previsao_entrega TIMESTAMP WITH TIME ZONE,
    codigo_cliente TEXT,
    nome_cliente TEXT,
    cliente_celular TEXT,
    destinatario_endereco TEXT,
    destinatario_complemento TEXT,
    destinatario_bairro TEXT,
    destinatario_cidade TEXT,
    observacoes TEXT,
    tipo INTEGER,
    filial_entrega TEXT,
    status_logistica TEXT,
    tem_frete_full TEXT,
    codigo_produto TEXT,
    nome_produto TEXT,
    local_estocagem TEXT,
    tem_montagem TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Criar índices para performance
CREATE INDEX idx_orders_id_unico_integracao ON orders(id_unico_integracao);
CREATE INDEX idx_orders_lancamento_venda ON orders(lancamento_venda);
CREATE INDEX idx_orders_codigo_cliente ON orders(codigo_cliente);
CREATE INDEX idx_orders_status_logistica ON orders(status_logistica);
CREATE INDEX idx_orders_data_venda ON orders(data_venda);

-- 4. Criar RLS policies (VERSÃO CORRIGIDA E MAIS SIMPLES)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Policy para SELECT: Todos autenticados podem ver
CREATE POLICY "Todos autenticados podem ver pedidos" ON orders
    FOR SELECT USING (auth.role() = 'authenticated');

-- Policy para INSERT: Apenas admin pode inserir
CREATE POLICY "Apenas admin pode inserir pedidos" ON orders
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() 
            AND role = 'admin'
        )
    );

-- Policy para UPDATE: Apenas admin pode atualizar
CREATE POLICY "Apenas admin pode atualizar pedidos" ON orders
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() 
            AND role = 'admin'
        )
    );

-- Policy para DELETE: Apenas admin pode deletar
CREATE POLICY "Apenas admin pode deletar pedidos" ON orders
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() 
            AND role = 'admin'
        )
    );

-- 5. Grant permissions (mais simples)
GRANT ALL ON orders TO authenticated;

-- 6. Verificar estrutura criada
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'orders' AND table_schema = 'public'
ORDER BY ordinal_position;

-- 7. Verificar policies criadas
SELECT polname, polcmd, polqual, polwithcheck
FROM pg_policies 
WHERE tablename = 'orders';