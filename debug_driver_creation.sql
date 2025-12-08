-- Diagnostic queries for driver creation issue investigation

-- 1. Check all users with driver role
SELECT 
    u.id,
    u.email,
    u.role,
    u.created_at,
    u.raw_user_meta_data->>'name' as name,
    u.raw_user_meta_data->>'phone' as phone
FROM auth.users u 
WHERE u.role = 'driver' 
ORDER BY u.created_at DESC;

-- 2. Check if corresponding driver records exist in drivers table
SELECT 
    d.id,
    d.user_id,
    d.cpf,
    d.vehicle_id,
    d.active,
    u.email as user_email,
    u.created_at as user_created_at
FROM drivers d
JOIN auth.users u ON d.user_id = u.id
ORDER BY u.created_at DESC;

-- 3. Find driver users without corresponding driver records
SELECT 
    u.id as user_id,
    u.email,
    u.raw_user_meta_data->>'name' as name,
    u.raw_user_meta_data->>'phone' as phone,
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
    u.raw_user_meta_data->>'name' as name,
    u.raw_user_meta_data->>'phone' as phone
FROM auth.users u 
WHERE u.role = 'driver' 
ORDER BY u.created_at DESC 
LIMIT 5;

-- 5. Check if there are any driver records with NULL user_id
SELECT 
    d.id,
    d.user_id,
    d.cpf,
    d.vehicle_id,
    d.active
FROM drivers d
WHERE d.user_id IS NULL;

-- 6. Check for duplicate driver records
SELECT 
    user_id,
    COUNT(*) as count,
    array_agg(id) as driver_ids
FROM drivers 
GROUP BY user_id 
HAVING COUNT(*) > 1;