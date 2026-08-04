-- ============================================================
-- Corrige fotos de entrega duplicadas pelo reenvio do mesmo lote
-- ============================================================
-- O botão de confirmar entrega permanecia clicável durante o upload, e cada toque
-- extra disparava uma execução paralela que regravava o lote inteiro. Como o
-- file_name é gerado uma única vez na captura (timestamp + random), linhas com o
-- mesmo (route_order_id, file_name) são a mesma foto gravada mais de uma vez.
--
-- IMPORTANTE: rode antes scripts/cleanup-duplicate-delivery-photos.mjs --apply,
-- que remove também os arquivos correspondentes no Storage. O passo 1 abaixo é
-- defensivo: se o script já rodou, não encontra nada para apagar.

-- 1. Mantém a linha mais antiga de cada grupo e apaga as demais
with ranked as (
  select
    id,
    row_number() over (
      partition by route_order_id, file_name
      order by created_at, id
    ) as rn
  from public.delivery_photos
  where file_name is not null
)
delete from public.delivery_photos dp
using ranked r
where dp.id = r.id
  and r.rn > 1;

-- 2. Recalcula photo_count e photo_refs dos comprovantes afetados.
--    Comprovantes sem nenhuma foto registrada ficam intocados: um photo_count > 0
--    sem linhas correspondentes indica foto presa no armazenamento offline, que é
--    outro problema e não deve ser apagado aqui.
with agg as (
  select
    route_order_id,
    count(*) as total,
    jsonb_agg(
      jsonb_build_object('id', id, 'path', storage_path, 'type', photo_type)
      order by created_at
    ) as refs
  from public.delivery_photos
  group by route_order_id
)
update public.delivery_receipts dr
set
  photo_count = agg.total,
  photo_refs = agg.refs,
  updated_at = timezone('utc', now())
from agg
where dr.route_order_id = agg.route_order_id
  and (
    dr.photo_count is distinct from agg.total
    or dr.photo_refs is distinct from agg.refs
  );

-- 3. Impede a reincidência no banco, independente do cliente.
--    Índice parcial: file_name nulo (dado legado) não participa da restrição.
create unique index if not exists uq_delivery_photos_route_order_file_name
  on public.delivery_photos (route_order_id, file_name)
  where file_name is not null;

comment on index public.uq_delivery_photos_route_order_file_name is
  'Impede gravar a mesma foto (mesmo file_name) duas vezes no mesmo route_order.';
