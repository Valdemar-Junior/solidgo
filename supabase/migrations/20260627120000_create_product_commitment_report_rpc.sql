CREATE OR REPLACE FUNCTION public.get_product_commitment_report(
  p_search text DEFAULT NULL,
  p_sale_start date DEFAULT NULL,
  p_sale_end date DEFAULT NULL,
  p_situations text[] DEFAULT ARRAY['reserved']::text[],
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_search text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_page integer := GREATEST(COALESCE(p_page, 0), 0);
  v_page_size integer := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);
BEGIN
  IF p_sale_start IS NOT NULL AND p_sale_end IS NOT NULL AND p_sale_start > p_sale_end THEN
    RAISE EXCEPTION 'Periodo de venda invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.users u
     WHERE u.id = auth.uid()
       AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Acesso permitido apenas para administradores';
  END IF;

  WITH expanded AS (
    SELECT
      o.id AS order_id,
      o.order_id_erp,
      o.customer_name,
      o.phone,
      o.data_venda AS sale_date,
      o.previsao_entrega AS forecast_date,
      o.filial_venda AS branch,
      o.vendedor_nome AS seller_name,
      o.address_json->>'city' AS city,
      o.address_json->>'neighborhood' AS neighborhood,
      COALESCE(
        NULLIF(trim(item.value->>'sku'), ''),
        NULLIF(trim(item.value->>'codigo'), ''),
        NULLIF(trim(item.value->>'codigo_produto'), ''),
        'SKU-INDEF'
      ) AS product_sku,
      COALESCE(
        NULLIF(trim(item.value->>'name'), ''),
        NULLIF(trim(item.value->>'produto'), ''),
        NULLIF(trim(item.value->>'descricao'), ''),
        NULLIF(trim(item.value->>'nome_produto'), ''),
        'Produto sem nome'
      ) AS product_name,
      CASE
        WHEN COALESCE(item.value->>'purchased_quantity', '') ~ '^\d+([.,]\d+)?$'
          THEN replace(item.value->>'purchased_quantity', ',', '.')::numeric
        WHEN COALESCE(item.value->>'quantidade_comprada', '') ~ '^\d+([.,]\d+)?$'
          THEN replace(item.value->>'quantidade_comprada', ',', '.')::numeric
        WHEN COALESCE(item.value->>'quantity', '') ~ '^\d+([.,]\d+)?$'
          THEN replace(item.value->>'quantity', ',', '.')::numeric
        ELSE 1::numeric
      END AS purchased_quantity,
      CASE
        WHEN COALESCE(item.value->>'unit_price_real', '') ~ '^\d+([.,]\d+)?$'
          THEN replace(item.value->>'unit_price_real', ',', '.')::numeric
        WHEN COALESCE(item.value->>'unit_price', '') ~ '^\d+([.,]\d+)?$'
          THEN replace(item.value->>'unit_price', ',', '.')::numeric
        ELSE NULL::numeric
      END AS unit_price,
      CASE
        WHEN o.status = 'delivered' THEN 'delivered'
        WHEN latest_route.route_status = 'pending' THEN 'separating'
        WHEN latest_route.route_status = 'in_progress'
          AND COALESCE(latest_route.route_order_status, 'pending') = 'pending' THEN 'in_route'
        ELSE 'awaiting_route'
      END AS report_status,
      latest_route.route_id,
      latest_route.route_code,
      latest_route.route_name,
      latest_route.route_status,
      latest_route.driver_name,
      latest_route.delivered_at
    FROM public.orders o
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.items_json, '[]'::jsonb)) AS item(value)
    LEFT JOIN LATERAL (
      SELECT
        r.id AS route_id,
        r.route_code,
        r.name AS route_name,
        r.status AS route_status,
        ro.status AS route_order_status,
        ro.delivered_at,
        du.name AS driver_name
      FROM public.route_orders ro
      JOIN public.routes r ON r.id = ro.route_id
      LEFT JOIN public.drivers d ON d.id = r.driver_id
      LEFT JOIN public.users du ON du.id = d.user_id
      WHERE ro.order_id = o.id
      ORDER BY
        CASE
          WHEN o.status = 'delivered' AND ro.status = 'delivered' THEN 0
          WHEN r.status = 'in_progress' THEN 1
          WHEN r.status = 'pending' THEN 2
          ELSE 3
        END,
        COALESCE(ro.delivered_at, r.completed_at, r.updated_at, r.created_at) DESC
      LIMIT 1
    ) AS latest_route ON true
    WHERE o.status IN ('pending', 'imported', 'assigned', 'delivered')
      AND COALESCE(o.return_flag, false) = false
      AND COALESCE(o.requires_pickup, false) = false
      AND (p_sale_start IS NULL OR o.data_venda::date >= p_sale_start)
      AND (p_sale_end IS NULL OR o.data_venda::date <= p_sale_end)
  ), filtered AS (
    SELECT *
      FROM expanded e
     WHERE (
       v_search IS NULL
       OR e.product_name ILIKE '%' || v_search || '%'
       OR e.product_sku ILIKE '%' || v_search || '%'
     )
       AND (
         p_situations IS NULL
         OR cardinality(p_situations) = 0
         OR ('reserved' = ANY(p_situations) AND e.report_status <> 'delivered')
         OR ('delivered' = ANY(p_situations) AND e.report_status = 'delivered')
       )
  ), summary AS (
    SELECT
      COALESCE(sum(purchased_quantity) FILTER (WHERE report_status <> 'delivered'), 0) AS reserved_units,
      COALESCE(sum(purchased_quantity) FILTER (WHERE report_status = 'delivered'), 0) AS delivered_units,
      COALESCE(sum(purchased_quantity) FILTER (WHERE report_status = 'awaiting_route'), 0) AS awaiting_route_units,
      COALESCE(sum(purchased_quantity) FILTER (WHERE report_status = 'separating'), 0) AS separating_units,
      COALESCE(sum(purchased_quantity) FILTER (WHERE report_status = 'in_route'), 0) AS in_route_units,
      count(*) AS total_records,
      count(DISTINCT (product_sku, product_name)) AS distinct_products
    FROM filtered
  ), page_rows AS (
    SELECT
      filtered.*,
      sum(purchased_quantity) FILTER (WHERE report_status <> 'delivered') OVER (PARTITION BY product_sku, product_name) AS product_reserved_units,
      sum(purchased_quantity) FILTER (WHERE report_status = 'delivered') OVER (PARTITION BY product_sku, product_name) AS product_delivered_units
      FROM filtered
     ORDER BY product_name, product_sku, sale_date DESC NULLS LAST, order_id_erp
     LIMIT v_page_size
    OFFSET v_page * v_page_size
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM page_rows p), '[]'::jsonb),
    'summary', jsonb_build_object(
      'reserved_units', s.reserved_units,
      'delivered_units', s.delivered_units,
      'awaiting_route_units', s.awaiting_route_units,
      'separating_units', s.separating_units,
      'in_route_units', s.in_route_units,
      'total_records', s.total_records,
      'distinct_products', s.distinct_products,
      'page', v_page,
      'page_size', v_page_size
    )
  )
  INTO v_result
  FROM summary s;

  RETURN COALESCE(
    v_result,
    jsonb_build_object(
      'rows', '[]'::jsonb,
      'summary', jsonb_build_object(
        'reserved_units', 0,
        'delivered_units', 0,
        'awaiting_route_units', 0,
        'separating_units', 0,
        'in_route_units', 0,
        'total_records', 0,
        'distinct_products', 0,
        'page', v_page,
        'page_size', v_page_size
      )
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_product_commitment_report(text, date, date, text[], integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_commitment_report(text, date, date, text[], integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_product_commitment_report(text, date, date, text[], integer, integer)
IS 'Relatorio paginado de unidades compradas reservadas ou entregues, expandido no banco para reduzir egress.';

CREATE INDEX IF NOT EXISTS idx_orders_product_commitment_status_sale
ON public.orders (status, data_venda)
WHERE COALESCE(return_flag, false) = false;

NOTIFY pgrst, 'reload schema';
