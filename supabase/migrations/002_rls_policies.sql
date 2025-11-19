-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Users table policies
CREATE POLICY "Users can view their own profile" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins can view all users" ON users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

CREATE POLICY "Admins can update users" ON users
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Drivers table policies
CREATE POLICY "Users can view their own driver profile" ON drivers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'driver' AND u.id = drivers.user_id
    )
  );

CREATE POLICY "Admins can view all drivers" ON drivers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage drivers" ON drivers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Vehicles table policies
CREATE POLICY "All authenticated users can view vehicles" ON vehicles
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage vehicles" ON vehicles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Orders table policies
CREATE POLICY "All authenticated users can view orders" ON orders
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage orders" ON orders
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Routes table policies
CREATE POLICY "Drivers can view their assigned routes" ON routes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM drivers d 
      JOIN users u ON d.user_id = u.id
      WHERE u.id = auth.uid() AND u.role = 'driver' AND d.id = routes.driver_id
    )
  );

CREATE POLICY "Admins can view all routes" ON routes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage routes" ON routes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Route orders policies
CREATE POLICY "Drivers can view route orders for their routes" ON route_orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM routes r
      JOIN drivers d ON r.driver_id = d.id
      JOIN users u ON d.user_id = u.id
      WHERE u.id = auth.uid() AND u.role = 'driver' AND r.id = route_orders.route_id
    )
  );

CREATE POLICY "Admins can view all route orders" ON route_orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

CREATE POLICY "Drivers can update their route orders" ON route_orders
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM routes r
      JOIN drivers d ON r.driver_id = d.id
      JOIN users u ON d.user_id = u.id
      WHERE u.id = auth.uid() AND u.role = 'driver' AND r.id = route_orders.route_id
    )
  );

CREATE POLICY "Admins can manage route orders" ON route_orders
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Return reasons policies (read-only for all authenticated users)
CREATE POLICY "All authenticated users can view return reasons" ON return_reasons
  FOR SELECT USING (auth.role() = 'authenticated');

-- Sync logs policies
CREATE POLICY "Users can view their own sync logs" ON sync_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all sync logs" ON sync_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage sync logs" ON sync_logs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Grant permissions to anon and authenticated roles
GRANT SELECT ON users TO anon;
GRANT ALL ON users TO authenticated;
GRANT SELECT ON drivers TO anon;
GRANT ALL ON drivers TO authenticated;
GRANT SELECT ON vehicles TO anon;
GRANT ALL ON vehicles TO authenticated;
GRANT SELECT ON orders TO anon;
GRANT ALL ON orders TO authenticated;
GRANT SELECT ON routes TO anon;
GRANT ALL ON routes TO authenticated;
GRANT SELECT ON route_orders TO anon;
GRANT ALL ON route_orders TO authenticated;
GRANT SELECT ON return_reasons TO anon;
GRANT ALL ON return_reasons TO authenticated;
GRANT SELECT ON sync_logs TO anon;
GRANT ALL ON sync_logs TO authenticated;