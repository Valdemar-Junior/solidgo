-- Insert test vehicles
INSERT INTO vehicles (plate, model, capacity, active) VALUES
  ('ABC-1234', 'Fiat Fiorino', 800, true),
  ('DEF-5678', 'Volkswagen Saveiro', 750, true),
  ('GHI-9012', 'Chevrolet Montana', 700, true);

-- Insert test orders
INSERT INTO orders (order_id_erp, customer_name, phone, address_json, items_json, total, status, observations) VALUES
  ('ORD-001', 'João Silva', '(11) 91234-5678', 
   '{"street": "Rua das Flores, 123", "neighborhood": "Jardim Primavera", "city": "São Paulo", "state": "SP", "zip": "01234-567"}',
   '[{"sku": "PROD-001", "name": "Produto Teste 1", "quantity": 2, "price": 50.00}, {"sku": "PROD-002", "name": "Produto Teste 2", "quantity": 1, "price": 30.00}]',
   130.00, 'imported', 'Entregar entre 9h e 18h'),
  
  ('ORD-002', 'Maria Santos', '(11) 98765-4321',
   '{"street": "Av. Principal, 456", "neighborhood": "Centro", "city": "São Paulo", "state": "SP", "zip": "05432-109"}',
   '[{"sku": "PROD-003", "name": "Produto Teste 3", "quantity": 1, "price": 75.00}]',
   75.00, 'imported', 'Deixar com o porteiro'),
  
  ('ORD-003', 'Pedro Oliveira', '(11) 99887-7665',
   '{"street": "Rua Secundária, 789", "neighborhood": "Vila Nova", "city": "São Paulo", "state": "SP", "zip": "02345-678"}',
   '[{"sku": "PROD-004", "name": "Produto Teste 4", "quantity": 3, "price": 25.00}]',
   75.00, 'imported', 'Tocar interfone 201');