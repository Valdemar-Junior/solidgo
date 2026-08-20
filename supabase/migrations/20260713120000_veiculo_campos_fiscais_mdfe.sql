-- ============================================================================
-- Unifica o cadastro de VEÍCULO: acrescenta os campos fiscais do MDF-e à tabela
-- principal `vehicles`, para que o veículo seja cadastrado só em "Cadastros e
-- Equipes" e o MDF-e reaproveite esses dados (fim da digitação duplicada).
-- ----------------------------------------------------------------------------
-- Migration ADITIVA e segura: apenas ACRESCENTA colunas, todas OPCIONAIS (nullable).
-- Não altera, converte nem remove nada existente — nada que já roda quebra.
-- Só os veículos com esses campos preenchidos ficam disponíveis para emitir MDF-e.
-- ============================================================================

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS renavam      text,
  ADD COLUMN IF NOT EXISTS tara_kg      integer,
  ADD COLUMN IF NOT EXISTS capacity_kg  integer,
  ADD COLUMN IF NOT EXISTS capacity_m3  integer,
  ADD COLUMN IF NOT EXISTS body_type    text,   -- código carroceria (00-05)
  ADD COLUMN IF NOT EXISTS rodado_type  text,   -- código rodado (01-06)
  ADD COLUMN IF NOT EXISTS licensing_uf text;   -- UF de licenciamento (2 letras)
