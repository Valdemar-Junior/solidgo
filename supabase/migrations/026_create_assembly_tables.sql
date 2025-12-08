-- Criar tabela de romaneios de montagem
CREATE TABLE IF NOT EXISTS assembly_routes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  admin_id UUID NOT NULL REFERENCES auth.users(id),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  deadline DATE,
  observations TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Criar tabela de produtos para montagem
CREATE TABLE IF NOT EXISTS assembly_products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assembly_route_id UUID NOT NULL REFERENCES assembly_routes(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id),
  product_name VARCHAR(255) NOT NULL,
  product_sku VARCHAR(100),
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50),
  installation_address JSONB NOT NULL,
  assembly_date TIMESTAMP WITH TIME ZONE,
  installer_id UUID REFERENCES auth.users(id),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'cancelled')),
  completion_date TIMESTAMP WITH TIME ZONE,
  technical_notes TEXT,
  photos JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_assembly_routes_admin ON assembly_routes(admin_id);
CREATE INDEX IF NOT EXISTS idx_assembly_routes_status ON assembly_routes(status);
CREATE INDEX IF NOT EXISTS idx_assembly_products_route ON assembly_products(assembly_route_id);
CREATE INDEX IF NOT EXISTS idx_assembly_products_order ON assembly_products(order_id);
CREATE INDEX IF NOT EXISTS idx_assembly_products_installer ON assembly_products(installer_id);
CREATE INDEX IF NOT EXISTS idx_assembly_products_status ON assembly_products(status);

-- RLS Policies
ALTER TABLE assembly_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE assembly_products ENABLE ROW LEVEL SECURITY;

-- Policies para assembly_routes
CREATE POLICY "Admins can view all assembly routes" ON assembly_routes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

CREATE POLICY "Admins can create assembly routes" ON assembly_routes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update assembly routes" ON assembly_routes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Policies para assembly_products
CREATE POLICY "Admins can view all assembly products" ON assembly_products
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'montador')
    )
  );

CREATE POLICY "Installers can view their assigned products" ON assembly_products
  FOR SELECT USING (
    installer_id = auth.uid()
  );

CREATE POLICY "Admins can update assembly products" ON assembly_products
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

CREATE POLICY "Installers can update their assigned products" ON assembly_products
  FOR UPDATE USING (
    installer_id = auth.uid()
  );

-- Grant permissions
GRANT ALL ON assembly_routes TO authenticated;
GRANT ALL ON assembly_products TO authenticated;