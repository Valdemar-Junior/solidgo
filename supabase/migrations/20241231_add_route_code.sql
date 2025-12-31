-- Add route_code column to routes table
-- Format: RE-DDMM-XXX (delivery) or RM-DDMM-XXX (assembly)
-- Example: RE-3112-001 = First delivery route of December 31st

ALTER TABLE public.routes
ADD COLUMN IF NOT EXISTS route_code VARCHAR(15);

-- Add unique constraint
ALTER TABLE public.routes
ADD CONSTRAINT routes_route_code_unique UNIQUE (route_code);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_routes_route_code ON public.routes(route_code);

-- Comment for documentation
COMMENT ON COLUMN public.routes.route_code IS 'Unique route code in format RE-DDMM-XXX (delivery) or RM-DDMM-XXX (assembly). XXX is sequential per day.';
