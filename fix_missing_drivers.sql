-- Final verification and manual driver record creation if needed
-- This script will help us fix any remaining issues

-- 1. Check current mismatch between driver users and driver records
SELECT 
    'Driver users without driver records' as issue_type,
    COUNT(*) as count
FROM auth.users u 
LEFT JOIN drivers d ON u.id = d.user_id 
WHERE u.role = 'driver' AND d.id IS NULL

UNION ALL

SELECT 
    'Driver records without user references' as issue_type,
    COUNT(*) as count
FROM drivers d
LEFT JOIN auth.users u ON d.user_id = u.id
WHERE u.id IS NULL;

-- 2. List all driver users without corresponding driver records
SELECT 
    u.id as user_id,
    u.email,
    u.raw_user_meta_data->>'name' as name,
    u.created_at
FROM auth.users u 
LEFT JOIN drivers d ON u.id = d.user_id 
WHERE u.role = 'driver' AND d.id IS NULL
ORDER BY u.created_at DESC;

-- 3. Create missing driver records for existing driver users
-- This will fix the immediate issue
INSERT INTO drivers (user_id, active)
SELECT 
    u.id as user_id,
    true as active
FROM auth.users u 
LEFT JOIN drivers d ON u.id = d.user_id 
WHERE u.role = 'driver' AND d.id IS NULL;

-- 4. Verify the fix worked
SELECT 
    'Fixed driver users count' as metric,
    COUNT(*) as value
FROM auth.users u 
WHERE u.role = 'driver'

UNION ALL

SELECT 
    'Fixed driver records count' as metric,
    COUNT(*) as value
FROM drivers d;

-- 5. Final check - should show 0 for both
SELECT 
    'Remaining driver users without records' as check_type,
    COUNT(*) as count
FROM auth.users u 
LEFT JOIN drivers d ON u.id = d.user_id 
WHERE u.role = 'driver' AND d.id IS NULL

UNION ALL

SELECT 
    'Remaining driver records without users' as check_type,
    COUNT(*) as count
FROM drivers d
LEFT JOIN auth.users u ON d.user_id = u.id
WHERE u.id IS NULL;