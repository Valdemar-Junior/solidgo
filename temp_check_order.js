
import { createClient } from '@supabase/supabase-js';

const url = 'https://fjbqpmpvnfczbjzkgbjr.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqYnFwbXB2bmZjemJqemtnYmpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwNzAzODIsImV4cCI6MjA3ODY0NjM4Mn0.ylBHuMWJXeQPHH96d_R4wiDeuKggYifBV22ql8oUrHQ';

const supabase = createClient(url, key);

async function checkOrder() {
    console.log('Checking connection and permissions...');

    // Check connection/RLS by fetching ANY row
    const { data: anyOrder, error: anyError } = await supabase
        .from('orders')
        .select('id')
        .limit(1);

    if (anyError) {
        console.error('RLS/Connection Error:', anyError.message);
        if (anyError.message.includes('permission denied')) {
            console.log('Cannot read orders table due to RLS policies (Anonymous access denied).');
        }
        return;
    }
    console.log(`Connection OK. Visible orders (anon): ${anyOrder ? anyOrder.length : 0}`);

    console.log('Searching for order 49711...');

    // Try exact match
    let { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('order_id_erp', '49711');

    if (error) { console.error('Error:', error.message); return; }

    if (!data || data.length === 0) {
        console.log('No exact match. Trying partial match...');
        const { data: partial, error: partialError } = await supabase
            .from('orders')
            .select('*')
            .ilike('order_id_erp', '%49711%');

        if (partialError) { console.error('Error partial:', partialError.message); return; }
        data = partial;
    }

    if (data && data.length > 0) {
        console.log(`Found ${data.length} orders.`);
        data.forEach(order => {
            console.log('------------------------------------------------');
            console.log('Order ID ERP:', order.order_id_erp);
            console.log('Customer:', order.customer_name);
            console.log('Created At:', order.created_at);
            console.log('Service Type:', order.service_type);
            console.log('Status:', order.status);
            const raw = order.raw_json || {};
            console.log('[Raw Data Analysis]');
            console.log('- Has "lancamento"?:', raw.hasOwnProperty('lancamento'));
            console.log('- Has "numero_lancamento"?:', raw.hasOwnProperty('numero_lancamento'));
            console.log('- Has "tipo"?:', raw.hasOwnProperty('tipo'));
            console.log('- Raw JSON extract:', JSON.stringify(raw).slice(0, 300));
        });
    } else {
        console.log('No order found with 49711.');
    }
}

checkOrder();
