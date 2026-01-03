-- RESTORING STRICT DRIVER-ONLY ACCESS
-- This removes the 'team members' (helper) access added previously, honoring the user's request.

DROP POLICY IF EXISTS "orders_update_driver_delivered" ON "orders";

CREATE POLICY "orders_update_driver_delivered" ON "orders"
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM route_orders ro
    JOIN routes r ON ro.route_id = r.id
    JOIN drivers d ON r.driver_id = d.id
    WHERE ro.order_id = orders.id
    AND d.user_id = auth.uid() -- STRICT: Only the user linked to the driver assigned to this route
  )
)
WITH CHECK (
  -- Expanded allowed statuses slightly to ensure they can fix/undo, but access is restricted to the driver.
  status = 'delivered' OR status = 'assigned' OR status = 'pending'
);
