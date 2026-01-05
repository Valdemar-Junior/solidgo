-- Migration: Fix Assembly RLS Comprehensive
-- Date: 2025-02-14
-- Description: Drops existing restrictive policies and re-creates robust policies for Admins to perform ALL operations on assembly tables.

-- 1. Assembly Routes
DROP POLICY IF EXISTS "Admins can view all assembly routes" ON assembly_routes;
DROP POLICY IF EXISTS "Admins can create assembly routes" ON assembly_routes;
DROP POLICY IF EXISTS "Admins can update assembly routes" ON assembly_routes;
DROP POLICY IF EXISTS "Admins can delete assembly routes" ON assembly_routes; -- In case it exists

-- Create comprehensive Admin policy for ALL operations
CREATE POLICY "Admins can manage assembly routes" ON assembly_routes
  FOR ALL USING (
    (auth.jwt() ->> 'role') = 'service_role' OR
    ((auth.jwt() -> 'user_metadata' ->> 'role')::text = 'admin') OR
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- 2. Assembly Products
DROP POLICY IF EXISTS "Admins can view all assembly products" ON assembly_products;
DROP POLICY IF EXISTS "Admins can update assembly products" ON assembly_products;
DROP POLICY IF EXISTS "Admins can insert assembly products" ON assembly_products; -- If exists
DROP POLICY IF EXISTS "Admins can delete assembly products" ON assembly_products; -- If exists

-- Create comprehensive Admin policy for ALL operations
CREATE POLICY "Admins can manage assembly products" ON assembly_products
  FOR ALL USING (
    (auth.jwt() ->> 'role') = 'service_role' OR
    ((auth.jwt() -> 'user_metadata' ->> 'role')::text = 'admin') OR
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Ensure Installers can still view/update their assigned products
-- We drop and recreate to ensure no conflicts, although distinct names usually coexist.
DROP POLICY IF EXISTS "Installers can view their assigned products" ON assembly_products;
DROP POLICY IF EXISTS "Installers can update their assigned products" ON assembly_products;

CREATE POLICY "Installers can view their assigned products" ON assembly_products
  FOR SELECT USING (
    installer_id = auth.uid()
  );

CREATE POLICY "Installers can update their assigned products" ON assembly_products
  FOR UPDATE USING (
    installer_id = auth.uid()
  );
