-- Insert test users for authentication testing
-- This migration creates admin and driver users with known credentials

-- Admin user: admin@example.com / password: admin123
INSERT INTO auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    role
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'admin@example.com',
    crypt('admin123', gen_salt('bf')),
    NOW(),
    NOW(),
    NOW(),
    'authenticated'
);

-- Driver user: driver@example.com / password: driver123  
INSERT INTO auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    role
) VALUES (
    '00000000-0000-0000-0000-000000000002',
    'driver@example.com',
    crypt('driver123', gen_salt('bf')),
    NOW(),
    NOW(),
    NOW(),
    'authenticated'
);

-- Insert corresponding user profiles in public.users table
INSERT INTO public.users (id, email, name, role, phone) VALUES 
    ('00000000-0000-0000-0000-000000000001', 'admin@example.com', 'Administrador Teste', 'admin', '11999999999'),
    ('00000000-0000-0000-0000-000000000002', 'driver@example.com', 'Motorista Teste', 'driver', '11988888888');

-- Insert driver profile for the driver user
INSERT INTO public.drivers (user_id, license_number, vehicle_type, status) VALUES 
    ('00000000-0000-0000-0000-000000000002', '12345678900', 'van', 'active');

-- Grant proper permissions to the users
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;