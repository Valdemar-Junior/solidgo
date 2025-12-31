-- Add route_code column to assembly_routes table ONLY
-- (routes table already has this column)

ALTER TABLE public.assembly_routes
ADD COLUMN IF NOT EXISTS route_code VARCHAR(15);

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assembly_routes_route_code_unique') THEN
        ALTER TABLE public.assembly_routes
        ADD CONSTRAINT assembly_routes_route_code_unique UNIQUE (route_code);
    END IF;
END $$;

-- Create index if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_assembly_routes_route_code ON public.assembly_routes(route_code);

-- Comment
COMMENT ON COLUMN public.assembly_routes.route_code IS 'Unique route code in format RM-DDMMYY-XXX for assembly routes.';
