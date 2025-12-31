-- Add route_code column to assembly_routes table
-- Format: RM-DDMMYY-XXX (assembly routes)
-- Example: RM-311225-001 = First assembly route of December 31st, 2025

ALTER TABLE public.assembly_routes
ADD COLUMN IF NOT EXISTS route_code VARCHAR(15);

-- Add unique constraint
ALTER TABLE public.assembly_routes
ADD CONSTRAINT assembly_routes_route_code_unique UNIQUE (route_code);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_assembly_routes_route_code ON public.assembly_routes(route_code);

-- Comment for documentation
COMMENT ON COLUMN public.assembly_routes.route_code IS 'Unique route code in format RM-DDMMYY-XXX for assembly routes. XXX is sequential per day.';
