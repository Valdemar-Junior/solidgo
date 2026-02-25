import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../supabase/client';
import type { DashboardMetrics } from '../../types/database';
import {
  BarChart3,
  Package,
  Truck,
  Users,
  Settings,
  LogOut,
  Hammer,
  UserCircle,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Bell,
  Search,
  AlertOctagon,
  BookOpen
} from 'lucide-react';

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
      const today = new Date().toISOString().split('T')[0];

      const { count: routesCount } = await supabase
        .from('routes')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today);

      const { count: pendingCount } = await supabase
        .from('route_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: completedCount } = await supabase
        .from('route_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'delivered')
        .gte('delivered_at', today);

      const { count: totalCount } = await supabase
        .from('route_orders')
        .select('*', { count: 'exact', head: true });

      const successRate = totalCount && totalCount > 0
        ? Math.round((completedCount || 0) / totalCount * 100)
        : 0;

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
      color: 'bg-blue-600',
      gradient: 'from-blue-500 to-blue-600',
    },
    {
      title: 'Consulta de Pedido',
      description: 'Pesquisar pedido e acompanhar status',
      icon: Search,
      href: '/admin/order-lookup',
      color: 'bg-indigo-600',
      gradient: 'from-indigo-500 to-indigo-600',
    },
    {
      title: 'Gestão de Entregas',
      description: 'Criar e gerenciar rotas de entrega',
      icon: Truck,
      href: '/admin/routes',
      color: 'bg-teal-600',
      gradient: 'from-teal-500 to-teal-600',
    },
    {
      title: 'Gestão de Montagem',
      description: 'Gerenciar romaneios e montagem',
      icon: Hammer,
      href: '/admin/assembly',
      color: 'bg-purple-600',
      gradient: 'from-purple-500 to-purple-600',
    },
    {
      title: 'Relatórios',
      description: 'Ver relatórios e métricas',
      icon: BarChart3,
      href: '/admin/reports',
      color: 'bg-orange-600',
      gradient: 'from-orange-500 to-orange-600',
    },
    {
      title: 'Cadastros',
      description: 'Cadastrar usuários, ajudantes, equipes e rotas',
      icon: Users,
      href: '/admin/users-teams',
      color: 'bg-violet-600',
      gradient: 'from-violet-500 to-violet-600',
    },
    {
      title: 'Configurações',
      description: 'Configurar sistema',
      icon: Settings,
      href: '/admin/settings',
      color: 'bg-gray-700',
      gradient: 'from-gray-600 to-gray-700',
    },
    {
      title: 'Auditoria',
      description: 'Verificar inconsistências',
      icon: AlertOctagon,
      href: '/admin/audit',
      color: 'bg-red-600',
      gradient: 'from-red-500 to-red-600',
    },
    {
      title: 'Diário de Bordo',
      description: 'Registrar ocorrências e notas',
      icon: BookOpen,
      href: '/admin/diary',
      color: 'bg-emerald-600',
      gradient: 'from-emerald-500 to-emerald-600',
    },
  ];

  const StatCard = ({ title, value, icon: Icon, colorClass, gradientClass }: any) => (
    <div className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-all duration-300 border border-gray-100">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{loading ? '...' : value}</p>
        </div>
        <div className={`p-3 rounded-xl bg-gradient-to-br ${gradientClass} shadow-sm`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
    </div>
  );

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-8">

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          title="Rotas Hoje"
          value={metrics.total_routes_today}
          icon={Truck}
          gradientClass="from-blue-500 to-blue-600"
        />
        <StatCard
          title="Pendentes"
          value={metrics.pending_deliveries}
          icon={Package}
          gradientClass="from-yellow-400 to-orange-500"
        />
        <StatCard
          title="Concluídas"
          value={metrics.completed_deliveries}
          icon={CheckCircle2}
          gradientClass="from-green-500 to-emerald-600"
        />
        <StatCard
          title="Taxa Sucesso"
          value={`${metrics.success_rate}%`}
          icon={TrendingUp}
          gradientClass="from-purple-500 to-indigo-600"
        />
        <StatCard
          title="Retornos"
          value={metrics.expired_returns}
          icon={AlertTriangle}
          gradientClass="from-red-500 to-rose-600"
        />
      </div>

      {/* Feature Navigation Grid */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Acesso Rápido</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {navigationItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="group relative bg-white rounded-2xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 hover:-translate-y-1 overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <item.icon className="h-24 w-24 text-gray-900 transform rotate-12 translate-x-4 -translate-y-4" />
              </div>

              <div className="relative flex items-start space-x-4">
                <div className={`p-3 rounded-xl bg-gradient-to-br ${item.gradient} shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                  <item.icon className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1 pt-1">
                  <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>

              <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                  Acessar &rarr;
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

    </main>
  );
}
