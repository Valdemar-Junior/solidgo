-- Add assembler_id and vehicle_id to assembly_routes
ALTER TABLE public.assembly_routes
  ADD COLUMN IF NOT EXISTS assembler_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL;

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_assembly_routes_assembler ON public.assembly_routes(assembler_id);
CREATE INDEX IF NOT EXISTS idx_assembly_routes_vehicle ON public.assembly_routes(vehicle_id);

-- RLS: existing policies allow admin to update; no changes required here.
