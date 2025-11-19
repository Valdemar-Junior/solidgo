-- Simple script to create test users manually
-- Run this directly in Supabase SQL editor

-- Create admin user
INSERT INTO auth.users (
    instance_id,
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    role
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'admin@deliveryapp.com',
    crypt('admin123', gen_salt('bf')),
    NOW(),
    NOW(),
    NOW(),
    'authenticated'
) ON CONFLICT (email) DO NOTHING;

-- Create driver user
INSERT INTO auth.users (
    instance_id,
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    role
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'driver@deliveryapp.com',
    crypt('driver123', gen_salt('bf')),
    NOW(),
    NOW(),
    NOW(),
    'authenticated'
) ON CONFLICT (email) DO NOTHING;

-- Now create the public.users profiles
-- First get the auth user IDs
WITH admin_auth AS (
    SELECT id FROM auth.users WHERE email = 'admin@deliveryapp.com'
),
driver_auth AS (
    SELECT id FROM auth.users WHERE email = 'driver@deliveryapp.com'
)
INSERT INTO public.users (id, email, name, role, phone)
SELECT id, 'admin@deliveryapp.com', 'Admin Delivery', 'admin', '11999999999'
FROM admin_auth
WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE email = 'admin@deliveryapp.com')
UNION ALL
SELECT id, 'driver@deliveryapp.com', 'Driver Delivery', 'driver', '11888888888'
FROM driver_auth
WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE email = 'driver@deliveryapp.com');

-- Create driver profile
INSERT INTO public.drivers (user_id, license_number, vehicle_type, status)
SELECT u.id, '12345678900', 'van', 'active'
FROM public.users u
WHERE u.email = 'driver@deliveryapp.com' 
AND u.role = 'driver'
AND NOT EXISTS (SELECT 1 FROM public.drivers WHERE user_id = u.id);

-- Grant permissions
GRANT SELECT ON public.users TO anon, authenticated;
GRANT SELECT ON public.drivers TO anon, authenticated;

-- Final check
SELECT 'Admin user created:' as message, email, role 
FROM public.users 
WHERE email = 'admin@deliveryapp.com'
UNION ALL
SELECT 'Driver user created:' as message, email, role 
FROM public.users 
WHERE email = 'driver@deliveryapp.com';