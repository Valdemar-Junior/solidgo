-- ============================================================================
-- Funde o cadastro de veículo da FROTA (fleet_vehicles) na tabela principal
-- `vehicles`. Fim da última duplicação: o veículo passa a existir em UM lugar só.
-- ----------------------------------------------------------------------------
-- O que faz, em ordem:
--   1) Acrescenta a `vehicles` as colunas operacionais da frota (odômetro, status,
--      chassi, etc.) — aditivo, não mexe no que já existe.
--   2) Traz para `vehicles` os veículos que só existiam na frota (casa por placa).
--   3) Copia os dados operacionais da frota para os veículos que já existiam.
--   4) Reaponta inspeções e ocorrências para o veículo correspondente em `vehicles`.
--   5) Troca as chaves estrangeiras (FK) para `vehicles`.
--   6) Remove a tabela `fleet_vehicles` (os dados já foram migrados; nada é perdido).
-- Placa é casada normalizada (maiúscula, só letras/números) para não duplicar.
-- ============================================================================

-- 1) Colunas operacionais/identidade da frota na tabela principal (aditivo).
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS display_name     text,
  ADD COLUMN IF NOT EXISTS brand            text,
  ADD COLUMN IF NOT EXISTS model_year       integer,
  ADD COLUMN IF NOT EXISTS vehicle_type     text,
  ADD COLUMN IF NOT EXISTS chassis          text,
  ADD COLUMN IF NOT EXISTS current_odometer bigint      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status           text        NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS notes            text,
  ADD COLUMN IF NOT EXISTS created_at       timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT timezone('utc'::text, now());

-- status válido (mesma regra da frota)
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_status_check;
ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_status_check CHECK (status IN ('available', 'maintenance', 'inactive'));

-- 2) Veículos que só existem na frota entram no cadastro principal (por placa normalizada).
INSERT INTO public.vehicles
  (plate, model, active, display_name, brand, model_year, vehicle_type, renavam, chassis, current_odometer, status, notes)
SELECT DISTINCT ON (upper(regexp_replace(fv.plate, '[^A-Za-z0-9]', '', 'g')))
  upper(regexp_replace(fv.plate, '[^A-Za-z0-9]', '', 'g')),
  fv.model, fv.active, fv.display_name, fv.brand, fv.model_year, fv.vehicle_type,
  fv.renavam, fv.chassis, fv.current_odometer, fv.status, fv.notes
FROM public.fleet_vehicles fv
WHERE NOT EXISTS (
  SELECT 1 FROM public.vehicles v
  WHERE upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g'))
      = upper(regexp_replace(fv.plate, '[^A-Za-z0-9]', '', 'g'))
);

-- 3) Copia os dados operacionais para os veículos que já existiam (match por placa).
UPDATE public.vehicles v
SET display_name     = COALESCE(v.display_name, fv.display_name),
    brand            = COALESCE(v.brand, fv.brand),
    model_year       = COALESCE(v.model_year, fv.model_year),
    vehicle_type     = COALESCE(v.vehicle_type, fv.vehicle_type),
    renavam          = COALESCE(v.renavam, fv.renavam),
    chassis          = COALESCE(v.chassis, fv.chassis),
    current_odometer = GREATEST(v.current_odometer, fv.current_odometer),
    status           = fv.status,
    notes            = COALESCE(v.notes, fv.notes)
FROM public.fleet_vehicles fv
WHERE upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g'))
    = upper(regexp_replace(fv.plate, '[^A-Za-z0-9]', '', 'g'));

-- 4) Reaponta inspeções e ocorrências para o veículo principal correspondente.
UPDATE public.fleet_inspections fi
SET vehicle_id = v.id
FROM public.fleet_vehicles fv
JOIN public.vehicles v
  ON upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g'))
   = upper(regexp_replace(fv.plate, '[^A-Za-z0-9]', '', 'g'))
WHERE fi.vehicle_id = fv.id;

UPDATE public.fleet_occurrences fo
SET vehicle_id = v.id
FROM public.fleet_vehicles fv
JOIN public.vehicles v
  ON upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g'))
   = upper(regexp_replace(fv.plate, '[^A-Za-z0-9]', '', 'g'))
WHERE fo.vehicle_id = fv.id;

-- 5) Troca as FKs para apontar para vehicles.
ALTER TABLE public.fleet_inspections DROP CONSTRAINT IF EXISTS fleet_inspections_vehicle_id_fkey;
ALTER TABLE public.fleet_inspections
  ADD CONSTRAINT fleet_inspections_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT;

ALTER TABLE public.fleet_occurrences DROP CONSTRAINT IF EXISTS fleet_occurrences_vehicle_id_fkey;
ALTER TABLE public.fleet_occurrences
  ADD CONSTRAINT fleet_occurrences_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT;

-- 6) Remove a tabela antiga (dados já migrados para vehicles).
DROP TABLE IF EXISTS public.fleet_vehicles;
