import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../supabase/client';
import type { DashboardMetrics } from '../../types/database';
import { BarChart3, Package, Truck, Users, FileText, Settings, RefreshCw, LogOut } from 'lucide-react';

export default function AdminDashboard() {
  const { user, logout } = useAuthStore();
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    total_routes_today: 0,
    pending_deliveries: 0,
    completed_deliveries: 0,
    success_rate: 0,
    expired_returns: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      // Get today's date
      const today = new Date().toISOString().split('T')[0];
      
      // Count routes created today
      const { count: routesCount } = await supabase
        .from('routes')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today);

      // Count pending deliveries (route_orders with status pending)
      const { count: pendingCount } = await supabase
        .from('route_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      // Count completed deliveries today
      const { count: completedCount } = await supabase
        .from('route_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'delivered')
        .gte('delivered_at', today);

      // Calculate success rate (completed / total)
      const { count: totalCount } = await supabase
        .from('route_orders')
        .select('*', { count: 'exact', head: true });

      const successRate = totalCount && totalCount > 0 
        ? Math.round((completedCount || 0) / totalCount * 100)
        : 0;

      // Count expired returns
      const { count: expiredCount } = await supabase
        .from('route_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'returned');

      setMetrics({
        total_routes_today: routesCount || 0,
        pending_deliveries: pendingCount || 0,
        completed_deliveries: completedCount || 0,
        success_rate: successRate,
        expired_returns: expiredCount || 0,
      });
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const navigationItems = [
    {
      title: 'Pedidos',
      description: 'Importar e gerenciar pedidos',
      icon: Package,
      href: '/admin/orders',
      color: 'bg-blue-500',
    },
    {
      title: 'Rotas',
      description: 'Criar e gerenciar rotas',
      icon: Truck,
      href: '/admin/routes',
      color: 'bg-green-500',
    },
    {
      title: 'Motoristas',
      description: 'Gerenciar motoristas',
      icon: Users,
      href: '/admin/drivers',
      color: 'bg-purple-500',
    },
    {
      title: 'Relatórios',
      description: 'Ver relatórios e métricas',
      icon: BarChart3,
      href: '/admin/reports',
      color: 'bg-orange-500',
    },
    {
      title: 'Romaneios',
      description: 'Gerar romaneios em PDF',
      icon: FileText,
      href: '/admin/delivery-sheets',
      color: 'bg-red-500',
    },
    {
      title: 'Configurações',
      description: 'Configurar sistema',
      icon: Settings,
      href: '/admin/settings',
      color: 'bg-gray-500',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Painel Administrativo
              </h1>
              <p className="text-gray-600 mt-1">
                Bem-vindo, {user?.name || user?.email}
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">Admin</span>
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
        {/* Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="bg-blue-100 p-2 rounded-lg">
                <Truck className="h-6 w-6 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Rotas Hoje</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : metrics.total_routes_today}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="bg-yellow-100 p-2 rounded-lg">
                <Package className="h-6 w-6 text-yellow-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Pendentes</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : metrics.pending_deliveries}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="bg-green-100 p-2 rounded-lg">
                <BarChart3 className="h-6 w-6 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Concluídas</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : metrics.completed_deliveries}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="bg-purple-100 p-2 rounded-lg">
                <BarChart3 className="h-6 w-6 text-purple-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Taxa Sucesso</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : `${metrics.success_rate}%`}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="bg-red-100 p-2 rounded-lg">
                <Package className="h-6 w-6 text-red-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Retornos</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : metrics.expired_returns}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mb-8">
          <div className="flex space-x-4">
            <Link
              to="/admin/orders"
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center"
            >
              <Package className="h-5 w-5 mr-2" />
              Importar Pedidos
            </Link>
            <Link
              to="/admin/routes"
              className="bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center"
            >
              <Truck className="h-5 w-5 mr-2" />
              Criar Rota
            </Link>
            <button
              onClick={() => window.location.reload()}
              className="bg-gray-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-700 transition-colors flex items-center"
            >
              <RefreshCw className="h-5 w-5 mr-2" />
              Atualizar
            </button>
          </div>
        </div>

        {/* Navigation Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {navigationItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6 group"
            >
              <div className="flex items-center">
                <div className={`${item.color} p-3 rounded-lg group-hover:scale-110 transition-transform`}>
                  <item.icon className="h-6 w-6 text-white" />
                </div>
                <div className="ml-4 flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-gray-600 text-sm mt-1">
                    {item.description}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
