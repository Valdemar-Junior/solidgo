-- Add RLS policies for drivers table if they don't exist
-- These policies ensure that authenticated users can read and insert driver records

-- Check if RLS is enabled
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'drivers';

-- If RLS is enabled, check existing policies
SELECT 
    policyname,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename = 'drivers';

-- Add basic RLS policies for drivers table
-- Allow authenticated users to read all driver records
CREATE POLICY "Allow authenticated users to read drivers" ON drivers
    FOR SELECT
    TO authenticated
    USING (true);

-- Allow authenticated users to insert driver records
CREATE POLICY "Allow authenticated users to insert drivers" ON drivers
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Allow users to update their own driver record or admin to update any
CREATE POLICY "Allow users to update drivers" ON drivers
    FOR UPDATE
    TO authenticated
    USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Grant necessary permissions
GRANT SELECT ON drivers TO authenticated;
GRANT INSERT ON drivers TO authenticated;
GRANT UPDATE ON drivers TO authenticated;
GRANT DELETE ON drivers TO authenticated;