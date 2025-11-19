-- Limpar usuários existentes para evitar conflitos
DELETE FROM drivers WHERE user_id IN (SELECT id FROM users WHERE email IN ('admin@deliveryapp.com', 'driver@deliveryapp.com'));
DELETE FROM users WHERE email IN ('admin@deliveryapp.com', 'driver@deliveryapp.com');

-- Nota: Não podemos deletar diretamente da tabela auth.users via SQL
-- Isso precisa ser feito através da API do Supabase