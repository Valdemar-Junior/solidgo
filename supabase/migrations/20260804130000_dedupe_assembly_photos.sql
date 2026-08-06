-- ============================================================
-- Corrige fotos de montagem duplicadas pelo reenvio do mesmo lote
-- ============================================================
-- Mesma causa da correção de entrega (20260804120000): o botão de confirmar
-- permanecia clicável durante o upload, e cada toque extra disparava uma execução
-- paralela que regravava o lote inteiro. Como o file_name é gerado uma única vez na
-- captura (timestamp + random), linhas com o mesmo (assembly_product_id, file_name)
-- são a mesma foto gravada mais de uma vez.
--
-- A mesma foto ligada a assembly_products diferentes é legítima: o montador pode
-- confirmar vários itens de uma vez com uma foto só. Por isso o agrupamento inclui
-- o assembly_product_id.
--
-- IMPORTANTE: rode antes scripts/cleanup-duplicate-photos.mjs --target=montagem --apply,
-- que remove também os arquivos correspondentes no Storage. O passo 1 abaixo é
-- defensivo: se o script já rodou, não encontra nada para apagar.

-- 1. Mantém a linha mais antiga de cada grupo e apaga as demais
with ranked as (
  select
    id,
    row_number() over (
      partition by assembly_product_id, file_name
      order by created_at, id
    ) as rn
  from public.assembly_photos
  where file_name is not null
)
delete from public.assembly_photos ap
using ranked r
where ap.id = r.id
  and r.rn > 1;

-- 2. Impede a reincidência no banco, independente do cliente.
--    Índice parcial: file_name nulo (dado legado) não participa da restrição.
create unique index if not exists uq_assembly_photos_product_file_name
  on public.assembly_photos (assembly_product_id, file_name)
  where file_name is not null;

comment on index public.uq_assembly_photos_product_file_name is
  'Impede gravar a mesma foto (mesmo file_name) duas vezes no mesmo assembly_product.';
