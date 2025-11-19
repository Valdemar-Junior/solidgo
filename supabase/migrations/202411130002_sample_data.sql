-- Insert sample users
INSERT INTO users (id, email, name, role, phone) VALUES 
  ('550e8400-e29b-41d4-a716-446655440000', 'admin@delivery.com', 'Administrador', 'admin', '+55 84 90000-0000'),
  ('550e8400-e29b-41d4-a716-446655440001', 'driver@delivery.com', 'Motorista Teste', 'driver', '+55 84 90000-0001');

-- Insert sample drivers
INSERT INTO drivers (id, user_id, cpf, vehicle_id, active) VALUES 
  ('660e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001', '123.456.789-00', '770e8400-e29b-41d4-a716-446655440000', true);

-- Insert sample vehicles
INSERT INTO vehicles (id, plate, model, capacity, active) VALUES 
  ('770e8400-e29b-41d4-a716-446655440000', 'ABC-1234', 'Fiat Ducato', 1500, true),
  ('770e8400-e29b-41d4-a716-446655440001', 'DEF-5678', 'Mercedes Sprinter', 2000, true);

-- Insert sample orders
INSERT INTO orders (id, order_id_erp, customer_name, phone, address_json, items_json, total, status, observations) VALUES 
  ('880e8400-e29b-41d4-a716-446655440000', 'ERP-001', 'João Silva', '+55 84 91111-1111', 
   '{"street": "Rua das Flores, 123", "neighborhood": "Centro", "city": "Natal", "state": "RN", "zip": "59000-000"}',
   '[{"sku": "SOFA-001", "name": "Sofá 3 Lugares", "qty": 1, "price": 1299.90}]',
   1299.90, 'imported', 'Entregar preferencialmente pela manhã'),
  
  ('880e8400-e29b-41d4-a716-446655440001', 'ERP-002', 'Maria Santos', '+55 84 92222-2222',
   '{"street": "Av. Principal, 456", "neighborhood": "Lagoa Nova", "city": "Natal", "state": "RN", "zip": "59000-001"}',
   '[{"sku": "MESA-001", "name": "Mesa de Jantar 6 Lugares", "qty": 1, "price": 899.90}]',
   899.90, 'imported', 'Casa com portão azul'),
   
  ('880e8400-e29b-41d4-a716-446655440002', 'ERP-003', 'Pedro Oliveira', '+55 84 93333-3333',
   '{"street": "Rua do Comércio, 789", "neighborhood": "Cidade Nova", "city": "Natal", "state": "RN", "zip": "59000-002"}',
   '[{"sku": "CAMA-001", "name": "Cama Box Queen", "qty": 1, "price": 1599.90}]',
   1599.90, 'imported', 'Ligar antes de entregar');

-- Insert sample routes
INSERT INTO routes (id, name, driver_id, vehicle_id, conferente, observations, status) VALUES 
  ('990e8400-e29b-41d4-a716-446655440000', 'Rota Centro - Manhã', '660e8400-e29b-41d4-a716-446655440000', '770e8400-e29b-41d4-a716-446655440000', 'João Conferente', 'Rota prioritaria do centro', 'pending'),
  ('990e8400-e29b-41d4-a716-446655440001', 'Rota Zona Sul - Tarde', '660e8400-e29b-41d4-a716-446655440000', '770e8400-e29b-41d4-a716-446655440001', 'Maria Conferente', 'Entregas zona sul', 'pending');

-- Insert sample route_orders
INSERT INTO route_orders (id, route_id, order_id, sequence, status) VALUES 
  ('aa0e8400-e29b-41d4-a716-446655440000', '990e8400-e29b-41d4-a716-446655440000', '880e8400-e29b-41d4-a716-446655440000', 1, 'pending'),
  ('aa0e8400-e29b-41d4-a716-446655440001', '990e8400-e29b-41d4-a716-446655440000', '880e8400-e29b-41d4-a716-446655440001', 2, 'pending'),
  ('aa0e8400-e29b-41d4-a716-446655440002', '990e8400-e29b-41d4-a716-446655440001', '880e8400-e29b-41d4-a716-446655440002', 1, 'pending');

-- Insert auth.users (this should be done through Supabase Auth API, but for testing we can insert directly)
-- Note: In production, users should be created through Supabase Auth API
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role, created_at, updated_at) VALUES 
  ('550e8400-e29b-41d4-a716-446655440000', 'admin@delivery.com', '$2a$10$YourHashedPasswordHere', NOW(), 'authenticated', NOW(), NOW()),
  ('550e8400-e29b-41d4-a716-446655440001', 'driver@delivery.com', '$2a$10$YourHashedPasswordHere', NOW(), 'authenticated', NOW(), NOW());