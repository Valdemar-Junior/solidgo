
import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabase/client';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, AlertOctagon, RefreshCw, ArrowLeft, Search, Save, Truck, Hammer, History, ClipboardList, ShoppingBag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

type ActiveSection = 'geral' | 'venda';

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

    // States for Sales Audit
    const [searchOrderId, setSearchOrderId] = useState('');
    const [searchedOrder, setSearchedOrder] = useState<any | null>(null);
    const [searchLoading, setSearchLoading] = useState(false);
    const [editedOrder, setEditedOrder] = useState<any | null>(null);
    const [saving, setSaving] = useState(false);
    const [auditHistory, setAuditHistory] = useState<any[]>([]);

    useEffect(() => {
        runChecks(true);

        const channel = supabase
            .channel('audit-dashboard-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { runChecks(false); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'route_orders' }, () => { runChecks(false); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'routes' }, () => { runChecks(false); })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    const runChecks = async (isInitial = false) => {
        if (isInitial) setLoading(true);
        else setIsRefreshing(true);

        try {
            const { data: stuckData } = await supabase
                .from('orders')
                .select('id, route_orders!inner(route:routes(status))')
                .eq('status', 'assigned')
                .eq('route_orders.route.status', 'completed');

            const { data: dupOrders } = await supabase.rpc('get_duplicate_orders');
            const { data: dupRoutes } = await supabase.rpc('get_route_duplicates');
            const { data: missingAssembly } = await supabase.rpc('get_missing_assembly_orders');

            setCounts({
                stuck_orders: stuckData ? stuckData.length : 0,
                duplicates: (dupOrders?.length || 0) + (dupRoutes?.length || 0),
                missing_assembly: missingAssembly ? missingAssembly.length : 0,
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

    const showStuckOrders = async () => {
        setActiveCheck('stuck');
        const { data } = await supabase
            .from('orders')
            .select('*, route_orders!inner(route_id, status, route:routes(name, status))')
            .eq('status', 'assigned')
            .eq('route_orders.route.status', 'completed');
        setDetails(data || []);
    };

    const showDuplicates = async () => {
        setActiveCheck('duplicate');
        const { data: dupOrders } = await supabase.rpc('get_duplicate_orders');
        const { data: dupRoutes } = await supabase.rpc('get_route_duplicates');
        const combined: any[] = [];

        if (dupOrders && dupOrders.length > 0) {
            combined.push(...dupOrders.map((d: any) => ({
                id: d.order_id_erp,
                type: 'duplicate_erp',
                title: `Pedido ${d.order_id_erp} (Duplicidade no Banco)`,
                count: d.count,
                ids: d.ids,
                details: 'ID ERP aparece múltiplas vezes na tabela orders',
                routes: []
            })));
        }

        if (dupRoutes && dupRoutes.length > 0) {
            combined.push(...dupRoutes.map((r: any) => {
                const activeRoutes = r.routes_info.filter((rt: any) => ['pending', 'in_progress', 'ready'].includes(rt.status));
                const isCritical = activeRoutes.length > 1;
                return {
                    id: r.order_id,
                    type: 'duplicate_route',
                    title: `Pedido ${r.order_id_erp || '???'} (Múltiplas Rotas)`,
                    count: r.route_count,
                    ids: r.routes_info.map((rt: any) => rt.id),
                    client_name: r.client_name,
                    details: isCritical ? 'CRÍTICO: Em mais de uma rota ativa!' : 'Inconsistência: Verifique histórico de rotas.',
                    routes: r.routes_info
                };
            }));
        }

        setDetails(combined);
    };

    const showMissingAssembly = async () => {
        setActiveCheck('assembly');
        const { data } = await supabase.rpc('get_missing_assembly_orders');
        setDetails(data || []);
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
            const assemblyItems = items.filter((i: any) =>
                i.produto_e_montavel === 'Sim' ||
                i.categoria_do_produto?.toLowerCase().includes('montagem')
            ).map((i: any) => ({
                order_id: orderId,
                product_id: i.id_produto || i.codigo_produto,
                product_name: i.nome_do_produto || i.descricao_produto,
                status: 'pending'
            }));

            if (assemblyItems.length === 0) {
                toast.error("Nenhum item montável encontrado neste pedido.");
                return;
            }

            const { error } = await supabase.from('assembly_products').insert(assemblyItems);
            if (error) throw error;
            toast.success("Montagem gerada com sucesso!");
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
                .select('*')
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
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto">
                {/* Header */}
                <header className="bg-white border-b border-gray-200 sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gray-900">
                        {activeSection === 'geral' ? 'Auditoria Geral' : 'Auditoria de Venda'}
                    </h2>
                    {activeSection === 'geral' && (
                        <button
                            onClick={() => runChecks(false)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors font-medium text-sm"
                            disabled={isRefreshing}
                        >
                            <RefreshCw className={isRefreshing ? "animate-spin h-4 w-4" : "h-4 w-4"} />
                            Atualizar
                        </button>
                    )}
                </header>

                <div className="p-6">
                    {/* AUDITORIA GERAL */}
                    {activeSection === 'geral' && (
                        <>
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
                                                {details.map((item: any, idx) => (
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
                                                ))}
                                                {details.length === 0 && (
                                                    <tr>
                                                        <td colSpan={4} className="p-12 text-center text-gray-500">
                                                            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
                                                            <p className="font-medium text-gray-900">Nenhuma inconsistência</p>
                                                        </td>
                                                    </tr>
                                                )}
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
                                                                value={item.has_assembly || 'Não'}
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
                </div>
            </main>
        </div>
    );
}
