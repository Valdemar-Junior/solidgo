import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../supabase/client';
import type { RouteWithDetails } from '../../types/database';
import { Truck, MapPin, Package, Clock, Users, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function DriverDashboard() {
  const { user, logout } = useAuthStore();
  const [routes, setRoutes] = useState<RouteWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadDriverRoutes();
  }, [user?.id]);

  const loadDriverRoutes = async () => {
    if (!user?.id) return;

    try {
      setLoading(true);
      
      // Get driver ID from user ID
      const { data: driverData } = await supabase
        .from('drivers')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (driverData) {
        // Get routes assigned to this driver
      const { data: routesData } = await supabase
        .from('routes')
        .select('*, vehicle:vehicles!vehicle_id(*)')
        .eq('driver_id', driverData.id)
        .order('created_at', { ascending: false });

        if (routesData) {
          setRoutes(routesData as RouteWithDetails[]);
        }
      }
    } catch (error) {
      console.error('Error loading driver routes:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Pendente';
      case 'in_progress':
        return 'Em Rota';
      case 'completed':
        return 'Concluída';
      default:
        return status;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Truck className="h-12 w-12 text-blue-600 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-600">Carregando rotas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Minhas Rotas
              </h1>
              <p className="text-gray-600 mt-1">
                Bem-vindo, {user?.name || user?.email}
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">Motorista</span>
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
            <Truck className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Nenhuma rota atribuída
            </h3>
            <p className="text-gray-600">
              Você não tem rotas atribuídas no momento. Entre em contato com o administrador.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {routes.map((route) => (
              <div key={route.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center">
                    <MapPin className="h-5 w-5 text-blue-600 mr-2" />
                    <h3 className="text-lg font-semibold text-gray-900">
                      {route.name}
                    </h3>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(route.status)}`}>
                    {getStatusText(route.status)}
                  </span>
                </div>

                <div className="space-y-3 mb-6">
                  <div className="flex items-center text-sm text-gray-600">
                    <Truck className="h-4 w-4 mr-2" />
                    <span>
                      {route.vehicle?.model} - {route.vehicle?.plate}
                    </span>
                  </div>
                  
                  {route.conferente && (
                    <div className="flex items-center text-sm text-gray-600">
                      <Users className="h-4 w-4 mr-2" />
                      <span>Conferente: {route.conferente}</span>
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
                  onClick={() => navigate(`/driver/route/${route.id}`)}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Ver Rota
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
