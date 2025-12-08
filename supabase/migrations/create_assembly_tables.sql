-- Criar tabela de rotas de montagem
CREATE TABLE public.assembly_routes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    deadline TIMESTAMP WITH TIME ZONE,
    observations TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Criar tabela de produtos de montagem
CREATE TABLE public.assembly_products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    assembly_route_id UUID REFERENCES public.assembly_routes(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    product_sku TEXT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    installation_address JSONB,
    installer_id UUID REFERENCES public.users(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'cancelled')),
    assembly_date TIMESTAMP WITH TIME ZONE,
    completion_date TIMESTAMP WITH TIME ZONE,
    observations TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Criar índices para melhor performance
CREATE INDEX idx_assembly_routes_status ON public.assembly_routes(status);
CREATE INDEX idx_assembly_routes_created_at ON public.assembly_routes(created_at);
CREATE INDEX idx_assembly_products_status ON public.assembly_products(status);
CREATE INDEX idx_assembly_products_assembly_route_id ON public.assembly_products(assembly_route_id);
CREATE INDEX idx_assembly_products_order_id ON public.assembly_products(order_id);
CREATE INDEX idx_assembly_products_installer_id ON public.assembly_products(installer_id);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.assembly_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assembly_products ENABLE ROW LEVEL SECURITY;

-- Criar políticas de segurança
-- Políticas para assembly_routes
CREATE POLICY "Permitir leitura de rotas para usuários autenticados" ON public.assembly_routes
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Permitir criação de rotas para admin" ON public.assembly_routes
    FOR INSERT WITH CHECK (auth.uid() IN (SELECT id FROM public.users WHERE role = 'admin'));

CREATE POLICY "Permitir atualização de rotas para admin" ON public.assembly_routes
    FOR UPDATE USING (auth.uid() IN (SELECT id FROM public.users WHERE role = 'admin'));

-- Políticas para assembly_products
CREATE POLICY "Permitir leitura de produtos para usuários autenticados" ON public.assembly_products
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Permitir criação de produtos para admin" ON public.assembly_products
    FOR INSERT WITH CHECK (auth.uid() IN (SELECT id FROM public.users WHERE role = 'admin'));

CREATE POLICY "Permitir atualização de produtos para admin e montador" ON public.assembly_products
    FOR UPDATE USING (
        auth.uid() IN (SELECT id FROM public.users WHERE role = 'admin') OR
        auth.uid() = installer_id
    );

-- Conceder permissões
GRANT SELECT ON public.assembly_routes TO anon, authenticated;
GRANT INSERT ON public.assembly_routes TO authenticated;
GRANT UPDATE ON public.assembly_routes TO authenticated;

GRANT SELECT ON public.assembly_products TO anon, authenticated;
GRANT INSERT ON public.assembly_products TO authenticated;
GRANT UPDATE ON public.assembly_products TO authenticated;

-- Criar função para atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Criar triggers para updated_at
CREATE TRIGGER update_assembly_routes_updated_at BEFORE UPDATE ON public.assembly_routes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assembly_products_updated_at BEFORE UPDATE ON public.assembly_products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();