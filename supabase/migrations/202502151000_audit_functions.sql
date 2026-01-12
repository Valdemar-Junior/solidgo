-- Function to find duplicate orders by ERP ID (Orders Table Duplicates)
CREATE OR REPLACE FUNCTION get_duplicate_orders()
RETURNS TABLE (
    order_id_erp text,
    count bigint,
    ids uuid[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.order_id_erp, 
        COUNT(*) as count,
        ARRAY_AGG(o.id) as ids
    FROM orders o
    GROUP BY o.order_id_erp
    HAVING COUNT(*) > 1;
END;
$$ LANGUAGE plpgsql;

-- Function to find orders that are in multiple active routes (Route Orders Duplicates)
CREATE OR REPLACE FUNCTION get_route_duplicates()
RETURNS TABLE (
    order_id uuid,
    route_count bigint,
    route_ids uuid[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ro.order_id,
        COUNT(*) as route_count,
        ARRAY_AGG(ro.route_id) as route_ids
    FROM route_orders ro
    JOIN routes r ON ro.route_id = r.id
    WHERE r.status NOT IN ('completed', 'cancelled') -- Only verify active routes
    GROUP BY ro.order_id
    HAVING COUNT(*) > 1;
END;
$$ LANGUAGE plpgsql;

-- Function to find delivered orders with assembly but missing assembly_products (Black Hole)
CREATE OR REPLACE FUNCTION get_missing_assembly_orders()
RETURNS SETOF orders AS $$
BEGIN
    RETURN QUERY
    SELECT o.*
    FROM orders o
    LEFT JOIN assembly_products ap ON o.id = ap.order_id
    WHERE o.status = 'delivered' 
      AND o.has_assembly = true
      AND ap.id IS NULL; -- Missing in assembly_products
END;
$$ LANGUAGE plpgsql;
