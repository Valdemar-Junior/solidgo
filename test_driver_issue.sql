-- Test script to verify driver creation issue
-- Run these queries to understand the current state

-- 1. Check if there are any users with driver role
SELECT COUNT(*) as total_driver_users
FROM auth.users 
WHERE role = 'driver';

-- 2. Check if there are corresponding driver records
SELECT COUNT(*) as total_driver_records
FROM drivers;

-- 3. Find driver users without driver records
SELECT 
    u.id as user_id,
    u.email,
    u.raw_user_meta_data->>'name' as name,
    u.created_at
FROM auth.users u 
LEFT JOIN drivers d ON u.id = d.user_id 
WHERE u.role = 'driver' AND d.id IS NULL;

-- 4. Check the most recent driver user created
SELECT 
    u.id,
    u.email,
    u.role,
    u.created_at,
    u.raw_user_meta_data->>'name' as name
FROM auth.users u 
WHERE u.role = 'driver' 
ORDER BY u.created_at DESC 
LIMIT 3;

-- 5. Check permissions on drivers table
SELECT grantee, table_name, privilege_type 
FROM information_schema.role_table_grants 
WHERE table_schema = 'public' 
AND table_name = 'drivers' 
AND grantee IN ('anon', 'authenticated')
ORDER BY grantee;