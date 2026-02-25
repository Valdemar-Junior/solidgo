import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  Truck,
  Package,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  Hammer,
  Clock,
  ArrowRight,
} from 'lucide-react';

interface DashboardMetrics {
  total_routes_today: number;
  pending_deliveries: number;
  completed_deliveries: number;
  success_rate: number;
  expired_returns: number;
}

interface RouteRow {
  id: string;
  name: string;
  created_at: string;
  status: string;
  order_count?: number;
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const STATUS_COLORS: Record<string, string> = {
  Entregues: '#10b981',
  Pendentes: '#f59e0b',
  Devolvidos: '#ef4444',
};

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    total_routes_today: 0,
    pending_deliveries: 0,
    completed_deliveries: 0,
    success_rate: 0,
    expired_returns: 0,
  });
  const [weekData, setWeekData] = useState<{ day: string; Entregues: number; Pendentes: number }[]>([]);
  const [statusPie, setStatusPie] = useState<{ name: string; value: number }[]>([]);
  const [recentRoutes, setRecentRoutes] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];

      // KPI Cards
      const [
        { count: routesCount },
        { count: pendingCount },
        { count: completedCount },
        { count: totalCount },
        { count: returnedCount },
      ] = await Promise.all([
        supabase.from('routes').select('*', { count: 'exact', head: true }).gte('created_at', today),
        supabase.from('route_orders').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('route_orders').select('*', { count: 'exact', head: true }).eq('status', 'delivered').gte('delivered_at', today),
        supabase.from('route_orders').select('*', { count: 'exact', head: true }),
        supabase.from('route_orders').select('*', { count: 'exact', head: true }).eq('status', 'returned'),
      ]);

      const successRate = totalCount && totalCount > 0
        ? Math.round((completedCount || 0) / totalCount * 100)
        : 0;

      setMetrics({
        total_routes_today: routesCount || 0,
        pending_deliveries: pendingCount || 0,
        completed_deliveries: completedCount || 0,
        success_rate: successRate,
        expired_returns: returnedCount || 0,
      });

      // Pie: status geral
      setStatusPie([
        { name: 'Entregues', value: completedCount || 0 },
        { name: 'Pendentes', value: pendingCount || 0 },
        { name: 'Devolvidos', value: returnedCount || 0 },
      ]);

      // Weekly bar chart: últimos 7 dias
      const days: { day: string; Entregues: number; Pendentes: number }[] = [];
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const dayStr = d.toISOString().split('T')[0];
        const nextDay = new Date(d);
        nextDay.setDate(d.getDate() + 1);
        const nextDayStr = nextDay.toISOString().split('T')[0];

        const [{ count: del }, { count: pen }] = await Promise.all([
          supabase.from('route_orders').select('*', { count: 'exact', head: true }).eq('status', 'delivered').gte('delivered_at', dayStr).lt('delivered_at', nextDayStr),
          supabase.from('route_orders').select('*', { count: 'exact', head: true }).eq('status', 'pending').gte('created_at', dayStr).lt('created_at', nextDayStr),
        ]);

        days.push({ day: DAYS[d.getDay()], Entregues: del || 0, Pendentes: pen || 0 });
      }
      setWeekData(days);

      // Most recent routes
      const { data: routes } = await supabase
        .from('routes')
        .select('id, name, created_at, status')
        .order('created_at', { ascending: false })
        .limit(6);

      setRecentRoutes((routes || []) as RouteRow[]);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const kpiCards = [
    { label: 'Rotas Hoje', value: metrics.total_routes_today, icon: Truck, gradient: 'from-blue-500 to-blue-600', bg: 'bg-blue-50', text: 'text-blue-700' },
    { label: 'Pendentes', value: metrics.pending_deliveries, icon: Package, gradient: 'from-amber-400 to-orange-500', bg: 'bg-amber-50', text: 'text-amber-700' },
    { label: 'Entregues Hoje', value: metrics.completed_deliveries, icon: CheckCircle2, gradient: 'from-emerald-500 to-green-600', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    { label: 'Taxa de Sucesso', value: `${metrics.success_rate}%`, icon: TrendingUp, gradient: 'from-purple-500 to-indigo-600', bg: 'bg-purple-50', text: 'text-purple-700' },
    { label: 'Devoluções', value: metrics.expired_returns, icon: AlertTriangle, gradient: 'from-red-500 to-rose-600', bg: 'bg-red-50', text: 'text-red-700' },
  ];

  const statusBadge: Record<string, string> = {
    active: 'bg-blue-100 text-blue-700',
    completed: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-amber-100 text-amber-700',
    cancelled: 'bg-red-100 text-red-700',
  };

  const statusLabel: Record<string, string> = {
    active: 'Ativa',
    completed: 'Concluída',
    pending: 'Pendente',
    cancelled: 'Cancelada',
  };

  return (
    <main className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {kpiCards.map((card) => (
          <div key={card.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-all">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-sm`}>
              <card.icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{card.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-0.5">
                {loading ? <span className="inline-block h-7 w-12 bg-gray-100 rounded animate-pulse" /> : card.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Bar Chart - entregas da semana */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Entregas — Últimos 7 Dias</h2>
              <p className="text-xs text-gray-400 mt-0.5">Comparativo de entregas realizadas vs pendentes</p>
            </div>
            <div className="flex items-center gap-3 text-xs font-medium">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />Entregues</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />Pendentes</span>
            </div>
          </div>
          {loading ? (
            <div className="h-52 bg-gray-50 rounded-xl animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={weekData} barCategoryGap="30%" barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontSize: 13 }}
                  cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                />
                <Bar dataKey="Entregues" fill="#10b981" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Pendentes" fill="#fbbf24" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Donut Chart - status geral */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Status Geral dos Pedidos</h2>
          <p className="text-xs text-gray-400 mb-4">Distribuição acumulada</p>
          {loading ? (
            <div className="h-52 bg-gray-50 rounded-xl animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie
                  data={statusPie}
                  cx="50%"
                  cy="45%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {statusPie.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontSize: 13 }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recent Routes */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900">Rotas Recentes</h2>
          </div>
          <Link to="/admin/routes" className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">
            Ver todas <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : recentRoutes.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            <Truck className="h-8 w-8 mx-auto mb-2 opacity-30" />
            Nenhuma rota encontrada
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentRoutes.map((route) => (
              <div key={route.id} className="flex items-center justify-between px-6 py-3.5 hover:bg-gray-50/60 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <Truck className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{route.name || `Rota ${route.id.substring(0, 8)}`}</p>
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" />
                      {new Date(route.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusBadge[route.status] || 'bg-gray-100 text-gray-600'}`}>
                  {statusLabel[route.status] || route.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Access - Navigation shortcuts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Importar Pedidos', href: '/admin/orders', icon: Package, color: 'text-blue-600', bg: 'bg-blue-50 hover:bg-blue-100' },
          { label: 'Gestão de Entregas', href: '/admin/routes', icon: Truck, color: 'text-teal-600', bg: 'bg-teal-50 hover:bg-teal-100' },
          { label: 'Gestão de Montagem', href: '/admin/assembly', icon: Hammer, color: 'text-purple-600', bg: 'bg-purple-50 hover:bg-purple-100' },
          { label: 'Consulta de Pedido', href: '/admin/order-lookup', icon: Package, color: 'text-indigo-600', bg: 'bg-indigo-50 hover:bg-indigo-100' },
        ].map((item) => (
          <Link
            key={item.href}
            to={item.href}
            className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border border-transparent ${item.bg} transition-all group`}
          >
            <item.icon className={`h-5 w-5 shrink-0 ${item.color}`} />
            <span className={`text-sm font-medium ${item.color}`}>{item.label}</span>
            <ArrowRight className={`h-3.5 w-3.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity ${item.color}`} />
          </Link>
        ))}
      </div>

    </main>
  );
}
