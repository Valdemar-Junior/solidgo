import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../supabase/client';
import { Truck, MapPin, Clock, Users, LogOut, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function AssemblyDashboard() {
  const { user, logout } = useAuthStore();
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadAssemblyRoutes();
  }, [user?.id]);

  const loadAssemblyRoutes = async () => {
    if (!user?.id) return;

    try {
      setLoading(true);

      // Buscar produtos atribuídos ao montador
      const { data: prodData, error } = await supabase
        .from('assembly_products')
        .select(`
          assembly_route_id,
          route:assembly_route_id (
              *,
              vehicle:vehicles!vehicle_id(*)
          )
        `)
        .eq('installer_id', user.id);

      if (error) throw error;

      // Agrupar rotas únicas
      const routeMap = new Map();
      if (prodData) {
        prodData.forEach((item: any) => {
          if (item.route && !routeMap.has(item.route.id)) {
            routeMap.set(item.route.id, item.route);
          }
        });
      }

      const uniqueRoutes = Array.from(routeMap.values());
      // Ordenar por data (mais recente primeiro)
      uniqueRoutes.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setRoutes(uniqueRoutes);

    } catch (error) {
      console.error('Error loading assembly routes:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return 'Pendente';
      case 'in_progress': return 'Em Andamento';
      case 'completed': return 'Concluída';
      default: return status;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Truck className="h-12 w-12 text-indigo-600 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-600">Carregando rotas de montagem...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  Minhas Montagens
                </h1>
                <p className="text-gray-600 mt-1">
                  Bem-vindo, {user?.name || user?.email}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="bg-indigo-100 text-indigo-800 px-3 py-1 rounded-full text-sm font-medium">Montador</span>
              <button
                onClick={async () => { await logout(); window.location.href = '/login'; }}
                className="inline-flex items-center px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 border border-gray-300"
              >
                <LogOut className="h-4 w-4 mr-2" /> Sair
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {routes.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Nenhuma montagem atribuída
            </h3>
            <p className="text-gray-600">
              Você não tem montagens pendentes no momento.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {routes.map((route) => (
              <div key={route.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center">
                    <MapPin className="h-5 w-5 text-indigo-600 mr-2" />
                    <h3 className="text-lg font-semibold text-gray-900">
                      {route.name}
                    </h3>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(route.status)}`}>
                    {getStatusText(route.status)}
                  </span>
                </div>

                <div className="space-y-3 mb-6">
                  {route.vehicle && (
                    <div className="flex items-center text-sm text-gray-600">
                      <Truck className="h-4 w-4 mr-2" />
                      <span>
                        {route.vehicle.model} - {route.vehicle.plate}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center text-sm text-gray-600">
                    <Clock className="h-4 w-4 mr-2" />
                    <span>
                      Criado em: {new Date(route.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => navigate(`/montador/route/${route.id}`)}
                  className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm"
                >
                  Abrir Rota de Montagem
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
