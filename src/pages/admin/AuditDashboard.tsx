
import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabase/client';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, AlertOctagon, RefreshCw, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function AuditDashboard() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true); // Only for initial load
    const [isRefreshing, setIsRefreshing] = useState(false); // For background/manual updates
    const [counts, setCounts] = useState({
        stuck_orders: 0,
        duplicates: 0,
        missing_assembly: 0,
        ghost_routes: 0
    });

    const [details, setDetails] = useState<any[] | null>(null);
    const [activeCheck, setActiveCheck] = useState<string | null>(null);

    useEffect(() => {
        runChecks(true); // Initial load = true

        // Realtime Subscription
        const channel = supabase
            .channel('audit-dashboard-changes')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'orders' },
                () => { console.log('Change in orders'); runChecks(false); } // Background = false
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'route_orders' },
                () => { console.log('Change in route_orders'); runChecks(false); }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'routes' },
                () => { console.log('Change in routes'); runChecks(false); }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const runChecks = async (isInitial = false) => {
        if (isInitial) setLoading(true);
        else setIsRefreshing(true);

        try {
            // 1. Check Stuck Orders (Visual Check)
            const { data: stuckData } = await supabase
                .from('orders')
                .select('id, route_orders!inner(route:routes(status))')
                .eq('status', 'assigned')
                .eq('route_orders.route.status', 'completed');

            // 2. Check Duplicates (RPC)
            const { data: dupOrders } = await supabase.rpc('get_duplicate_orders');
            const { data: dupRoutes } = await supabase.rpc('get_route_duplicates');

            // 3. Check Missing Assembly (RPC)
            const { data: missingAssembly } = await supabase.rpc('get_missing_assembly_orders');

            setCounts({
                stuck_orders: stuckData ? stuckData.length : 0,
                duplicates: (dupOrders?.length || 0) + (dupRoutes?.length || 0),
                missing_assembly: missingAssembly ? missingAssembly.length : 0,
                ghost_routes: 0
            });

        } catch (error) {
            console.error('Audit Check Failed', error);
            // Only show toast error on manual refresh to avoid spamming on background updates
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

        // Fetch BOTH types of duplicates
        const { data: dupOrders } = await supabase.rpc('get_duplicate_orders');
        const { data: dupRoutes } = await supabase.rpc('get_route_duplicates');

        const combined = [];

        // Formatting ERP Duplicates
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

        // Formatting Route Duplicates
        if (dupRoutes && dupRoutes.length > 0) {
            combined.push(...dupRoutes.map((r: any) => {
                // Determine status severity
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
                    routes: r.routes_info // Pass full route info
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
                    status: 'pending', // Libera para nova rota
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
            // Filter only assemble-able items
            const assemblyItems = items.filter((i: any) =>
                i.produto_e_montavel === 'Sim' ||
                i.categoria_do_produto?.toLowerCase().includes('montagem')
            ).map((i: any) => ({
                order_id: orderId,
                product_id: i.id_produto || i.codigo_produto, // Fallback
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

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50/50">
            {/* Header Simplificado copiando estilo do Dashboard */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/admin')}
                        className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
                        title="Voltar"
                    >
                        <ArrowLeft className="text-xl" />
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="bg-red-100 p-2 rounded-lg">
                            <AlertOctagon className="h-6 w-6 text-red-600" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">Auditoria do Sistema</h1>
                            <p className="text-sm text-gray-500">Ferramentas de Correção</p>
                        </div>
                    </div>
                </div>

                <button
                    onClick={() => runChecks(false)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors font-medium text-sm"
                    disabled={isRefreshing}
                >
                    <RefreshCw className={isRefreshing ? "animate-spin" : ""} />
                    Atualizar Dados
                </button>
            </header>

            <div className="w-full p-6 md:p-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {/* CARD 1: PEDIDOS TRAVADOS */}
                    <div
                        onClick={showStuckOrders}
                        className={`p-6 rounded-xl shadow-sm border cursor-pointer transition-all hover:translate-y-1 hover:shadow-md ${counts.stuck_orders > 0
                            ? 'bg-red-50 border-red-200'
                            : 'bg-white border-gray-100'
                            }`}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Inconsistências</p>
                                <h3 className="font-bold text-xl text-gray-800 mt-1">Pedidos Travados</h3>
                            </div>
                            {counts.stuck_orders > 0 ? (
                                <div className="bg-red-100 p-2 rounded-full"><AlertTriangle className="text-red-500 text-xl" /></div>
                            ) : (
                                <div className="bg-green-100 p-2 rounded-full"><CheckCircle2 className="text-green-500 text-xl" /></div>
                            )}
                        </div>

                        <div className="flex items-baseline">
                            <p className={`text-4xl font-bold ${counts.stuck_orders > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                                {counts.stuck_orders}
                            </p>
                            <span className="ml-2 text-sm text-gray-500">pedidos afetados</span>
                        </div>

                        <p className="text-sm mt-4 text-gray-600 leading-relaxed">
                            Pedidos marcados como "Em Rota" mas vinculados a rotas já finalizadas.
                        </p>

                        {counts.stuck_orders > 0 && (
                            <div className="mt-4 pt-4 border-t border-red-100 flex items-center text-red-600 text-sm font-medium">
                                Clique para resolver <span className="ml-auto">&rarr;</span>
                            </div>
                        )}
                    </div>

                    {/* CARD 2: DUPLICIDADES */}
                    <div
                        onClick={showDuplicates}
                        className={`p-6 rounded-xl shadow-sm border cursor-pointer transition-all hover:translate-y-1 hover:shadow-md ${counts.duplicates > 0
                            ? 'bg-amber-50 border-amber-200'
                            : 'bg-white border-gray-100'
                            }`}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Integridade de Dados</p>
                                <h3 className="font-bold text-xl text-gray-800 mt-1">Duplicidades</h3>
                            </div>
                            {counts.duplicates > 0 ? (
                                <div className="bg-amber-100 p-2 rounded-full"><AlertTriangle className="text-amber-500 text-xl" /></div>
                            ) : (
                                <div className="bg-green-100 p-2 rounded-full"><CheckCircle2 className="text-green-500 text-xl" /></div>
                            )}
                        </div>
                        <div className="flex items-baseline">
                            <p className={`text-4xl font-bold ${counts.duplicates > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
                                {counts.duplicates}
                            </p>
                            <span className="ml-2 text-sm text-gray-500">casos detectados</span>
                        </div>
                        <p className="text-sm mt-4 text-gray-600 leading-relaxed">
                            Pedidos duplicados no banco de dados ou roteirizados em múltiplas rotas ativas.
                        </p>
                        {counts.duplicates > 0 && (
                            <div className="mt-4 pt-4 border-t border-amber-100 flex items-center text-amber-600 text-sm font-medium">
                                Clique para resolver <span className="ml-auto">&rarr;</span>
                            </div>
                        )}
                    </div>

                    {/* CARD 3: MONTAGEM PENDENTE */}
                    <div
                        onClick={showMissingAssembly}
                        className={`p-6 rounded-xl shadow-sm border cursor-pointer transition-all hover:translate-y-1 hover:shadow-md ${counts.missing_assembly > 0
                            ? 'bg-purple-50 border-purple-200'
                            : 'bg-white border-gray-100'
                            }`}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Pós-venda</p>
                                <h3 className="font-bold text-xl text-gray-800 mt-1">Montagem Pendente</h3>
                            </div>
                            {counts.missing_assembly > 0 ? (
                                <div className="bg-purple-100 p-2 rounded-full"><AlertTriangle className="text-purple-500 text-xl" /></div>
                            ) : (
                                <div className="bg-green-100 p-2 rounded-full"><CheckCircle2 className="text-green-500 text-xl" /></div>
                            )}
                        </div>
                        <div className="flex items-baseline">
                            <p className={`text-4xl font-bold ${counts.missing_assembly > 0 ? 'text-purple-600' : 'text-gray-900'}`}>
                                {counts.missing_assembly}
                            </p>
                            <span className="ml-2 text-sm text-gray-500">pedidos sem montagem</span>
                        </div>
                        <p className="text-sm mt-4 text-gray-600 leading-relaxed">
                            Pedidos entregues c/ montagem que não geraram lista para montadores.
                        </p>
                        {counts.missing_assembly > 0 && (
                            <div className="mt-4 pt-4 border-t border-purple-100 flex items-center text-purple-600 text-sm font-medium">
                                Clique para resolver <span className="ml-auto">&rarr;</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* DETAILS SECTION */}
                {details && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-fade-in">
                        <div className="bg-gray-50/50 px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                            <h2 className="font-semibold text-gray-800 flex items-center gap-2">

                                {activeCheck === 'stuck' && <AlertTriangle className="text-red-500" />}
                                {activeCheck === 'duplicate' && <AlertTriangle className="text-amber-500" />}
                                {activeCheck === 'assembly' && <AlertTriangle className="text-purple-500" />}
                                {activeCheck === 'stuck' ? 'Pedidos Travados - Lista de Resolução' :
                                    activeCheck === 'duplicate' ? 'Duplicidades Detectadas' :
                                        activeCheck === 'assembly' ? 'Montagens Pendentes (Furo de Processo)' : 'Detalhes'}
                            </h2>
                            <button onClick={() => setDetails(null)} className="text-gray-400 hover:text-gray-600"><span className="sr-only">Fechar</span>×</button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-gray-100/50 text-gray-500 text-xs font-semibold uppercase tracking-wider">
                                        <th className="p-4">
                                            {activeCheck === 'duplicate' ? 'Info Duplicidade' : 'Pedido ERP'}
                                        </th>
                                        <th className="p-4">
                                            {activeCheck === 'duplicate' ? 'Ocorrências' : 'Cliente'}
                                        </th>
                                        <th className="p-4">
                                            {activeCheck === 'duplicate' ? 'IDs Internos' : 'Detalhes / Rota'}
                                        </th>
                                        <th className="p-4 text-right">Ação Corretiva</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {details.map((item: any, idx) => (
                                        <tr key={item.id || idx} className="hover:bg-blue-50/50 transition-colors group">
                                            <td className="p-4 font-medium text-gray-900">
                                                {activeCheck === 'duplicate' ? item.title : item.order_id_erp}
                                            </td>
                                            <td className="p-4 text-gray-600">
                                                {activeCheck === 'duplicate'
                                                    ? `${item.count} registros encontrados`
                                                    : item.client_name}
                                            </td>
                                            <td className="p-4 text-sm text-gray-500">
                                                {activeCheck === 'duplicate' ? (
                                                    <div className="flex flex-col gap-1">
                                                        {item.type === 'duplicate_route' && item.routes ? (
                                                            // Show detailed route info
                                                            item.routes.map((rt: any, i: number) => (
                                                                <div key={i} className="flex items-center gap-2 text-xs">
                                                                    <span className={`px-1.5 py-0.5 rounded border ${['pending', 'in_progress', 'ready'].includes(rt.status)
                                                                        ? 'bg-green-50 border-green-200 text-green-700 font-medium'
                                                                        : 'bg-gray-50 border-gray-200 text-gray-500'
                                                                        }`}>
                                                                        {rt.status === 'in_progress' ? 'Ativa' : rt.status === 'completed' ? 'Finalizada' : rt.status}
                                                                    </span>
                                                                    {rt.order_status && (
                                                                        <span className={`px-1.5 py-0.5 rounded border text-[10px] uppercase ${rt.order_status === 'returned' ? 'bg-red-50 border-red-200 text-red-600' :
                                                                            rt.order_status === 'delivered' ? 'bg-blue-50 border-blue-200 text-blue-600' :
                                                                                'bg-gray-100 border-gray-200 text-gray-500'
                                                                            }`}>
                                                                            {rt.order_status === 'returned' ? 'Devolvido' : rt.order_status === 'delivered' ? 'Entregue' : rt.order_status}
                                                                        </span>
                                                                    )}
                                                                    <span className="truncate max-w-[200px]" title={rt.name}>{rt.name}</span>
                                                                </div>
                                                            ))
                                                        ) : (
                                                            // Show internal IDs for ERP duplicates
                                                            item.ids?.map((id: string) => (
                                                                <span key={id} className="text-xs bg-gray-100 text-gray-600 px-1 rounded block truncate w-24">{id.slice(0, 8)}...</span>
                                                            ))
                                                        )}
                                                        {item.details && <span className="text-xs italic text-gray-400 mt-1">{item.details}</span>}
                                                    </div>
                                                ) : activeCheck === 'assembly' ? (
                                                    <span className="text-xs">Entrega: {item.delivery_date}</span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                                        {item.route_orders && item.route_orders[0]?.route?.name}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-4 text-right flex justify-end gap-3 opacity-90 group-hover:opacity-100">
                                                {activeCheck === 'stuck' && (
                                                    <>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); resolveStuckOrder(item.id, 'delivered'); }}
                                                            className="px-3 py-1.5 bg-green-50 text-green-700 rounded-md hover:bg-green-100 border border-green-200 text-sm font-medium transition-colors"
                                                        >
                                                            Confirmar Entrega
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); resolveStuckOrder(item.id, 'returned'); }}
                                                            className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-md hover:bg-amber-100 border border-amber-200 text-sm font-medium transition-colors"
                                                        >
                                                            Registrar Devolução
                                                        </button>
                                                    </>
                                                )}

                                                {activeCheck === 'assembly' && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); generateAssembly(item.id, item.items_json); }}
                                                        className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-md hover:bg-purple-100 border border-purple-200 text-sm font-medium transition-colors flex items-center gap-2"
                                                    >
                                                        <RefreshCw className="w-4 h-4" />
                                                        Gerar Montagem
                                                    </button>
                                                )}

                                                {activeCheck === 'duplicate' && (
                                                    <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                                                        Ação Manual Necessária (Contate Suporte)
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {details.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="p-12 text-center text-gray-500 flex flex-col items-center justify-center">
                                                <div className="bg-green-50 p-4 rounded-full mb-3">
                                                    <CheckCircle2 className="text-3xl text-green-500" />
                                                </div>
                                                <p className="font-medium text-gray-900">Nenhuma inconsistência encontrada</p>
                                                <p className="text-sm mt-1">Tudo certo com {activeCheck === 'stuck' ? 'os pedidos travados' : activeCheck === 'assembly' ? 'as montagens' : 'as duplicidades'}!</p>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
