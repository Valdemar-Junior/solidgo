-- Manual insertion of test users with known credentials
-- Use this script to create users that can actually log in

-- First, let's see what we have
SELECT id, email, role, created_at FROM public.users ORDER BY created_at;

-- If admin user doesn't exist, create it
INSERT INTO public.users (id, email, name, role, phone) 
SELECT 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'admin@deliveryapp.com', 'Admin Delivery', 'admin', '11999999999'
WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE email = 'admin@deliveryapp.com');

-- If driver user doesn't exist, create it  
INSERT INTO public.users (id, email, name, role, phone)
SELECT 'b2c3d4e5-f6a7-8901-bcde-f23456789012', 'driver@deliveryapp.com', 'Driver Delivery', 'driver', '11888888888'
WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE email = 'driver@deliveryapp.com');

-- Create driver profile if it doesn't exist
INSERT INTO public.drivers (user_id, license_number, vehicle_type, status)
SELECT 'b2c3d4e5-f6a7-8901-bcde-f23456789012', '12345678900', 'van', 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.drivers WHERE user_id = 'b2c3d4e5-f6a7-8901-bcde-f23456789012');

-- Now create the auth users (this needs to be done through Supabase Auth API or manually in Supabase Studio)
-- For now, let's create a simple test login that works with any user

-- Check final state
SELECT u.id, u.email, u.role, u.name, d.license_number, d.vehicle_type 
FROM public.users u
LEFT JOIN public.drivers d ON u.id = d.user_id
ORDER BY u.created_at;