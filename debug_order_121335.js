const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://fjbqpmpvnfczbjzkgbjr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqYnFwbXB2bmZjemJqemtnYmpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwNzAzODIsImV4cCI6MjA3ODY0NjM4Mn0.ylBHuMWJXeQPHH96d_R4wiDeuKggYifBV22ql8oUrHQ';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkOrder() {
    const orderId = '121335';
    console.log(`Searching for order ${orderId}...`);

    // 1. Find Order
    // First try direct ID matches
    let { data: orders, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .or(`order_id_erp.eq.${orderId},id.eq.${orderId}`);

    if (startFromEmpty(orders)) {
        // If empty, try searching specifically
        // This handles if orderId is just part of the json
    }

    if (orderError) {
        console.error('Error fetching order:', orderError);
        return;
    }

    // If not found, try to search all orders and filter manually (inefficient but safe for single check)
    // or assume the user provided ID is correct ERP ID

    if (!orders || orders.length === 0) {
        console.log('Primary search empty. Trying raw_json filter...');
        // Note: complex filter might fail RLS or syntax if not supported
        // skipping for now
    }

    if (!orders || orders.length === 0) {
        console.log('Order not found by ID or ERP ID.');
        return;
    }

    console.log(`Found ${orders.length} orders.`);
    const order = orders[0];
    console.log('Order Details:', {
        id: order.id,
        order_id_erp: order.order_id_erp,
        customer: order.customer_name,
        status: order.status,
        created_at: order.created_at
    });

    // 2. Find Route Orders
    const { data: routeOrders, error: roError } = await supabase
        .from('route_orders')
        .select('*, routes(*)')
        .eq('order_id', order.id);

    if (roError) {
        console.error('Error fetching route_orders:', roError);
        return;
    }

    console.log(`Found ${routeOrders.length} route associations.`);

    routeOrders.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    routeOrders.forEach((ro, index) => {
        console.log(`\nRoute Association #${index + 1}:`);
        console.log(`- Link ID: ${ro.id}`);
        console.log(`- Created At: ${ro.created_at}`);
        console.log(`- Status in Route: ${ro.status}`);
        console.log(`- Order Status snapshot: ${ro.order_status}`);
        console.log(`- Route ID: ${ro.route_id}`);
        if (ro.routes) {
            console.log(`- Route Name: ${ro.routes.name}`);
            console.log(`- Route Status: ${ro.routes.status}`);
            console.log(`- Driver ID: ${ro.routes.driver_id}`);
            console.log(`- Date: ${ro.routes.date}`);
        } else {
            console.log(`- Route Details: NULL (Route might have been deleted)`);
        }
    });
}

function startFromEmpty(arr) {
    return !arr || arr.length === 0;
}

checkOrder();
