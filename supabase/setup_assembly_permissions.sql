-- Grant basic permissions for assembly tables to anon and authenticated roles

-- Grant permissions for assembly_routes table
GRANT SELECT ON assembly_routes TO anon;
GRANT SELECT, INSERT, UPDATE ON assembly_routes TO authenticated;

-- Grant permissions for assembly_products table  
GRANT SELECT ON assembly_products TO anon;
GRANT SELECT, INSERT, UPDATE ON assembly_products TO authenticated;

-- Create basic RLS policies for assembly_routes if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'assembly_routes' AND policyname = 'Enable read access for all users') THEN
    CREATE POLICY "Enable read access for all users" ON assembly_routes FOR SELECT USING (true);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'assembly_routes' AND policyname = 'Enable insert for authenticated users') THEN
    CREATE POLICY "Enable insert for authenticated users" ON assembly_routes FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'assembly_routes' AND policyname = 'Enable update for authenticated users') THEN
    CREATE POLICY "Enable update for authenticated users" ON assembly_routes FOR UPDATE USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Create basic RLS policies for assembly_products if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'assembly_products' AND policyname = 'Enable read access for all users') THEN
    CREATE POLICY "Enable read access for all users" ON assembly_products FOR SELECT USING (true);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'assembly_products' AND policyname = 'Enable insert for authenticated users') THEN
    CREATE POLICY "Enable insert for authenticated users" ON assembly_products FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'assembly_products' AND policyname = 'Enable update for authenticated users') THEN
    CREATE POLICY "Enable update for authenticated users" ON assembly_products FOR UPDATE USING (auth.role() = 'authenticated');
  END IF;
END $$;