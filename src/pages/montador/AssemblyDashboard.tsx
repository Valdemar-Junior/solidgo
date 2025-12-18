import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { toast } from 'sonner';
import { Package, MapPin, Clock, Phone, ArrowLeft, Truck } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

type AssemblyRoute = {
  id: string;
  name: string;
  deadline?: string | null;
  observations?: string | null;
  status: string;
  assembler_id?: string | null;
  vehicle_id?: string | null;
};

type AssemblyProduct = {
  id: string;
  assembly_route_id: string | null;
  order_id: string | null;
  product_name: string;
  product_sku?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  installation_address?: any;
  installer_id?: string | null;
  status: string;
  assembly_date?: string | null;
  completion_date?: string | null;
  observations?: string | null;
  order?: any;
  route?: AssemblyRoute;
};

type OrderGroup = {
  orderId: string;
  orderIdErp: string;
  customer: string;
  phone: string;
  address: string;
  items: AssemblyProduct[];
  status: string;
};

export default function AssemblyDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [products, setProducts] = useState<AssemblyProduct[]>([]);
  const [routes, setRoutes] = useState<AssemblyRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const { data: prodData, error } = await supabase
        .from('assembly_products')
        .select(`
          *,
          order:order_id (*),
          route:assembly_route_id (*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // filtrar produtos do montador logado
      const userId = user?.id;
      const mine = (prodData || []).filter((p: any) => !userId || p.installer_id === userId);
      setProducts(mine as AssemblyProduct[]);

      // rotas distintas
      const routeMap = new Map<string, AssemblyRoute>();
      mine.forEach((p: any) => {
        if (p.route) routeMap.set(p.route.id, p.route as AssemblyRoute);
      });
      const routeList = Array.from(routeMap.values());
      setRoutes(routeList);
      if (!selectedRouteId && routeList.length > 0) setSelectedRouteId(routeList[0].id);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao carregar montagem');
    } finally {
      setLoading(false);
    }
  };

  const groups = useMemo(() => {
    if (!selectedRouteId) return [];
    const grouped = new Map<string, OrderGroup>();
    products
      .filter((p) => p.assembly_route_id === selectedRouteId)
      .forEach((p) => {
        const o = p.order || {};
        const oid = String(o.id || p.order_id || p.id);
        if (!grouped.has(oid)) {
          const addr = typeof o.address_json === 'string' ? JSON.parse(o.address_json) : o.address_json || {};
          const num = addr.number ? `, ${addr.number}` : '';
          const address = `${addr.street || ''}${num} - ${addr.neighborhood || ''}${addr.city ? ', ' + addr.city : ''}`.trim();
          grouped.set(oid, {
            orderId: oid,
            orderIdErp: String(o.order_id_erp || ''),
            customer: String(o.customer_name || ''),
            phone: String(o.phone || ''),
            address,
            items: [],
            status: 'pending',
          });
        }
        grouped.get(oid)!.items.push(p);
      });

    // derivar status por pedido
    grouped.forEach((g) => {
      const statuses = g.items.map((i) => i.status);
      if (statuses.every((s) => s === 'cancelled')) g.status = 'cancelled';
      else if (statuses.every((s) => s === 'completed')) g.status = 'completed';
      else if (statuses.some((s) => s === 'in_progress')) g.status = 'pending';
      else g.status = 'pending';
    });

    return Array.from(grouped.values());
  }, [products, selectedRouteId]);

  const summary = useMemo(() => {
    const total = groups.reduce((acc, g) => acc + g.items.length, 0);
    const completed = groups.filter((g) => g.status === 'completed').length;
    const pending = groups.filter((g) => g.status === 'pending' || g.status === 'in_progress').length;
    const cancelled = groups.filter((g) => g.status === 'cancelled').length;
    return { total, completed, pending, cancelled };
  }, [groups]);

  const [processingOrders, setProcessingOrders] = useState<Set<string>>(new Set());

  const updateOrderStatus = async (orderId: string, action: 'complete' | 'return') => {
    try {
      setProcessingOrders(prev => new Set(prev).add(orderId));
      const now = new Date().toISOString();
      const items = products.filter(
        (p) => p.order_id === orderId && p.assembly_route_id === selectedRouteId
      );
      if (items.length === 0) throw new Error('Pedido não encontrado na rota');

      if (action === 'complete') {
        const { error } = await supabase
          .from('assembly_products')
          .update({ status: 'completed', completion_date: now })
          .eq('order_id', orderId)
          .eq('assembly_route_id', selectedRouteId);
        if (error) throw error;
        toast.success('Pedido montado');
      } else {
        // Marca histórico na rota como "retornado"
        const { error } = await supabase
          .from('assembly_products')
          .update({
            status: 'cancelled',
            assembly_date: null,
            completion_date: null,
          })
          .eq('order_id', orderId)
          .eq('assembly_route_id', selectedRouteId);
        if (error) throw error;

        // Garantir registro pendente sem rota (reutiliza se já houver, senão cria)
        const pendingClone = items.find((it) => !it.assembly_route_id && it.status === 'pending');
        if (!pendingClone) {
          const clones = items.map((it) => ({
            assembly_route_id: null,
            order_id: it.order_id,
            product_name: it.product_name,
            product_sku: it.product_sku,
            customer_name: it.customer_name,
            customer_phone: it.customer_phone,
            installation_address: it.installation_address,
            installer_id: null,
            status: 'pending',
            observations: it.observations,
          }));
          if (clones.length) {
            const { error: insErr } = await supabase.from('assembly_products').insert(clones);
            if (insErr) throw insErr;
          }
        } else {
          await supabase
            .from('assembly_products')
            .update({ status: 'pending', assembly_route_id: null })
            .eq('id', pendingClone.id);
        }
        toast.success('Pedido retornado e liberado para nova rota');
      }
      await loadData();
    } catch (e) {
      console.error(e);
      toast.error('Erro ao atualizar pedido');
    } finally {
      setProcessingOrders(prev => {
        const n = new Set(prev);
        n.delete(orderId);
        return n;
      });
    }
  };

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) || null;

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <p className="text-xs text-gray-500">Montador</p>
              <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Package className="h-5 w-5 text-indigo-600" />
                {selectedRoute ? selectedRoute.name : 'Suas rotas'}
              </h1>
              <p className="text-xs text-gray-500">{user.name || user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedRoute && (
              <span className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 flex items-center gap-1">
                <Clock className="h-3 w-3" /> {selectedRoute.deadline ? new Date(selectedRoute.deadline).toLocaleDateString('pt-BR') : 'Sem prazo'}
              </span>
            )}
            <button onClick={async()=>{ try{ await supabase.auth.signOut({scope:'local'}); }catch{} navigate('/login'); }} className="text-sm px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Sair</button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {routes.length > 1 && (
          <div className="bg-white rounded-lg border shadow-sm p-3 flex gap-2 overflow-x-auto">
            {routes.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedRouteId(r.id)}
                className={`px-3 py-2 rounded-lg text-sm border ${selectedRouteId === r.id ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-gray-50 text-gray-700 border-gray-200'}`}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}

        {selectedRoute && (
          <>
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-full bg-indigo-50 text-indigo-700"><Truck className="h-5 w-5" /></div>
                <div>
                  <p className="text-sm text-gray-500">Resumo</p>
                  <p className="text-lg font-bold text-gray-900">{summary.total} itens • {groups.length} pedidos</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-100">Concluídos: {summary.completed}</span>
                <span className="px-2 py-1 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-100">Pendentes: {summary.pending}</span>
                {summary.cancelled > 0 && (
                  <span className="px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-100">Retornados: {summary.cancelled}</span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.orderId} className="bg-white rounded-lg border shadow-sm p-3">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{g.customer}</p>
                      <p className="text-xs text-gray-500">Pedido {g.orderIdErp || g.orderId}</p>
                      <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                        <Phone className="h-3 w-3" /> {g.phone || '-'}
                      </div>
                      <div className="flex items-start gap-1 text-xs text-gray-500">
                        <MapPin className="h-3 w-3 mt-0.5" /> {g.address || '-'}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 text-xs">
                      <span className="px-2 py-1 rounded bg-gray-100 text-gray-800 border border-gray-200 text-center capitalize">
                        {g.status === 'cancelled' ? 'Retornado' : g.status === 'completed' ? 'Concluído' : 'Pendente'}
                      </span>
                      <button
                        onClick={() => updateOrderStatus(g.orderId, 'complete')}
                        disabled={processingOrders.has(g.orderId) || g.status === 'completed' || g.status === 'cancelled'}
                        className="px-2 py-1 rounded bg-green-50 text-green-700 border border-green-200 disabled:opacity-50"
                      >
                        {processingOrders.has(g.orderId) ? '...' : 'Concluir'}
                      </button>
                      <button
                        onClick={() => updateOrderStatus(g.orderId, 'return')}
                        disabled={processingOrders.has(g.orderId) || g.status === 'cancelled'}
                        className="px-2 py-1 rounded bg-red-50 text-red-700 border border-red-200 disabled:opacity-50"
                      >
                        {processingOrders.has(g.orderId) ? '...' : 'Retornar'}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-600">
                    <p className="font-semibold mb-1">Produtos</p>
                    <ul className="list-disc list-inside space-y-1">
                      {g.items.map((it) => (
                        <li key={it.id}>{it.product_sku || ''} - {it.product_name}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}

              {groups.length === 0 && (
                <div className="bg-white rounded-lg border shadow-sm p-4 text-center text-sm text-gray-500">
                  Nenhum pedido atribuído.
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
