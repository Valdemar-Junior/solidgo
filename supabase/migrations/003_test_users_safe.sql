-- Insert test users for authentication testing
-- This migration creates admin and driver users with known credentials

-- Check if users already exist and create them with unique IDs
DO $$
DECLARE
    admin_id uuid := gen_random_uuid();
    driver_id uuid := gen_random_uuid();
    admin_exists boolean;
    driver_exists boolean;
BEGIN
    -- Check if admin user exists
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = 'admin@example.com') INTO admin_exists;
    
    -- Check if driver user exists  
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = 'driver@example.com') INTO driver_exists;
    
    -- Create admin user if not exists
    IF NOT admin_exists THEN
        INSERT INTO auth.users (
            id,
            email,
            encrypted_password,
            email_confirmed_at,
            created_at,
            updated_at,
            role
        ) VALUES (
            admin_id,
            'admin@example.com',
            crypt('admin123', gen_salt('bf')),
            NOW(),
            NOW(),
            NOW(),
            'authenticated'
        );
        
        -- Insert admin profile
        INSERT INTO public.users (id, email, name, role, phone) VALUES 
            (admin_id, 'admin@example.com', 'Administrador Teste', 'admin', '11999999999');
    END IF;
    
    -- Create driver user if not exists
    IF NOT driver_exists THEN
        INSERT INTO auth.users (
            id,
            email,
            encrypted_password,
            email_confirmed_at,
            created_at,
            updated_at,
            role
        ) VALUES (
            driver_id,
            'driver@example.com',
            crypt('driver123', gen_salt('bf')),
            NOW(),
            NOW(),
            NOW(),
            'authenticated'
        );
        
        -- Insert driver profile
        INSERT INTO public.users (id, email, name, role, phone) VALUES 
            (driver_id, 'driver@example.com', 'Motorista Teste', 'driver', '11988888888');
            
        -- Insert driver profile
        INSERT INTO public.drivers (user_id, license_number, vehicle_type, status) VALUES 
            (driver_id, '12345678900', 'van', 'active');
    END IF;
END $$;