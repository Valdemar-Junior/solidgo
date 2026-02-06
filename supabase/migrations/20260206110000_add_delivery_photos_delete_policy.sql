-- ============================================
-- FIX: Add DELETE policies for delivery photos
-- ============================================
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)

-- 1. DELETE policy for storage bucket (allows deleting files)
CREATE POLICY "Authenticated users can delete"
ON storage.objects FOR DELETE
USING ( bucket_id = 'delivery-photos' AND auth.role() = 'authenticated' );

-- 2. DELETE policy for delivery_photos table (allows deleting records)
CREATE POLICY "Users can delete delivery photos" ON public.delivery_photos
    FOR DELETE USING (auth.role() = 'authenticated');
