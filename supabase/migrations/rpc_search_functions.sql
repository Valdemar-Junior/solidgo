-- Function to search delivery candidates (Orders)
CREATE OR REPLACE FUNCTION search_delivery_candidates(
  p_search_term text DEFAULT NULL,
  p_status_filter text[] DEFAULT NULL,
  p_city_filter text[] DEFAULT NULL,
  p_neighborhood_filter text[] DEFAULT NULL,
  p_date_start text DEFAULT NULL,
  p_date_end text DEFAULT NULL,
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  order_id_erp text,
  customer_name text,
  phone text,
  address_json jsonb,
  items_json jsonb,
  status text,
  raw_json jsonb,
  return_flag boolean,
  last_return_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
) AS $$
DECLARE
  v_search_pattern text;
  v_today_start text;
  v_offset integer;
BEGIN
  v_offset := p_page * p_page_size;
  
  IF p_search_term IS NOT NULL AND p_search_term != '' THEN
    v_search_pattern := '%' || p_search_term || '%';
  END IF;

  RETURN QUERY
  WITH filtered_orders AS (
    SELECT 
      o.id,
      o.order_id_erp,
      o.customer_name,
      o.phone,
      o.address_json,
      o.items_json,
      o.status::text,
      o.raw_json,
      o.return_flag,
      o.last_return_reason,
      o.created_at,
      o.updated_at
    FROM orders o
    WHERE 
      -- Basic Status Filter (Pending/Returned/Assigned)
      (
        p_status_filter IS NULL 
        OR 
        o.status::text = ANY(p_status_filter)
      )
      -- Exclude blocked orders
      AND o.blocked_at IS NULL
      
      -- Search Term Filter
      AND (
        v_search_pattern IS NULL 
        OR 
        o.customer_name ILIKE v_search_pattern 
        OR 
        o.order_id_erp ILIKE v_search_pattern 
        OR 
        (o.address_json->>'city')::text ILIKE v_search_pattern 
        OR 
        (o.address_json->>'neighborhood')::text ILIKE v_search_pattern
      )
      
      -- City Filter
      AND (
        p_city_filter IS NULL 
        OR 
        (o.address_json->>'city')::text = ANY(p_city_filter)
      )
      
      -- Neighborhood Filter
      AND (
        p_neighborhood_filter IS NULL 
        OR 
        (o.address_json->>'neighborhood')::text = ANY(p_neighborhood_filter)
      )
      
      -- Date Range Filter (Created At or Sale Date?)
      -- Usually Delivery checks Created At or Data Venda. Let's assume Created At for backlog.
      AND (
        p_date_start IS NULL 
        OR 
        o.created_at >= p_date_start::timestamptz
      )
      AND (
        p_date_end IS NULL 
        OR 
        o.created_at <= p_date_end::timestamptz
      )
  )
  SELECT 
    f.*,
    (SELECT count(*) FROM filtered_orders)::bigint as total_count
  FROM filtered_orders f
  ORDER BY f.created_at DESC
  LIMIT p_page_size
  OFFSET v_offset;
END;
$$ LANGUAGE plpgsql;

-- Function to search assembly candidates (Assembly Products)
CREATE OR REPLACE FUNCTION search_assembly_candidates(
  p_search_term text DEFAULT NULL,
  p_city_filter text[] DEFAULT NULL,
  p_neighborhood_filter text[] DEFAULT NULL,
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  order_id uuid,
  product_name text,
  product_sku text,
  status text,
  assembly_route_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  was_returned boolean,
  observations text,
  returned_at timestamptz,
  order_data jsonb, -- Return full joined order data
  total_count bigint
) AS $$
DECLARE
  v_search_pattern text;
  v_offset integer;
BEGIN
  v_offset := p_page * p_page_size;
  
  IF p_search_term IS NOT NULL AND p_search_term != '' THEN
    v_search_pattern := '%' || p_search_term || '%';
  END IF;

  RETURN QUERY
  WITH filtered_assembly AS (
    SELECT 
      ap.id,
      ap.order_id,
      ap.product_name,
      ap.product_sku,
      ap.status::text,
      ap.assembly_route_id,
      ap.created_at,
      ap.updated_at,
      ap.was_returned,
      ap.observations,
      ap.returned_at,
      to_jsonb(o) as order_data
    FROM assembly_products ap
    JOIN orders o ON ap.order_id = o.id
    WHERE 
      -- Pending only
      ap.assembly_route_id IS NULL
      AND ap.status = 'pending'
      
      -- Search Term (Checks Order and Product fields)
      AND (
        v_search_pattern IS NULL 
        OR 
        o.customer_name ILIKE v_search_pattern 
        OR 
        o.order_id_erp ILIKE v_search_pattern 
        OR 
        ap.product_name ILIKE v_search_pattern
        OR
        ap.product_sku ILIKE v_search_pattern
      )
      
      -- City Filter (on Order)
      AND (
        p_city_filter IS NULL 
        OR 
        (o.address_json->>'city')::text = ANY(p_city_filter)
      )
      
      -- Neighborhood Filter (on Order)
      AND (
        p_neighborhood_filter IS NULL 
        OR 
        (o.address_json->>'neighborhood')::text = ANY(p_neighborhood_filter)
      )
  )
  SELECT 
    f.id,
    f.order_id,
    f.product_name,
    f.product_sku,
    f.status,
    f.assembly_route_id,
    f.created_at,
    f.updated_at,
    f.was_returned,
    f.observations,
    f.returned_at,
    f.order_data,
    (SELECT count(*) FROM filtered_assembly)::bigint as total_count
  FROM filtered_assembly f
  ORDER BY f.created_at DESC
  LIMIT p_page_size
  OFFSET v_offset;
END;
$$ LANGUAGE plpgsql;
