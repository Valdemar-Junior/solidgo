-- Comprehensive test for driver creation workflow
-- This script tests the complete driver creation process

-- 1. Check current state before test
SELECT '=== BEFORE TEST ===' as step;

-- Count driver users and driver records
SELECT 
    (SELECT COUNT(*) FROM auth.users WHERE role = 'driver') as driver_users_count,
    (SELECT COUNT(*) FROM drivers) as driver_records_count;

-- Find any orphaned driver users (users with driver role but no driver record)
SELECT 
    u.id as user_id,
    u.email,
    u.raw_user_meta_data->>'name' as name,
    u.created_at
FROM auth.users u 
LEFT JOIN drivers d ON u.id = d.user_id 
WHERE u.role = 'driver' AND d.id IS NULL;

-- 2. Test the driver creation process
SELECT '=== TESTING DRIVER CREATION ===' as step;

-- Simulate what should happen when a driver user is created:
-- Step 1: User is created in auth.users with role='driver'
-- Step 2: Driver record should be created in drivers table

-- Let's check if there are any recent driver users created
SELECT 
    u.id,
    u.email,
    u.role,
    u.created_at,
    u.raw_user_meta_data->>'name' as name
FROM auth.users u 
WHERE u.role = 'driver' 
ORDER BY u.created_at DESC 
LIMIT 5;

-- Verify driver records exist for these users
SELECT '=== VERIFYING DRIVER RECORDS ===' as step;

SELECT 
    d.id as driver_id,
    d.user_id,
    d.active,
    u.email as user_email,
    u.raw_user_meta_data->>'name' as user_name
FROM drivers d
JOIN auth.users u ON d.user_id = u.id
ORDER BY u.created_at DESC 
LIMIT 5;

-- 4. Check for any issues
SELECT '=== CHECKING FOR ISSUES ===' as step;

-- Check for duplicate driver records
SELECT 
    user_id,
    COUNT(*) as count,
    array_agg(id) as driver_ids
FROM drivers 
GROUP BY user_id 
HAVING COUNT(*) > 1;

-- Check for driver records with missing user references
SELECT 
    d.id as driver_id,
    d.user_id,
    d.active
FROM drivers d
LEFT JOIN auth.users u ON d.user_id = u.id
WHERE u.id IS NULL;

-- 5. Final verification
SELECT '=== FINAL VERIFICATION ===' as step;

-- Count total driver users vs driver records
SELECT 
    'Driver Users' as type,
    COUNT(*) as count
FROM auth.users 
WHERE role = 'driver'
UNION ALL
SELECT 
    'Driver Records' as type,
    COUNT(*) as count
FROM drivers;