import { useEffect, useState } from 'react';
import { supabase } from '../../supabase/client';
import { useAuthStore } from '../../stores/authStore';
import { Package, Eye, LogOut, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export default function ConferenteDashboard() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const { data } = await supabase
          .from('routes')
          .select('*, route_orders:route_orders(*, order:orders!order_id(*))')
          .or("status.eq.pending,status.eq.in_progress")
          .order('created_at', { ascending: false });
        const mine = (data || []).filter((r: any) => String(r.conferente || '').trim() === String(user?.name || '').trim());

        const routeIds = mine.map((r:any)=>r.id).filter(Boolean);
        if (routeIds.length > 0) {
          const { data: confBulk } = await supabase
            .from('route_conferences')
            .select('id, route_id, status, result_ok, started_at, finished_at, created_at')
            .in('route_id', routeIds)
            .order('created_at', { ascending: false });
          const mapConf = new Map<string, any>();
          (confBulk || []).forEach((c:any)=>{ const k = String(c.route_id); if (!mapConf.has(k)) mapConf.set(k, c); });
          mine.forEach((r:any)=>{ const c = mapConf.get(String(r.id)); if (c) r.conference = c; });
        }

        setRoutes(mine);
      } catch (e) {
        console.error(e);
        toast.error('Erro ao carregar rotas atribuídas');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center">
                <Package className="h-5 w-5 mr-2" />
                Rotas para Conferência
              </h1>
              <p className="text-sm text-gray-600">Bem-vindo, {user?.name || 'Conferente'}</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-medium">Conferente</span>
            <span className="text-sm text-gray-600">{routes.length} rota(s)</span>
            <button
              onClick={async () => { try { await logout(); window.location.assign('/login'); } catch {} }}
              className="inline-flex items-center px-3 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200"
            >
              <LogOut className="h-4 w-4 mr-1" /> Sair
            </button>
          </div>
        </div>
        {routes.length === 0 ? (
          <div className="text-gray-600">Nenhuma rota atribuída a você.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {routes.map((route: any) => {
              const total = route.route_orders?.length || 0;
              const pending = route.route_orders?.filter((r: any) => r.status === 'pending').length || 0;
              const delivered = route.route_orders?.filter((r: any) => r.status === 'delivered').length || 0;
              const conf = (route as any).conference;
              const statusText = conf ? (conf.status === 'in_progress' ? 'Em Conferência' : (conf.result_ok ? 'Conferência OK' : 'Conferência c/ divergência')) : (route.status === 'pending' ? 'Em Separação' : 'Em Rota');
              const statusClass = conf ? (conf.status === 'in_progress' ? 'bg-indigo-100 text-indigo-800' : (conf.result_ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')) : (route.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800');
              return (
                <div key={route.id} className="bg-white rounded-lg border hover:shadow transition p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{route.name}</h3>
                      <div className="mt-1 text-sm text-gray-700">Pedidos: {total} • Pendentes: {pending} • Entregues: {delivered}</div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClass}`}>{statusText}</span>
                  </div>
                  <button
                    onClick={() => {
                      navigate(`/conferente/route/${route.id}`)
                    }}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center"
                  >
                    <Eye className="h-4 w-4 mr-2" /> Abrir Conferência
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
