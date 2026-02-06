-- Create delivery_photos table
CREATE TABLE IF NOT EXISTS public.delivery_photos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    route_order_id UUID NOT NULL REFERENCES public.route_orders(id) ON DELETE CASCADE,
    photo_type TEXT NOT NULL DEFAULT 'general', -- 'product', 'receipt', 'return_reason', 'general'
    storage_path TEXT NOT NULL,
    file_name TEXT,
    file_size INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_by UUID REFERENCES auth.users(id),
    is_synced BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE public.delivery_photos ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view all delivery photos" ON public.delivery_photos
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert delivery photos" ON public.delivery_photos
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update their own delivery photos" ON public.delivery_photos
    FOR UPDATE USING (auth.uid() = created_by);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_delivery_photos_route_order_id ON public.delivery_photos(route_order_id);

-- Storage bucket configuration (Note: Buckets strictly should be created via API/UI, 
-- but we insert into storage.buckets if permissions allow, as a fallback/init script)
INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-photos', 'delivery-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies for delivery-photos
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING ( bucket_id = 'delivery-photos' );

CREATE POLICY "Authenticated users can upload"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'delivery-photos' AND auth.role() = 'authenticated' );

CREATE POLICY "Users can update own photos"
ON storage.objects FOR UPDATE
USING ( bucket_id = 'delivery-photos' AND auth.uid() = owner );
