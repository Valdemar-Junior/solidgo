
import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabase/client';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, AlertOctagon, RefreshCw, ArrowLeft, Search, Save, Truck, Hammer, History, ClipboardList, ShoppingBag, Route } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

type ActiveSection = 'geral' | 'venda' | 'rotas';

export default function AuditDashboard() {
    const navigate = useNavigate();
    const { user } = useAuthStore();
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [activeSection, setActiveSection] = useState<ActiveSection>('geral');
    const [counts, setCounts] = useState({
        stuck_orders: 0,
        duplicates: 0,
        missing_assembly: 0,
        ghost_routes: 0
    });

    const [details, setDetails] = useState<any[] | null>(null);
    const [activeCheck, setActiveCheck] = useState<string | null>(null);
    const [assemblyTab, setAssemblyTab] = useState<'lote' | 'avulso'>('lote');

    // States for E2E Simulator
    const [e2eLoading, setE2eLoading] = useState(false);
    const [e2eDrivers, setE2eDrivers] = useState<any[]>([]);
    const [chosenDriver, setChosenDriver] = useState<string>('');

    // States for Sales Audit
    const [searchOrderId, setSearchOrderId] = useState('');
    const [searchedOrder, setSearchedOrder] = useState<any | null>(null);
    const [searchLoading, setSearchLoading] = useState(false);
    const [editedOrder, setEditedOrder] = useState<any | null>(null);
    const [saving, setSaving] = useState(false);
    const [auditHistory, setAuditHistory] = useState<any[]>([]);

    // States for Route Status Change
    const [routeSearchName, setRouteSearchName] = useState('');
    const [routeSearchLoading, setRouteSearchLoading] = useState(false);
    const [foundRoute, setFoundRoute] = useState<any | null>(null);
    const [routeChanging, setRouteChanging] = useState(false);

    useEffect(() => {
        runChecks(true);
        loadE2EDrivers();
        // Realtime removido: assinaturas sem filtro sobrecarregavam o pool de conexões.
    }, []);

    const loadE2EDrivers = async () => {
        // Tabela original de Motoristas atrelada com inner join na tabela "users" para puxar o Nome visível
        const { data, error } = await supabase.from('drivers')
            .select('id, active, user_id, user:users!user_id(name)');
            
        if (data && data.length > 0) {
            // Filtrar na mão motoristas ativos e extrair nome limpo pra UI
            const activeRaw = data.filter((d: any) => d.active === true || d.active === 'true');
            const cleanDrivers = activeRaw.map((d: any) => ({
                id: d.id,
                name: d.user?.name || `Motorista #${d.id}`
            }));

            if (cleanDrivers.length > 0) {
                setE2eDrivers(cleanDrivers);
                setChosenDriver(cleanDrivers[0].id);
                return;
            }
        } 
        
        // Conta de Fallback se não encontrar os verdadeiros no BD
        const { data: admin } = await supabase.from('users').select('id, name').eq('id', user?.id || '').single();
        if (admin) {
            setE2eDrivers([admin]);
            setChosenDriver(admin.id);
        }
    };

    const runChecks = async (isInitial = false) => {
        if (isInitial) setLoading(true);
        else setIsRefreshing(true);

        try {
            // 1. Pedidos Travados (Stuck Orders)
            // Apenas pedidos "assigned" que não possuem nenhuma rota ativa associada.
            const { data: stuckData } = await supabase
                .from('orders')
                .select('id, order_id_erp, route_orders!inner(route_id, route:routes(status, name))')
                .eq('status', 'assigned');

            // Filtrar apenas os que não tem NENHUMA rota ativa (pending, in_progress, ready)
            const realStuckOrders = (stuckData || []).filter(order => {
                const routes = order.route_orders || [];
                const hasActiveRoute = routes.some((ro: any) =>
                    ['pending', 'in_progress', 'ready'].includes(ro.route?.status)
                );
                return !hasActiveRoute && routes.length > 0;
            });

            // 2. Duplicidades (Apenas o crítico real: mesmo pedido em > 1 rota ativa)
            const { data: routeData } = await supabase
                .from('route_orders')
                .select('order_id, route:routes(status, name, created_at)');

            let duplicateCount = 0;
            const orderRouteCounts: Record<string, number> = {};
            (routeData || []).forEach((ro: any) => {
                if (['pending', 'in_progress', 'ready'].includes(ro.route?.status)) {
                    orderRouteCounts[ro.order_id] = (orderRouteCounts[ro.order_id] || 0) + 1;
                }
            });
            duplicateCount = Object.values(orderRouteCounts).filter(count => count > 1).length;

            // 3. Montagem Pendente (Últimos 7 dias — economia de egress)
            const seteDiasAtras = new Date();
            seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
            const { data: deliveredOrders } = await supabase
                .from('orders')
                .select('id, items_json')
                .eq('status', 'delivered')
                .gte('updated_at', seteDiasAtras.toISOString())
                .limit(10000);

            let missingAssemblyCount = 0;
            if (deliveredOrders && deliveredOrders.length > 0) {
                // Buscar montagens SEM filtro de data — direto pelos IDs dos pedidos
                const orderIds = deliveredOrders.map(o => o.id);
                const { data: existingAssemblies } = await supabase
                    .from('assembly_products')
                    .select('order_id')
                    .in('order_id', orderIds);

                // Set de order_ids que JÁ possuem montagem (rápido)
                const ordersWithAssembly = new Set((existingAssemblies || []).map(a => a.order_id));

                deliveredOrders.forEach(order => {
                    const items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : (order.items_json || []);

                    // Tem algum item de montagem? (case-insensitive)
                    const hasAssemblyItem = items.some((item: any) =>
                        String(item.has_assembly || '').toLowerCase() === 'sim' ||
                        String(item.produto_e_montavel || '').toLowerCase() === 'sim'
                    );

                    // Tem item de montagem MAS não existe nenhuma linha em assembly_products?
                    if (hasAssemblyItem && !ordersWithAssembly.has(order.id)) {
                        missingAssemblyCount++;
                    }
                });
            }

            setCounts({
                stuck_orders: realStuckOrders.length,
                duplicates: duplicateCount,
                missing_assembly: missingAssemblyCount,
                ghost_routes: 0
            });

        } catch (error) {
            console.error('Audit Check Failed', error);
            if (!isInitial) toast.error('Erro ao atualizar dados');
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    };
    const handleInjectE2E = async () => {
        if (!chosenDriver) {
            toast.error('Selecione um motorista para receber a Rota de Teste.');
            return;
        }

        const confirm = window.confirm('Isso criará 1 Pedido Fantasma e 1 Rota Fantasma na base de dados. Deseja simular um ciclo de uso do App?');
        if (!confirm) return;

        setE2eLoading(true);
        try {
            const mockOrderId = crypto.randomUUID();
            const mockRouteId = crypto.randomUUID();
            const mockOrderIdErp = `TST-PED-${Date.now().toString().slice(-6)}`;

            const fakeItems = [{
                sku: 'SKU-MOCK',
                name: 'PRODUTO E2E (TESTE)',
                quantity: 1,
                purchased_quantity: 1,
                has_assembly: 'Sim',
                produto_e_montavel: 'SIM',
                location: 'A01',
                unit_price: 15.00
            }];

            const { error: errOrder } = await supabase.from('orders').insert({
                id: mockOrderId,
                order_id_erp: mockOrderIdErp,
                customer_name: 'CLIENTE DA SILVA (SIMULAÇÃO E2E)',
                phone: '84999999999',
                status: 'pending',
                address_json: { city: 'Natal', street: 'Rua do Teste', number: '999', neighborhood: 'Tirol' },
                items_json: fakeItems,
                import_source: 'AVULSO'
            });
            if (errOrder) throw new Error('Order error: ' + errOrder.message);

            const { error: errRoute } = await supabase.from('routes').insert({
                id: mockRouteId,
                name: `ROTA E2E - TESTE DE INTEGRAÇÃO`,
                status: 'in_progress',
                driver_id: chosenDriver
            });
            if (errRoute) throw new Error('Route error: ' + errRoute.message);

            const { error: errBind } = await supabase.from('route_orders').insert({
                route_id: mockRouteId,
                order_id: mockOrderId,
                sequence: 1,
                status: 'pending'
            });
            if (errBind) throw new Error('Bind error: ' + errBind.message);

            toast.success(`Mock criado com sucesso! Rota E2E atribuída ao motorista (Acesse a aba Rotas / App).`);
        } catch (err: any) {
            console.error(err);
            toast.error(err.message);
        } finally {
            setE2eLoading(false);
        }
    };

    const handleCleanE2E = async () => {
        const confirm = window.confirm('BOMBA ATÔMICA! Isso apagará tudo no App vindo da simulação E2E. É irreversível. Deseja Continuar?');
        if (!confirm) return;

        setE2eLoading(true);
        try {
            toast.info('Buscando lixos de teste E2E...');
            
            // 1. Achar Orders
            const { data: fakeOrders } = await supabase.from('orders').select('id').like('order_id_erp', 'TST-PED-%');
            const fakeOrderIds = fakeOrders?.map(o => o.id) || [];
            
            if (fakeOrderIds.length > 0) {
                await supabase.from('assembly_products').delete().in('order_id', fakeOrderIds);
                // 1.1 Deletar os vínculos route_orders ligados a estes pedidos
                await supabase.from('route_orders').delete().in('order_id', fakeOrderIds);
                // 1.2 Deletar os pedidos
                const { error: errO } = await supabase.from('orders').delete().in('id', fakeOrderIds);
                if (errO) throw new Error('Falha ao deletar pedios: ' + errO.message);
            }

            // 2. Achar Routes
            const { data: fakeRoutes } = await supabase.from('routes').select('id').ilike('name', '%rota e2e%');
            const fakeRouteIds = fakeRoutes?.map(r => r.id) || [];
            
            if (fakeRouteIds.length > 0) {
                // 2.1 Garantir que NENHUM vínculo route_orders de outras naturezas sobraram travando a rota
                await supabase.from('route_orders').delete().in('route_id', fakeRouteIds);
                // 2.2 Por fim, explodir a rota fantasma
                const { error: errR } = await supabase.from('routes').delete().in('id', fakeRouteIds);
                if (errR) throw new Error('Falha ao deletar rotas: ' + errR.message);
            }

            toast.success('Limpeza Concluída. Todos os testes TST foram extinguidos!');
        } catch (err: any) {
            console.error(err);
            toast.error(err.message);
        } finally {
            setE2eLoading(false);
        }
    };

    const showStuckOrders = async () => {
        setActiveCheck('stuck');
        const { data: stuckData } = await supabase
            .from('orders')
            .select('id, order_id_erp, customer_name, status, route_orders!inner(route_id, status, route:routes(name, status))')
            .eq('status', 'assigned');

        // Filtrar no frontend para extrair apenas os perfeitamente "travados"
        const realStuckOrders = (stuckData || []).filter(order => {
            const routes = order.route_orders || [];
            const hasActiveRoute = routes.some((ro: any) =>
                ['pending', 'in_progress', 'ready'].includes(ro.route?.status)
            );
            return !hasActiveRoute && routes.length > 0;
        });

        // Adaptar payload para a tabela de detalhes
        setDetails(realStuckOrders.map(o => ({
            ...o,
            client_name: o.customer_name,
        })));
    };

    const showDuplicates = async () => {
        setActiveCheck('duplicate');
        // Buscar pedidos que estão em mais de uma rota ativa simultaneamente
        const { data: activeRouteOrders } = await supabase
            .from('route_orders')
            .select('order_id, route_id, route:routes(name, status, created_at), order:orders(order_id_erp, customer_name)')
            .in('route.status', ['pending', 'in_progress', 'ready']);

        const groupings: Record<string, any[]> = {};
        (activeRouteOrders || []).forEach((ro: any) => {
            // Apenas considerar se o join da rota não for nulo (filtro de .in)
            if (ro.route) {
                if (!groupings[ro.order_id]) groupings[ro.order_id] = [];
                groupings[ro.order_id].push(ro);
            }
        });

        const combined: any[] = [];
        Object.entries(groupings).forEach(([orderId, routes]) => {
            if (routes.length > 1) {
                const first = routes[0];
                combined.push({
                    id: orderId,
                    type: 'duplicate_route',
                    title: `Pedido ${first.order?.order_id_erp || '???'} (Aviso de Rota Dupla)`,
                    count: routes.length,
                    client_name: first.order?.customer_name,
                    details: 'CRÍTICO: O mesmo pedido está locado em mais de uma rota logística ativa nesse instante.',
                    routes: routes.map((r: any) => r.route)
                });
            }
        });

        setDetails(combined);
    };

    const showMissingAssembly = async () => {
        setActiveCheck('assembly');
        const seteDiasAtras = new Date();
        seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
        const { data: deliveredOrders } = await supabase
            .from('orders')
            .select('id, order_id_erp, customer_name, phone, address_json, items_json, import_source')
            .eq('status', 'delivered')
            .gte('updated_at', seteDiasAtras.toISOString())
            .limit(10000);

        if (!deliveredOrders || deliveredOrders.length === 0) {
            setDetails([]);
            return;
        }

        // Buscar montagens SEM filtro de data — direto pelos IDs dos pedidos
        const orderIds = deliveredOrders.map(o => o.id);
        const { data: existingAssemblies } = await supabase
            .from('assembly_products')
            .select('order_id')
            .in('order_id', orderIds);

        const ordersWithAssembly = new Set((existingAssemblies || []).map(a => a.order_id));
        const missingDetails: any[] = [];

        deliveredOrders.forEach(order => {
            const items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : (order.items_json || []);

            // Coletar todos os itens de montagem (case-insensitive)
            const itemsToAssemble = items.filter((item: any) =>
                String(item.has_assembly || '').toLowerCase() === 'sim' ||
                String(item.produto_e_montavel || '').toLowerCase() === 'sim'
            );

            // Se tem itens de montagem mas NÃO existe nenhuma linha em assembly_products
            if (itemsToAssemble.length > 0 && !ordersWithAssembly.has(order.id)) {
                missingDetails.push({
                    id: order.id,
                    order_id_erp: order.order_id_erp,
                    client_name: order.customer_name,
                    delivery_date: 'Entrega: Nos últimos 7 dias',
                    items_json: itemsToAssemble,
                    details: `${itemsToAssemble.length} item(ns) sem montagem gerada`,
                    import_source: order.import_source,
                    phone: order.phone,
                    address_json: order.address_json
                });
            }
        });

        setDetails(missingDetails);
    };

    const resolveStuckOrder = async (orderId: string, resolution: 'delivered' | 'returned') => {
        try {
            if (resolution === 'delivered') {
                const { error } = await supabase.from('orders').update({ status: 'delivered', return_flag: false }).eq('id', orderId);
                if (error) throw error;
                toast.success(`Pedido marcado como ENTREGUE.`);
            } else {
                const reason = prompt("Motivo da devolução:");
                if (!reason) return;
                const { error } = await supabase.from('orders').update({
                    status: 'pending',
                    return_flag: true,
                    last_return_reason: reason
                }).eq('id', orderId);
                if (error) throw error;
                toast.success(`Pedido marcado como DEVOLVIDO e liberado.`);
            }

            runChecks();
            if (activeCheck === 'stuck') showStuckOrders();
        } catch (err) {
            toast.error("Erro ao atualizar pedido");
            console.error(err);
        }
    };

    const generateAssembly = async (orderId: string, items: any) => {
        try {
            if (!window.confirm("Deseja realmente gerar as ordens de montagem para este pedido?")) return;

            const assemblyItems: any[] = [];

            // Buscar dados completos do pedido para preencher a montagem
            const orderDetail = details.find(d => d.id === orderId);
            if (!orderDetail) throw new Error("Dados do pedido não encontrados nos detalhes locais.");

            // Para segurança máxima, recalcula o que já existe no banco
            const { data: existingAssemblies } = await supabase
                .from('assembly_products')
                .select('product_sku')
                .eq('order_id', orderId);

            items.forEach((i: any) => {
                if (String(i.has_assembly || '').toLowerCase() === 'sim' || String(i.produto_e_montavel || '').toLowerCase() === 'sim') {
                    const expected = parseInt(i.purchased_quantity || i.quantity || 1);
                    const current = (existingAssemblies || []).filter(a => a.product_sku === i.sku).length;
                    const missing = expected - current;

                    for (let x = 0; x < missing; x++) {
                        assemblyItems.push({
                            order_id: orderId,
                            product_sku: i.sku,
                            product_name: i.nome_do_produto || i.name || i.descricao_produto || 'Produto sem nome',
                            customer_name: orderDetail.client_name,
                            customer_phone: orderDetail.phone || null,
                            installation_address: orderDetail.address_json || null,
                            import_source: orderDetail.import_source || null,
                            status: 'pending'
                        });
                    }
                }
            });

            if (assemblyItems.length === 0) {
                toast.error("Este pedido já possui todas as montagens no banco.");
                return;
            }

            const { error } = await supabase.from('assembly_products').insert(assemblyItems);
            if (error) throw error;

            toast.success(`${assemblyItems.length} montagem(ns) gerada(s) com sucesso!`);
            runChecks();
            if (activeCheck === 'assembly') showMissingAssembly();

        } catch (err) {
            console.error(err);
            toast.error("Erro ao gerar montagem.");
        }
    };

    // ===== SALES AUDIT FUNCTIONS =====

    const searchOrder = async () => {
        if (!searchOrderId.trim()) {
            toast.error('Digite o número do pedido');
            return;
        }

        setSearchLoading(true);
        setSearchedOrder(null);
        setEditedOrder(null);
        setAuditHistory([]);

        try {
            const { data, error } = await supabase
                .from('orders')
                .select('id, order_id_erp, customer_name, phone, address_json, items_json, status, tem_frete_full, observacoes_publicas, observacoes_internas, customer_cpf, raw_json')
                .eq('order_id_erp', searchOrderId.trim())
                .single();

            if (error || !data) {
                toast.error('Pedido não encontrado');
                return;
            }

            setSearchedOrder(data);
            setEditedOrder({
                tem_frete_full: data.tem_frete_full || '',
                address_json: data.address_json || {},
                items_json: data.items_json || []
            });

            // Load audit history
            const { data: logs } = await supabase
                .from('order_audit_log')
                .select('*')
                .eq('order_id', data.id)
                .order('created_at', { ascending: false })
                .limit(20);

            setAuditHistory(logs || []);

        } catch (e) {
            console.error(e);
            toast.error('Erro ao buscar pedido');
        } finally {
            setSearchLoading(false);
        }
    };

    const saveOrderChanges = async () => {
        if (!searchedOrder || !editedOrder) return;

        setSaving(true);
        const changes: { field: string; old_value: string; new_value: string }[] = [];

        // Check Frete Full changes
        const oldFrete = searchedOrder.tem_frete_full || '';
        const newFrete = editedOrder.tem_frete_full || '';
        if (oldFrete !== newFrete) {
            changes.push({ field: 'tem_frete_full', old_value: oldFrete, new_value: newFrete });
        }

        // Check Address changes
        const oldAddr = searchedOrder.address_json || {};
        const newAddr = editedOrder.address_json || {};
        if (oldAddr.street !== newAddr.street) {
            changes.push({ field: 'endereco_rua', old_value: oldAddr.street || '', new_value: newAddr.street || '' });
        }
        if (oldAddr.neighborhood !== newAddr.neighborhood) {
            changes.push({ field: 'endereco_bairro', old_value: oldAddr.neighborhood || '', new_value: newAddr.neighborhood || '' });
        }
        if (oldAddr.number !== newAddr.number) {
            changes.push({ field: 'endereco_numero', old_value: oldAddr.number || '', new_value: newAddr.number || '' });
        }

        // Check Montagem changes per item
        const oldItems = searchedOrder.items_json || [];
        const newItems = editedOrder.items_json || [];
        newItems.forEach((item: any, idx: number) => {
            const oldItem = oldItems[idx] || {};
            if (oldItem.has_assembly !== item.has_assembly) {
                changes.push({
                    field: `montagem_${item.sku || idx}`,
                    old_value: oldItem.has_assembly || 'Não',
                    new_value: item.has_assembly || 'Não'
                });
            }
        });

        if (changes.length === 0) {
            toast.info('Nenhuma alteração detectada');
            setSaving(false);
            return;
        }

        try {
            // Update order
            const { error: updateError } = await supabase
                .from('orders')
                .update({
                    tem_frete_full: editedOrder.tem_frete_full,
                    address_json: editedOrder.address_json,
                    items_json: editedOrder.items_json
                })
                .eq('id', searchedOrder.id);

            if (updateError) throw updateError;

            // Insert audit logs
            const logs = changes.map(c => ({
                order_id: searchedOrder.id,
                user_id: user?.id || null,
                user_name: user?.name || 'Sistema',
                field_changed: c.field,
                old_value: c.old_value,
                new_value: c.new_value
            }));

            await supabase.from('order_audit_log').insert(logs);

            toast.success(`${changes.length} alteração(ões) salva(s) com sucesso!`);

            // Refresh order data
            setSearchedOrder({ ...searchedOrder, ...editedOrder });

            // Refresh audit history
            const { data: newLogs } = await supabase
                .from('order_audit_log')
                .select('*')
                .eq('order_id', searchedOrder.id)
                .order('created_at', { ascending: false })
                .limit(20);
            setAuditHistory(newLogs || []);

        } catch (e) {
            console.error(e);
            toast.error('Erro ao salvar alterações');
        } finally {
            setSaving(false);
        }
    };

    const updateItemAssembly = (itemIndex: number, value: string) => {
        if (!editedOrder) return;
        const newItems = [...editedOrder.items_json];
        newItems[itemIndex] = { ...newItems[itemIndex], has_assembly: value };
        setEditedOrder({ ...editedOrder, items_json: newItems });
    };

    // ==================== ROUTE STATUS CHANGE ====================
    const searchRoute = async () => {
        const term = routeSearchName.trim();
        if (!term) {
            toast.error('Digite o ID da rota');
            return;
        }

        setRouteSearchLoading(true);
        setFoundRoute(null);

        try {
            const { data, error } = await supabase
                .from('routes')
                .select('id, name, status, driver_id, vehicle_id, created_at, route_code, observations, route_orders(order_id)')
                .eq('route_code', term)
                .single();

            if (error || !data) {
                toast.error('Rota não encontrada. Verifique o ID.');
                return;
            }

            // Buscar nome do motorista via drivers → users
            let driverName = 'Sem motorista';
            if (data.driver_id) {
                const { data: driverData } = await supabase
                    .from('drivers')
                    .select('user_id, users(name)')
                    .eq('id', data.driver_id)
                    .single();
                if (driverData && (driverData as any).users?.name) {
                    driverName = (driverData as any).users.name;
                }
            }

            // Buscar veículo
            let vehicleInfo = 'Sem veículo';
            if ((data as any).vehicle_id) {
                const { data: vehicleData } = await supabase
                    .from('vehicles')
                    .select('plate, model')
                    .eq('id', (data as any).vehicle_id)
                    .single();
                if (vehicleData) {
                    vehicleInfo = `${vehicleData.model || ''} (${vehicleData.plate || ''})`.trim();
                }
            }

            setFoundRoute({ ...data, driver_name: driverName, vehicle_info: vehicleInfo });
        } catch (e) {
            console.error(e);
            toast.error('Erro ao buscar rota');
        } finally {
            setRouteSearchLoading(false);
        }
    };

    const changeRouteStatus = async (routeId: string, newStatus: string) => {
        const statusLabels: Record<string, string> = {
            pending: 'Separação',
            in_progress: 'Em Rota',
            completed: 'Finalizada'
        };

        if (!window.confirm(`Deseja realmente mudar a rota para "${statusLabels[newStatus]}"?`)) return;

        setRouteChanging(true);
        try {
            const { error } = await supabase
                .from('routes')
                .update({ status: newStatus })
                .eq('id', routeId);

            if (error) throw error;

            // Se voltou para pending, os pedidos também devem voltar
            if (newStatus === 'pending') {
                const routeOrders = foundRoute?.route_orders || [];
                const orderIds = routeOrders.map((ro: any) => ro.order_id);
                if (orderIds.length > 0) {
                    await supabase
                        .from('orders')
                        .update({ status: 'assigned' })
                        .in('id', orderIds)
                        .eq('status', 'delivered');
                }
            }

            toast.success(`Rota alterada para "${statusLabels[newStatus]}" com sucesso!`);
            setFoundRoute({ ...foundRoute, status: newStatus });
        } catch (e) {
            console.error(e);
            toast.error('Erro ao alterar status da rota');
        } finally {
            setRouteChanging(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50/50 flex">
            {/* Sidebar */}
            <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
                <div className="p-4 border-b border-gray-100">
                    <button
                        onClick={() => navigate('/admin')}
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors mb-4"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        <span className="text-sm">Voltar</span>
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="bg-red-100 p-2 rounded-lg">
                            <AlertOctagon className="h-6 w-6 text-red-600" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-gray-900">Auditoria</h1>
                            <p className="text-xs text-gray-500">Sistema de Correção</p>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-2">
                    <button
                        onClick={() => { setActiveSection('geral'); setDetails(null); setActiveCheck(null); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${activeSection === 'geral'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        <ClipboardList className="h-5 w-5" />
                        <div>
                            <span className="font-medium block">Auditoria Geral</span>
                            <span className="text-xs opacity-70">Inconsistências do sistema</span>
                        </div>
                    </button>

                    <button
                        onClick={() => { setActiveSection('venda'); setDetails(null); setActiveCheck(null); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${activeSection === 'venda'
                            ? 'bg-green-50 text-green-700 border border-green-200'
                            : 'text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        <ShoppingBag className="h-5 w-5" />
                        <div>
                            <span className="font-medium block">Auditoria de Venda</span>
                            <span className="text-xs opacity-70">Editar dados do pedido</span>
                        </div>
                    </button>

                    <button
                        onClick={() => { setActiveSection('rotas'); setDetails(null); setActiveCheck(null); setFoundRoute(null); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${activeSection === 'rotas'
                            ? 'bg-orange-50 text-orange-700 border border-orange-200'
                            : 'text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        <Route className="h-5 w-5" />
                        <div>
                            <span className="font-medium block">Status de Rota</span>
                            <span className="text-xs opacity-70">Alterar status de rotas</span>
                        </div>
                    </button>
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto bg-gray-50/50">
                <div className="px-6 py-4 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gray-900 border-l-4 border-blue-500 pl-3">
                        {activeSection === 'geral' ? 'Auditoria Geral' : activeSection === 'venda' ? 'Auditoria de Venda (Edição de Status)' : 'Alterar Status de Rota'}
                    </h2>
                    {activeSection === 'geral' && (
                        <button
                            onClick={() => runChecks(false)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors font-medium text-sm border border-blue-200"
                            disabled={isRefreshing}
                        >
                            <RefreshCw className={isRefreshing ? "animate-spin h-4 w-4" : "h-4 w-4"} />
                            Atualizar
                        </button>
                    )}
                </div>

                <div className="p-6">
                    {/* AUDITORIA GERAL */}
                    {activeSection === 'geral' && (
                        <>
                            {/* Controle do Simulador E2E */}
                            <div className="bg-white rounded-xl shadow-[0_4px_10px_rgba(0,0,0,0.05)] border border-purple-200 mb-8 p-6 relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-2 h-full bg-purple-500"></div>
                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                    <div>
                                        <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                            <Hammer className="h-5 w-5 text-purple-600" />
                                            Simulador de Entregas e Montagem (E2E)
                                        </h3>
                                        <p className="text-sm text-gray-500 mt-1">Crie um pedido e rota real de TESTE para você operar no App e verificar a ativação correta do painel de Montagens.</p>
                                    </div>

                                    <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                                        <select
                                            className="px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-purple-500 focus:border-purple-500 w-full sm:w-auto"
                                            value={chosenDriver}
                                            onChange={(e) => setChosenDriver(e.target.value)}
                                            disabled={e2eLoading}
                                        >
                                            <option value="">-- Selecione Motorista --</option>
                                            {e2eDrivers.map(d => (
                                                <option key={d.id} value={d.id}>{d.name}</option>
                                            ))}
                                        </select>

                                        <button
                                            onClick={handleInjectE2E}
                                            disabled={e2eLoading || !chosenDriver}
                                            className="whitespace-nowrap flex items-center gap-2 px-5 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                                        >
                                            {e2eLoading ? <RefreshCw className="animate-spin h-4 w-4" /> : <Truck className="h-4 w-4" />}
                                            Injetar Cenário (Preparar)
                                        </button>

                                        <button
                                            onClick={handleCleanE2E}
                                            disabled={e2eLoading}
                                            className="whitespace-nowrap flex items-center gap-2 px-5 py-2 bg-white text-red-600 border border-red-200 font-medium rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                                        >
                                            {e2eLoading ? <RefreshCw className="animate-spin h-4 w-4" /> : <AlertOctagon className="h-4 w-4" />}
                                            Limpar Testes Antigos
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Cards Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                {/* Card Pedidos Travados */}
                                <div
                                    onClick={showStuckOrders}
                                    className={`p-6 rounded-xl shadow-sm border cursor-pointer transition-all hover:-translate-y-1 hover:shadow-md ${counts.stuck_orders > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}
                                >
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Inconsistências</p>
                                            <h3 className="font-bold text-xl text-gray-800 mt-1">Pedidos Travados</h3>
                                        </div>
                                        {counts.stuck_orders > 0 ? (
                                            <div className="bg-red-100 p-2 rounded-full"><AlertTriangle className="text-red-500 h-5 w-5" /></div>
                                        ) : (
                                            <div className="bg-green-100 p-2 rounded-full"><CheckCircle2 className="text-green-500 h-5 w-5" /></div>
                                        )}
                                    </div>
                                    <div className="flex items-baseline">
                                        <p className={`text-4xl font-bold ${counts.stuck_orders > 0 ? 'text-red-600' : 'text-gray-900'}`}>{counts.stuck_orders}</p>
                                        <span className="ml-2 text-sm text-gray-500">pedidos afetados</span>
                                    </div>
                                    <p className="text-sm mt-4 text-gray-600">Pedidos "Em Rota" vinculados a rotas já finalizadas.</p>
                                </div>

                                {/* Card Duplicidades */}
                                <div
                                    onClick={showDuplicates}
                                    className={`p-6 rounded-xl shadow-sm border cursor-pointer transition-all hover:-translate-y-1 hover:shadow-md ${counts.duplicates > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'}`}
                                >
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Integridade</p>
                                            <h3 className="font-bold text-xl text-gray-800 mt-1">Duplicidades</h3>
                                        </div>
                                        {counts.duplicates > 0 ? (
                                            <div className="bg-amber-100 p-2 rounded-full"><AlertTriangle className="text-amber-500 h-5 w-5" /></div>
                                        ) : (
                                            <div className="bg-green-100 p-2 rounded-full"><CheckCircle2 className="text-green-500 h-5 w-5" /></div>
                                        )}
                                    </div>
                                    <div className="flex items-baseline">
                                        <p className={`text-4xl font-bold ${counts.duplicates > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{counts.duplicates}</p>
                                        <span className="ml-2 text-sm text-gray-500">casos detectados</span>
                                    </div>
                                    <p className="text-sm mt-4 text-gray-600">Pedidos duplicados ou em múltiplas rotas.</p>
                                </div>

                                {/* Card Montagem Pendente */}
                                <div
                                    onClick={showMissingAssembly}
                                    className={`p-6 rounded-xl shadow-sm border cursor-pointer transition-all hover:-translate-y-1 hover:shadow-md ${counts.missing_assembly > 0 ? 'bg-purple-50 border-purple-200' : 'bg-white border-gray-100'}`}
                                >
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Pós-venda</p>
                                            <h3 className="font-bold text-xl text-gray-800 mt-1">Montagem Pendente</h3>
                                        </div>
                                        {counts.missing_assembly > 0 ? (
                                            <div className="bg-purple-100 p-2 rounded-full"><AlertTriangle className="text-purple-500 h-5 w-5" /></div>
                                        ) : (
                                            <div className="bg-green-100 p-2 rounded-full"><CheckCircle2 className="text-green-500 h-5 w-5" /></div>
                                        )}
                                    </div>
                                    <div className="flex items-baseline">
                                        <p className={`text-4xl font-bold ${counts.missing_assembly > 0 ? 'text-purple-600' : 'text-gray-900'}`}>{counts.missing_assembly}</p>
                                        <span className="ml-2 text-sm text-gray-500">pedidos sem montagem</span>
                                    </div>
                                    <p className="text-sm mt-4 text-gray-600">Entregues c/ montagem sem lista para montadores.</p>
                                </div>
                            </div>

                            {/* Details Table */}
                            {details && (
                                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                    <div className="bg-gray-50/50 px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                                        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                                            {activeCheck === 'stuck' && <AlertTriangle className="text-red-500 h-5 w-5" />}
                                            {activeCheck === 'duplicate' && <AlertTriangle className="text-amber-500 h-5 w-5" />}
                                            {activeCheck === 'assembly' && <AlertTriangle className="text-purple-500 h-5 w-5" />}
                                            {activeCheck === 'stuck' ? 'Pedidos Travados' :
                                                activeCheck === 'duplicate' ? 'Duplicidades Detectadas' :
                                                    activeCheck === 'assembly' ? 'Montagens Pendentes' : 'Detalhes'}
                                        </h2>
                                        <button onClick={() => setDetails(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
                                    </div>

                                    {activeCheck === 'assembly' && (
                                        <div className="border-b border-gray-200 bg-white px-6 flex gap-6">
                                            <button
                                                onClick={() => setAssemblyTab('lote')}
                                                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${assemblyTab === 'lote' ? 'border-purple-500 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
                                            >
                                                Em Lote (Rotina Automática)
                                            </button>
                                            <button
                                                onClick={() => setAssemblyTab('avulso')}
                                                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${assemblyTab === 'avulso' ? 'border-purple-500 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
                                            >
                                                Lançamento Avulso (Manual)
                                            </button>
                                        </div>
                                    )}

                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left">
                                            <thead>
                                                <tr className="bg-gray-100/50 text-gray-500 text-xs font-semibold uppercase tracking-wider">
                                                    <th className="p-4">{activeCheck === 'duplicate' ? 'Info' : 'Pedido'}</th>
                                                    <th className="p-4">{activeCheck === 'duplicate' ? 'Ocorrências' : 'Cliente'}</th>
                                                    <th className="p-4">Detalhes</th>
                                                    <th className="p-4 text-right">Ação</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {(() => {
                                                    const filtered = activeCheck === 'assembly'
                                                        ? details.filter(item => {
                                                            const isAvulso = ['manual', 'avulso', 'avulsa'].includes(String(item.import_source || '').toLowerCase()) ||
                                                                /-[AT](-\d+)?$/i.test(item.order_id_erp || '');
                                                            return assemblyTab === 'avulso' ? isAvulso : !isAvulso;
                                                        })
                                                        : details;

                                                    if (filtered.length === 0) {
                                                        return (
                                                            <tr>
                                                                <td colSpan={4} className="p-12 text-center text-gray-500">
                                                                    <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
                                                                    <p className="font-medium text-gray-900">
                                                                        {activeCheck === 'assembly'
                                                                            ? (assemblyTab === 'lote' ? 'Nenhuma montagem em lote pendente' : 'Nenhuma montagem avulsa pendente')
                                                                            : 'Nenhuma inconsistência'}
                                                                    </p>
                                                                </td>
                                                            </tr>
                                                        );
                                                    }

                                                    return filtered.map((item: any, idx: number) => (
                                                        <tr key={item.id || idx} className="hover:bg-blue-50/50">
                                                            <td className="p-4 font-medium text-gray-900">
                                                                {activeCheck === 'duplicate' ? item.title : item.order_id_erp}
                                                            </td>
                                                            <td className="p-4 text-gray-600">
                                                                {activeCheck === 'duplicate' ? `${item.count} registros` : item.client_name}
                                                            </td>
                                                            <td className="p-4 text-sm text-gray-500">
                                                                {activeCheck === 'duplicate' ? item.details :
                                                                    activeCheck === 'assembly' ? `Entrega: ${item.delivery_date}` :
                                                                        item.route_orders?.[0]?.route?.name}
                                                            </td>
                                                            <td className="p-4 text-right">
                                                                {activeCheck === 'stuck' && (
                                                                    <div className="flex justify-end gap-2">
                                                                        {item.route_orders?.[0]?.route_id && (
                                                                            <button
                                                                                onClick={() => navigate('/admin/routes', { state: { openRouteId: item.route_orders[0].route_id } })}
                                                                                className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 border border-blue-200 text-sm font-medium"
                                                                            >
                                                                                Ver Rota
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            onClick={() => resolveStuckOrder(item.id, 'delivered')}
                                                                            className="px-3 py-1.5 bg-green-50 text-green-700 rounded-md hover:bg-green-100 border border-green-200 text-sm font-medium"
                                                                        >
                                                                            Confirmar Entrega
                                                                        </button>
                                                                        <button
                                                                            onClick={() => resolveStuckOrder(item.id, 'returned')}
                                                                            className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-md hover:bg-amber-100 border border-amber-200 text-sm font-medium"
                                                                        >
                                                                            Devolução
                                                                        </button>
                                                                    </div>
                                                                )}
                                                                {activeCheck === 'assembly' && (
                                                                    <button
                                                                        onClick={() => generateAssembly(item.id, item.items_json)}
                                                                        className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-md hover:bg-purple-100 border border-purple-200 text-sm font-medium"
                                                                    >
                                                                        Gerar Montagem
                                                                    </button>
                                                                )}
                                                                {activeCheck === 'duplicate' && (
                                                                    <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">Manual</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ));
                                                })()}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* AUDITORIA DE VENDA */}
                    {activeSection === 'venda' && (
                        <div className="space-y-6">
                            {/* Search Bar */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                    <Search className="h-5 w-5 text-gray-500" />
                                    Buscar Pedido
                                </h3>
                                <div className="flex gap-3">
                                    <input
                                        type="text"
                                        placeholder="Digite o número do pedido (ERP)..."
                                        value={searchOrderId}
                                        onChange={(e) => setSearchOrderId(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && searchOrder()}
                                        className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-lg"
                                    />
                                    <button
                                        onClick={searchOrder}
                                        disabled={searchLoading}
                                        className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {searchLoading ? (
                                            <RefreshCw className="animate-spin h-5 w-5" />
                                        ) : (
                                            <Search className="h-5 w-5" />
                                        )}
                                        Buscar
                                    </button>
                                </div>
                            </div>

                            {/* Order Editor */}
                            {searchedOrder && editedOrder && (
                                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                    <div className="bg-green-50 px-6 py-4 border-b border-green-100">
                                        <h3 className="text-lg font-bold text-green-800">
                                            Pedido #{searchedOrder.order_id_erp}
                                        </h3>
                                        <p className="text-sm text-green-600">{searchedOrder.customer_name}</p>
                                    </div>

                                    <div className="p-6 space-y-6">
                                        {/* Frete Full */}
                                        <div className="border-b border-gray-100 pb-6">
                                            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                                                <Truck className="h-4 w-4" />
                                                Frete Full
                                            </label>
                                            <div className="flex gap-4">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="frete_full"
                                                        checked={editedOrder.tem_frete_full === 'Sim'}
                                                        onChange={() => setEditedOrder({ ...editedOrder, tem_frete_full: 'Sim' })}
                                                        className="h-4 w-4 text-green-600"
                                                    />
                                                    <span className="text-gray-700">Sim</span>
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="frete_full"
                                                        checked={editedOrder.tem_frete_full !== 'Sim'}
                                                        onChange={() => setEditedOrder({ ...editedOrder, tem_frete_full: 'Não' })}
                                                        className="h-4 w-4 text-green-600"
                                                    />
                                                    <span className="text-gray-700">Não</span>
                                                </label>
                                            </div>
                                        </div>

                                        {/* Address */}
                                        <div className="border-b border-gray-100 pb-6">
                                            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                                                📍 Endereço
                                            </label>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs text-gray-500 mb-1">Rua / Logradouro</label>
                                                    <input
                                                        type="text"
                                                        value={editedOrder.address_json.street || ''}
                                                        onChange={(e) => setEditedOrder({
                                                            ...editedOrder,
                                                            address_json: { ...editedOrder.address_json, street: e.target.value }
                                                        })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-gray-500 mb-1">Número</label>
                                                    <input
                                                        type="text"
                                                        value={editedOrder.address_json.number || ''}
                                                        onChange={(e) => setEditedOrder({
                                                            ...editedOrder,
                                                            address_json: { ...editedOrder.address_json, number: e.target.value }
                                                        })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-gray-500 mb-1">Bairro</label>
                                                    <input
                                                        type="text"
                                                        value={editedOrder.address_json.neighborhood || ''}
                                                        onChange={(e) => setEditedOrder({
                                                            ...editedOrder,
                                                            address_json: { ...editedOrder.address_json, neighborhood: e.target.value }
                                                        })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-gray-500 mb-1">Cidade 🔒</label>
                                                    <input
                                                        type="text"
                                                        value={editedOrder.address_json.city || ''}
                                                        disabled
                                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Products / Assembly */}
                                        <div className="border-b border-gray-100 pb-6">
                                            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                                                <Hammer className="h-4 w-4" />
                                                Produtos / Montagem
                                            </label>
                                            <div className="space-y-3">
                                                {editedOrder.items_json.map((item: any, idx: number) => (
                                                    <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                                                        <div>
                                                            <p className="font-medium text-gray-900">{item.name || item.sku}</p>
                                                            <p className="text-xs text-gray-500">SKU: {item.sku} • Qtd: {item.purchased_quantity || item.quantity || 1}</p>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-sm text-gray-600">Montagem:</span>
                                                            <select
                                                                value={String(item.has_assembly || '').toLowerCase() === 'sim' ? 'Sim' : 'Não'}
                                                                onChange={(e) => updateItemAssembly(idx, e.target.value)}
                                                                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
                                                            >
                                                                <option value="Sim">Sim</option>
                                                                <option value="Não">Não</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Save Button */}
                                        <div className="flex justify-end">
                                            <button
                                                onClick={saveOrderChanges}
                                                disabled={saving}
                                                className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium disabled:opacity-50"
                                            >
                                                {saving ? (
                                                    <RefreshCw className="animate-spin h-5 w-5" />
                                                ) : (
                                                    <Save className="h-5 w-5" />
                                                )}
                                                Salvar Alterações
                                            </button>
                                        </div>
                                    </div>

                                    {/* Audit History */}
                                    {auditHistory.length > 0 && (
                                        <div className="border-t border-gray-200 bg-gray-50 p-6">
                                            <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                                                <History className="h-4 w-4" />
                                                Histórico de Alterações
                                            </h4>
                                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                                {auditHistory.map((log: any) => (
                                                    <div key={log.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-100 text-sm">
                                                        <div>
                                                            <span className="font-medium text-gray-900">{log.field_changed}</span>
                                                            <span className="text-gray-500 mx-2">:</span>
                                                            <span className="text-red-500 line-through">{log.old_value || '(vazio)'}</span>
                                                            <span className="text-gray-400 mx-1">→</span>
                                                            <span className="text-green-600 font-medium">{log.new_value || '(vazio)'}</span>
                                                        </div>
                                                        <div className="text-xs text-gray-400">
                                                            {log.user_name} • {new Date(log.created_at).toLocaleString('pt-BR')}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ALTERAÇÃO DE STATUS DE ROTA */}
                    {activeSection === 'rotas' && (
                        <div className="space-y-6">
                            {/* Search Bar */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                    <Search className="h-5 w-5 text-gray-500" />
                                    Buscar Rota por ID
                                </h3>
                                <div className="flex gap-3">
                                    <input
                                        type="text"
                                        value={routeSearchName}
                                        onChange={(e) => setRouteSearchName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && searchRoute()}
                                        placeholder="Cole o ID da rota aqui..."
                                        className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-lg font-mono"
                                    />
                                    <button
                                        onClick={searchRoute}
                                        disabled={routeSearchLoading}
                                        className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium flex items-center gap-2 disabled:opacity-50 transition-colors"
                                    >
                                        {routeSearchLoading ? (
                                            <RefreshCw className="animate-spin h-5 w-5" />
                                        ) : (
                                            <Search className="h-5 w-5" />
                                        )}
                                        Buscar
                                    </button>
                                </div>
                            </div>

                            {/* Route Result */}
                            {foundRoute && (
                                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                    <div className={`p-6 border-l-4 ${
                                        foundRoute.status === 'in_progress' ? 'border-l-blue-500 bg-blue-50/30' :
                                        foundRoute.status === 'pending' ? 'border-l-yellow-500 bg-yellow-50/30' :
                                        'border-l-green-500 bg-green-50/30'
                                    }`}>
                                        <h3 className="text-lg font-bold text-gray-900 mb-4">{foundRoute.name}</h3>

                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                                            <div>
                                                <p className="text-xs text-gray-500 mb-1">Status Atual</p>
                                                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${
                                                    foundRoute.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                                                    foundRoute.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                                    'bg-green-100 text-green-800'
                                                }`}>
                                                    {foundRoute.status === 'in_progress' ? '🚛 Em Rota' :
                                                     foundRoute.status === 'pending' ? '📦 Separação' :
                                                     '✅ Finalizada'}
                                                </span>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-500 mb-1">Motorista</p>
                                                <p className="font-medium text-gray-900">{foundRoute.driver_name}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-500 mb-1">Veículo</p>
                                                <p className="font-medium text-gray-900">{foundRoute.vehicle_info}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-500 mb-1">Pedidos</p>
                                                <p className="font-medium text-gray-900">{foundRoute.route_orders?.length || 0} pedido(s)</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-500 mb-1">Criada em</p>
                                                <p className="font-medium text-gray-900">{new Date(foundRoute.created_at).toLocaleDateString('pt-BR')}</p>
                                            </div>
                                            {foundRoute.observations && (
                                                <div>
                                                    <p className="text-xs text-gray-500 mb-1">Observações</p>
                                                    <p className="font-medium text-gray-900 text-sm">{foundRoute.observations}</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Action Buttons */}
                                        {foundRoute.status === 'in_progress' && (
                                            <div className="flex gap-3">
                                                <button
                                                    onClick={() => changeRouteStatus(foundRoute.id, 'pending')}
                                                    disabled={routeChanging}
                                                    className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 font-medium disabled:opacity-50 transition-colors"
                                                >
                                                    {routeChanging ? (
                                                        <RefreshCw className="animate-spin h-4 w-4" />
                                                    ) : (
                                                        <ArrowLeft className="h-4 w-4" />
                                                    )}
                                                    Voltar para Separação
                                                </button>
                                            </div>
                                        )}

                                        {foundRoute.status === 'pending' && (
                                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                                <p className="text-sm text-yellow-800">✅ Esta rota já está em separação.</p>
                                            </div>
                                        )}

                                        {foundRoute.status === 'completed' && (
                                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                                                <p className="text-sm text-gray-600">🔒 Rotas finalizadas não podem ter o status alterado.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
