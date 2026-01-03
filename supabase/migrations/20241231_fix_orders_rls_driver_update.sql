-- Allow drivers to update order status to 'delivered' and reset return flags
DROP POLICY IF EXISTS "orders_update_driver_delivered" ON "orders";

CREATE POLICY "orders_update_driver_delivered" ON "orders"
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM route_orders ro
    JOIN routes r ON ro.route_id = r.id
    LEFT JOIN drivers d ON r.driver_id = d.id
    WHERE ro.order_id = orders.id
    AND (
      -- Case 1: Driver user matching the route driver
      d.user_id = auth.uid()
      OR
      -- Case 2: User is part of the 'team' assigned to the route
      EXISTS (
        SELECT 1 FROM teams_user tu
        WHERE tu.id = r.team_id
        AND (tu.driver_user_id = auth.uid() OR tu.helper_user_id = auth.uid())
      )
      OR
      -- Case 3: Admin fallback (though admins usually have bypass)
      EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = auth.uid() AND u.role = 'admin'
      )
    )
  )
)
WITH CHECK (
  status = 'delivered' OR status = 'assigned' OR status = 'pending'
);
