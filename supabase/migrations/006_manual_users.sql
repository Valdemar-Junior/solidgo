-- Criar usuários de teste manualmente através de um script SQL
-- Isso cria os perfis de usuário no banco public.users
-- Os usuários de auth precisam ser criados através da API

-- Inserir usuário admin (assumindo que o auth.user já existe)
INSERT INTO public.users (id, email, name, role, phone, created_at) 
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'admin@deliveryapp.com',
  'Admin User',
  'admin',
  '(11) 98765-4321',
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Inserir usuário motorista (assumindo que o auth.user já existe)
INSERT INTO public.users (id, email, name, role, phone, created_at) 
VALUES (
  '00000000-0000-0000-0000-000000000002'::uuid,
  'driver@deliveryapp.com',
  'Driver User',
  'driver',
  '(11) 91234-5678',
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Criar perfil de motorista
INSERT INTO public.drivers (user_id, cpf, vehicle_id, active)
VALUES (
  '00000000-0000-0000-0000-000000000002'::uuid,
  '12345678901',
  (SELECT id FROM vehicles WHERE plate = 'ABC-1234' LIMIT 1),
  true
) ON CONFLICT (user_id) DO NOTHING;